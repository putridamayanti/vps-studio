package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"vps-studio/internal/crypto"
	"vps-studio/internal/remote"
	"vps-studio/internal/store"
)

var usernameRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

type serverResponse struct {
	store.Server
	HostKeyFingerprint string `json:"host_key_fingerprint,omitempty"`
	HasPassword        bool   `json:"has_password"`
	HasPrivateKey      bool   `json:"has_private_key"`
}

func toServerResponse(s *store.Server) serverResponse {
	return serverResponse{
		Server:             *s,
		HostKeyFingerprint: remote.Fingerprint(s.HostKey),
		HasPassword:        s.Password != "",
		HasPrivateKey:      s.PrivateKey != "",
	}
}

type createServerRequest struct {
	Name       string `json:"name" binding:"required"`
	Host       string `json:"host" binding:"required"` // VPS IP address or hostname
	Port       int    `json:"port"`                    // default 22
	Username   string `json:"username"`                // default root
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`
	// ACMEEmail enables the HTTPS proxy; Let's Encrypt sends certificate expiry notices here.
	ACMEEmail string `json:"acme_email"`
	// Setup installs Docker etc. right after adding the server (default true).
	Setup *bool `json:"setup"`
}

func (h *Handler) createServer(c *gin.Context) {
	var req createServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err.Error())
		return
	}
	srv := &store.Server{
		ID:         crypto.RandomToken(8),
		Name:       req.Name,
		Host:       strings.TrimSpace(req.Host),
		Port:       req.Port,
		Username:   req.Username,
		Password:   req.Password,
		PrivateKey: req.PrivateKey,
		ACMEEmail:  req.ACMEEmail,
		Status:     store.ServerNew,
	}
	if srv.Port == 0 {
		srv.Port = 22
	}
	if srv.Username == "" {
		srv.Username = "root"
	}
	if !validateServer(c, srv) {
		return
	}

	if err := h.store.CreateServer(srv); err != nil {
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "a server with this name already exists"})
			return
		}
		serverError(c, err)
		return
	}

	// Verify the credentials now so mistakes show up immediately instead of during the first deploy.
	if err := h.testConnection(c, srv.ID); err != nil {
		_ = h.store.DeleteServer(srv.ID)
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "could not connect over SSH: " + err.Error()})
		return
	}

	if req.Setup == nil || *req.Setup {
		if err := h.deployer.SetupServer(*srv); err != nil {
			serverError(c, err)
			return
		}
	}
	h.respondServer(c, http.StatusCreated, srv.ID)
}

func (h *Handler) listServers(c *gin.Context) {
	servers, err := h.store.ListServers()
	if err != nil {
		serverError(c, err)
		return
	}
	out := make([]serverResponse, 0, len(servers))
	for i := range servers {
		out = append(out, toServerResponse(&servers[i]))
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) getServer(c *gin.Context) {
	srv, ok := h.loadServer(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, toServerResponse(srv))
}

type updateServerRequest struct {
	Host       *string `json:"host"`
	Port       *int    `json:"port"`
	Username   *string `json:"username"`
	Password   *string `json:"password"`
	PrivateKey *string `json:"private_key"`
	ACMEEmail  *string `json:"acme_email"`
	Setup      bool    `json:"setup"`
}

func (h *Handler) updateServer(c *gin.Context) {
	srv, ok := h.loadServer(c)
	if !ok {
		return
	}
	var req updateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err.Error())
		return
	}
	if req.Host != nil && strings.TrimSpace(*req.Host) != srv.Host {
		srv.Host = strings.TrimSpace(*req.Host)
		srv.HostKey = "" // a different machine has a different host key
	}
	if req.Port != nil {
		srv.Port = *req.Port
	}
	if req.Username != nil {
		srv.Username = *req.Username
	}
	if req.Password != nil {
		srv.Password = *req.Password
	}
	if req.PrivateKey != nil {
		srv.PrivateKey = *req.PrivateKey
	}
	if req.ACMEEmail != nil {
		srv.ACMEEmail = *req.ACMEEmail
	}
	if !validateServer(c, srv) {
		return
	}
	if err := h.store.UpdateServer(srv); err != nil {
		serverError(c, err)
		return
	}
	h.deployer.Pool().Drop(srv.ID)

	if err := h.testConnection(c, srv.ID); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "saved, but could not connect over SSH: " + err.Error()})
		return
	}
	if req.Setup {
		if err := h.deployer.SetupServer(*srv); err != nil {
			serverError(c, err)
			return
		}
	}
	h.respondServer(c, http.StatusOK, srv.ID)
}

func (h *Handler) setupServer(c *gin.Context) {
	srv, ok := h.loadServer(c)
	if !ok {
		return
	}
	if srv.Status == store.ServerSettingUp {
		c.JSON(http.StatusConflict, gin.H{"error": "setup is already running"})
		return
	}
	if err := h.deployer.SetupServer(*srv); err != nil {
		serverError(c, err)
		return
	}
	h.respondServer(c, http.StatusAccepted, srv.ID)
}

func (h *Handler) deleteServer(c *gin.Context) {
	srv, ok := h.loadServer(c)
	if !ok {
		return
	}
	n, err := h.store.CountAppsOnServer(srv.ID)
	if err != nil {
		serverError(c, err)
		return
	}
	if n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("delete the %d app(s) on this server first", n)})
		return
	}
	h.deployer.Pool().Drop(srv.ID)
	if err := h.store.DeleteServer(srv.ID); err != nil {
		serverError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- helpers ----

func (h *Handler) testConnection(c *gin.Context, serverID string) error {
	ctx, cancel := context.WithTimeout(c, 20*time.Second)
	defer cancel()
	_, err := h.deployer.Pool().SSH(ctx, serverID)
	return err
}

func (h *Handler) respondServer(c *gin.Context, status int, id string) {
	srv, err := h.store.GetServer(id)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(status, toServerResponse(srv))
}

func (h *Handler) loadServer(c *gin.Context) (*store.Server, bool) {
	srv, err := h.store.GetServer(c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return nil, false
	}
	if err != nil {
		serverError(c, err)
		return nil, false
	}
	return srv, true
}

func validateServer(c *gin.Context, s *store.Server) bool {
	switch {
	case !nameRe.MatchString(s.Name):
		badRequest(c, "name must be lowercase letters, digits or '-', max 40 chars")
	case s.Host == "" || strings.ContainsAny(s.Host, " /"):
		badRequest(c, "host must be the server's IP address or hostname")
	case s.Port < 1 || s.Port > 65535:
		badRequest(c, "port must be between 1 and 65535")
	case !usernameRe.MatchString(s.Username):
		badRequest(c, "username is not a valid Linux username")
	case s.Password == "" && s.PrivateKey == "":
		badRequest(c, "password or private_key is required")
	case s.ACMEEmail != "" && !strings.Contains(s.ACMEEmail, "@"):
		badRequest(c, "acme_email must be an email address")
	default:
		return true
	}
	return false
}
