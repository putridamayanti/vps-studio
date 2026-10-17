package registry

import (
	"strings"

	dockerregistry "github.com/docker/docker/api/types/registry"
)

// GHCR is the GitHub Container Registry. Private packages need a personal access
// token (classic) with the read:packages scope; public packages need no token.
type GHCR struct{}

func (GHCR) Name() string { return "ghcr" }
func (GHCR) Host() string { return "ghcr.io" }

func (g GHCR) EncodeAuth(image string, creds Credentials) (string, error) {
	if creds.Token == "" {
		return "", nil
	}
	username := creds.Username
	if username == "" {
		// ghcr.io/<owner>/<repo> — the owner is a sensible default username.
		parts := strings.Split(strings.TrimPrefix(image, g.Host()+"/"), "/")
		username = parts[0]
	}
	return dockerregistry.EncodeAuthConfig(dockerregistry.AuthConfig{
		Username:      username,
		Password:      creds.Token,
		ServerAddress: g.Host(),
	})
}
