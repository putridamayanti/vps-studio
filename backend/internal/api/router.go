package api

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"vps-studio/internal/deployer"
	"vps-studio/internal/store"
)

func NewRouter(apiKey string, st *store.Store, dep *deployer.Deployer) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	h := &Handler{store: st, deployer: dep}

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/hooks/apps/:id/deploy", h.webhookDeploy)

	api := r.Group("/api", requireAPIKey(apiKey))
	{
		api.GET("/servers", h.listServers)
		api.POST("/servers", h.createServer)
		api.GET("/servers/:id", h.getServer)
		api.PATCH("/servers/:id", h.updateServer)
		api.DELETE("/servers/:id", h.deleteServer)
		api.POST("/servers/:id/setup", h.setupServer)

		api.GET("/apps", h.listApps)
		api.POST("/apps", h.createApp)
		api.GET("/apps/:id", h.getApp)
		api.PATCH("/apps/:id", h.updateApp)
		api.DELETE("/apps/:id", h.deleteApp)
		api.GET("/apps/:id/env", h.getEnv)
		api.PUT("/apps/:id/env", h.putEnvFile)

		api.POST("/apps/:id/deploy", h.deployApp)
		api.GET("/apps/:id/deployments", h.listDeployments)
		api.GET("/deployments/:id", h.getDeployment)

		api.GET("/apps/:id/logs", h.appLogs)
		api.POST("/apps/:id/restart", h.containerAction((*deployer.Deployer).Restart))
		api.POST("/apps/:id/stop", h.containerAction((*deployer.Deployer).Stop))
		api.POST("/apps/:id/start", h.containerAction((*deployer.Deployer).Start))
	}
	return r
}

func requireAPIKey(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(token), []byte(key)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}
