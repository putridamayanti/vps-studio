// Package registry resolves which container registry an image belongs to and
// produces the auth payload Docker needs to pull it.
//
// To add a provider (Docker Hub, GitLab, ECR, ...), implement Provider and add it to providers.
package registry

import (
	"fmt"
	"strings"
)

type Credentials struct {
	Username string
	Token    string
}

type Provider interface {
	// Name is the stable identifier stored with each app, e.g. "ghcr".
	Name() string
	// Host is the registry hostname that appears in image references, e.g. "ghcr.io".
	Host() string
	// EncodeAuth returns the base64 X-Registry-Auth value for a pull, or "" for anonymous pulls.
	EncodeAuth(image string, creds Credentials) (string, error)
}

var providers = []Provider{
	GHCR{},
}

// Resolve picks the provider for an image reference based on its host.
func Resolve(image string) (Provider, error) {
	host := Host(image)
	for _, p := range providers {
		if p.Host() == host {
			return p, nil
		}
	}
	supported := make([]string, 0, len(providers))
	for _, p := range providers {
		supported = append(supported, p.Host())
	}
	return nil, fmt.Errorf("registry %q is not supported yet (supported: %s)", host, strings.Join(supported, ", "))
}

// Host extracts the registry host from an image reference, following Docker's rules:
// the first path segment is a host only if it contains '.' or ':' or is "localhost".
func Host(image string) string {
	first, _, found := strings.Cut(image, "/")
	if found && (strings.ContainsAny(first, ".:") || first == "localhost") {
		return strings.ToLower(first)
	}
	return "docker.io"
}

// Repository strips the tag and digest from an image reference.
func Repository(image string) string {
	if i := strings.Index(image, "@"); i >= 0 {
		image = image[:i]
	}
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		image = image[:i]
	}
	return strings.ToLower(image)
}
