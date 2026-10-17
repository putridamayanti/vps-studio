package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"vps-studio/internal/crypto"
	"vps-studio/internal/deployer"
	"vps-studio/internal/registry"
	"vps-studio/internal/store"
)

var (
	nameRe   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	envKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	domainRe = regexp.MustCompile(`^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`)
)

type Handler struct {
	store    *store.Store
	deployer *deployer.Deployer
}

type appResponse struct {
	store.App
	HasRegistryToken bool                      `json:"has_registry_token"`
	Container        *deployer.ContainerStatus `json:"container,omitempty"`
}

func (h *Handler) toResponse(ctx context.Context, a *store.App, withStatus bool) appResponse {
	resp := appResponse{App: *a, HasRegistryToken: a.RegistryToken != ""}
	if withStatus {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if st, err := h.deployer.Status(ctx, a); err == nil {
			resp.Container = &st
		}
	}
	return resp
}

// ---- apps ----

type createAppRequest struct {
	Name string `json:"name" binding:"required"`
	// Server is the server ID or name; optional when only one server exists.
	Server           string            `json:"server"`
	Image            string            `json:"image" binding:"required"`
	RegistryUsername string            `json:"registry_username"`
	RegistryToken    string            `json:"registry_token"`
	Port             int               `json:"port" binding:"required"`
	HostPort         int               `json:"host_port"`
	Domain           string            `json:"domain"`
	Env              map[string]string `json:"env"`
	// EnvFile is the contents of a .env file; keys in Env override it.
	EnvFile string `json:"env_file"`
	// Deploy right after creating (default true), like Railway/Render.
	Deploy *bool `json:"deploy"`
}

func (h *Handler) createApp(c *gin.Context) {
	var req createAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err.Error())
		return
	}

	srv, ok := h.resolveServer(c, req.Server)
	if !ok {
		return
	}
	deploy := req.Deploy == nil || *req.Deploy
	if deploy && !requireReady(c, srv) {
		return
	}

	app := &store.App{
		ID:               crypto.RandomToken(8),
		Name:             req.Name,
		ServerID:         srv.ID,
		Image:            req.Image,
		RegistryUsername: req.RegistryUsername,
		RegistryToken:    req.RegistryToken,
		Port:             req.Port,
		HostPort:         req.HostPort,
		Domain:           req.Domain,
		Env:              map[string]string{},
		WebhookToken:     crypto.RandomToken(24),
	}
	if !applyEnvFile(c, app, req.EnvFile) {
		return
	}
	for k, v := range req.Env {
		app.Env[k] = v
	}
	if !h.validateApp(c, app) {
		return
	}

	if err := h.store.CreateApp(app); err != nil {
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "an app with this name already exists"})
			return
		}
		serverError(c, err)
		return
	}

	resp := gin.H{"app": h.toResponse(c, app, false)}
	if deploy {
		dep, err := h.deployer.Deploy(*app, "create")
		if err != nil {
			serverError(c, err)
			return
		}
		resp["deployment"] = dep
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *Handler) listApps(c *gin.Context) {
	apps, err := h.store.ListApps()
	if err != nil {
		serverError(c, err)
		return
	}
	out := make([]appResponse, 0, len(apps))
	for i := range apps {
		out = append(out, h.toResponse(c, &apps[i], true))
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) getApp(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, h.toResponse(c, app, true))
}

// updateAppRequest uses pointers so omitted fields are left untouched.
type updateAppRequest struct {
	Image            *string `json:"image"`
	RegistryUsername *string `json:"registry_username"`
	RegistryToken    *string `json:"registry_token"` // "" clears it
	Port             *int    `json:"port"`
	HostPort         *int    `json:"host_port"`
	Domain           *string `json:"domain"`
	// Env is merged into the existing env: listed keys are set, a null value removes the key.
	Env map[string]*string `json:"env"`
	// EnvFile is the contents of a .env file, merged in before Env.
	EnvFile string `json:"env_file"`
	Deploy  bool   `json:"deploy"`
}

func (h *Handler) updateApp(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	var req updateAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err.Error())
		return
	}
	if req.Image != nil {
		app.Image = *req.Image
	}
	if req.RegistryUsername != nil {
		app.RegistryUsername = *req.RegistryUsername
	}
	if req.RegistryToken != nil {
		app.RegistryToken = *req.RegistryToken
	}
	if req.Port != nil {
		app.Port = *req.Port
	}
	if req.HostPort != nil {
		app.HostPort = *req.HostPort
	}
	if req.Domain != nil {
		app.Domain = *req.Domain
	}
	if !applyEnvFile(c, app, req.EnvFile) {
		return
	}
	for k, v := range req.Env {
		if v == nil {
			delete(app.Env, k)
		} else {
			app.Env[k] = *v
		}
	}
	if !h.validateApp(c, app) {
		return
	}
	if req.Deploy && !h.requireAppServerReady(c, app) {
		return
	}
	if err := h.store.UpdateApp(app); err != nil {
		serverError(c, err)
		return
	}

	resp := gin.H{"app": h.toResponse(c, app, false)}
	if req.Deploy {
		dep, err := h.deployer.Deploy(*app, "update")
		if err != nil {
			serverError(c, err)
			return
		}
		resp["deployment"] = dep
	} else {
		resp["note"] = "changes take effect on the next deploy"
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) deleteApp(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	if err := h.deployer.Remove(c, app); err != nil {
		serverError(c, err)
		return
	}
	if err := h.store.DeleteApp(app.ID); err != nil {
		serverError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- env ----

// getEnv returns the app's env in .env format.
func (h *Handler) getEnv(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	out, err := godotenv.Marshal(app.Env)
	if err != nil {
		serverError(c, err)
		return
	}
	if out != "" {
		out += "\n"
	}
	c.String(http.StatusOK, out)
}

// putEnvFile merges an uploaded .env file into the app's env.
// ?replace=true drops keys not in the file; ?deploy=true redeploys afterwards.
func (h *Handler) putEnvFile(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	parsed, err := godotenv.Unmarshal(string(body))
	if err != nil {
		badRequest(c, "invalid .env file: "+err.Error())
		return
	}

	var added, updated, removed []string
	if c.Query("replace") == "true" {
		for k := range app.Env {
			if _, ok := parsed[k]; !ok {
				removed = append(removed, k)
				delete(app.Env, k)
			}
		}
	}
	for k, v := range parsed {
		old, exists := app.Env[k]
		switch {
		case !exists:
			added = append(added, k)
		case old != v:
			updated = append(updated, k)
		}
		app.Env[k] = v
	}
	deploy := c.Query("deploy") == "true"
	if !h.validateApp(c, app) {
		return
	}
	if deploy && !h.requireAppServerReady(c, app) {
		return
	}
	if err := h.store.UpdateApp(app); err != nil {
		serverError(c, err)
		return
	}

	sort.Strings(added)
	sort.Strings(updated)
	sort.Strings(removed)
	resp := gin.H{"added": nonNil(added), "updated": nonNil(updated), "removed": nonNil(removed), "total": len(app.Env)}
	if deploy {
		dep, err := h.deployer.Deploy(*app, "env")
		if err != nil {
			serverError(c, err)
			return
		}
		resp["deployment"] = dep
	} else {
		resp["note"] = "changes take effect on the next deploy"
	}
	c.JSON(http.StatusOK, resp)
}

func applyEnvFile(c *gin.Context, app *store.App, content string) bool {
	if app.Env == nil {
		app.Env = map[string]string{}
	}
	if strings.TrimSpace(content) == "" {
		return true
	}
	parsed, err := godotenv.Unmarshal(content)
	if err != nil {
		badRequest(c, "invalid env_file: "+err.Error())
		return false
	}
	for k, v := range parsed {
		app.Env[k] = v
	}
	return true
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// ---- deploys ----

type deployRequest struct {
	// Optional: deploy a different tag/digest of the same repository, e.g. ghcr.io/me/api:sha-abc123.
	Image string `json:"image"`
}

func (h *Handler) deployApp(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	h.triggerDeploy(c, app, "manual")
}

// webhookDeploy lets CI (e.g. GitHub Actions) redeploy after pushing an image,
// authenticated with the app's own webhook token instead of the admin API key.
func (h *Handler) webhookDeploy(c *gin.Context) {
	app, err := h.store.GetApp(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	token := c.GetHeader("X-Webhook-Token")
	if token == "" {
		token = c.Query("token")
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(app.WebhookToken)) != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	h.triggerDeploy(c, app, "webhook")
}

func (h *Handler) triggerDeploy(c *gin.Context, app *store.App, trigger string) {
	if !h.requireAppServerReady(c, app) {
		return
	}
	var req deployRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			badRequest(c, err.Error())
			return
		}
	}
	if req.Image != "" && req.Image != app.Image {
		if registry.Repository(req.Image) != registry.Repository(app.Image) {
			badRequest(c, fmt.Sprintf("image must be a tag or digest of %s", registry.Repository(app.Image)))
			return
		}
		// Only deploys with this image; the deployer saves it to the app once the deploy succeeds.
		app.Image = req.Image
	}
	dep, err := h.deployer.Deploy(*app, trigger)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, dep)
}

func (h *Handler) listDeployments(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	deps, err := h.store.ListDeployments(app.ID, limit)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, deps)
}

func (h *Handler) getDeployment(c *gin.Context) {
	dep, err := h.store.GetDeployment(c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "deployment not found"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, dep)
}

// ---- runtime ----

func (h *Handler) appLogs(c *gin.Context) {
	app, ok := h.loadApp(c)
	if !ok {
		return
	}
	tail := c.DefaultQuery("tail", "200")
	if _, err := strconv.Atoi(tail); err != nil && tail != "all" {
		badRequest(c, "tail must be a number or 'all'")
		return
	}
	logs, err := h.deployer.Logs(c, app, tail)
	if deployer.IsNotFound(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "app is not deployed"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.String(http.StatusOK, logs)
}

func (h *Handler) containerAction(action func(*deployer.Deployer, context.Context, *store.App) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		app, ok := h.loadApp(c)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(c, 30*time.Second)
		defer cancel()
		err := action(h.deployer, ctx, app)
		if deployer.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "app is not deployed"})
			return
		}
		if err != nil {
			serverError(c, err)
			return
		}
		st, _ := h.deployer.Status(ctx, app)
		c.JSON(http.StatusOK, st)
	}
}

// ---- helpers ----

func (h *Handler) loadApp(c *gin.Context) (*store.App, bool) {
	app, err := h.store.GetApp(c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "app not found"})
		return nil, false
	}
	if err != nil {
		serverError(c, err)
		return nil, false
	}
	return app, true
}

func (h *Handler) validateApp(c *gin.Context, a *store.App) bool {
	if !nameRe.MatchString(a.Name) {
		badRequest(c, "name must be lowercase letters, digits or '-', max 40 chars")
		return false
	}
	provider, err := registry.Resolve(a.Image)
	if err != nil {
		badRequest(c, err.Error())
		return false
	}
	a.Registry = provider.Name()
	srv, err := h.store.GetServer(a.ServerID)
	if err != nil {
		serverError(c, err)
		return false
	}
	if a.Port < 1 || a.Port > 65535 {
		badRequest(c, "port must be between 1 and 65535")
		return false
	}
	if a.HostPort < 0 || a.HostPort > 65535 {
		badRequest(c, "host_port must be between 1 and 65535 (or 0 for none)")
		return false
	}
	if a.Domain != "" && !domainRe.MatchString(a.Domain) {
		badRequest(c, "domain is not a valid hostname")
		return false
	}
	if a.Domain != "" && srv.ACMEEmail == "" {
		badRequest(c, fmt.Sprintf("server %s has no HTTPS proxy: set acme_email on the server and run its setup, or use host_port", srv.Name))
		return false
	}
	for k := range a.Env {
		if !envKeyRe.MatchString(k) {
			badRequest(c, fmt.Sprintf("invalid env var name %q", k))
			return false
		}
	}

	apps, err := h.store.ListApps()
	if err != nil {
		serverError(c, err)
		return false
	}
	for _, other := range apps {
		if other.ID == a.ID {
			continue
		}
		if a.HostPort > 0 && other.HostPort == a.HostPort && other.ServerID == a.ServerID {
			c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("host_port %d is already used by %s", a.HostPort, other.Name)})
			return false
		}
		if a.Domain != "" && other.Domain == a.Domain {
			c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("domain %s is already used by %s", a.Domain, other.Name)})
			return false
		}
	}
	return true
}

// resolveServer finds the server an app goes on, defaulting to the only server when there is just one.
func (h *Handler) resolveServer(c *gin.Context, idOrName string) (*store.Server, bool) {
	if idOrName != "" {
		srv, err := h.store.GetServer(idOrName)
		if errors.Is(err, store.ErrNotFound) {
			badRequest(c, fmt.Sprintf("server %q not found", idOrName))
			return nil, false
		}
		if err != nil {
			serverError(c, err)
			return nil, false
		}
		return srv, true
	}
	servers, err := h.store.ListServers()
	if err != nil {
		serverError(c, err)
		return nil, false
	}
	switch len(servers) {
	case 0:
		badRequest(c, "add a server first: POST /api/servers")
		return nil, false
	case 1:
		return &servers[0], true
	default:
		badRequest(c, "server is required when more than one server exists")
		return nil, false
	}
}

func (h *Handler) requireAppServerReady(c *gin.Context, app *store.App) bool {
	srv, err := h.store.GetServer(app.ServerID)
	if err != nil {
		serverError(c, err)
		return false
	}
	return requireReady(c, srv)
}

func requireReady(c *gin.Context, srv *store.Server) bool {
	switch srv.Status {
	case store.ServerReady:
		return true
	case store.ServerSettingUp:
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("server %s is still being set up; check GET /api/servers/%s", srv.Name, srv.Name)})
	default:
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("server %s is not ready (status %q); check its setup_log and run POST /api/servers/%s/setup", srv.Name, srv.Status, srv.Name)})
	}
	return false
}

func badRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": msg})
}

func serverError(c *gin.Context, err error) {
	_ = c.Error(err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}
