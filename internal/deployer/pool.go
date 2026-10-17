package deployer

import (
	"context"
	"net"
	"sync"

	"github.com/docker/docker/client"
	"golang.org/x/crypto/ssh"

	"vps-studio/internal/remote"
	"vps-studio/internal/store"
)

const remoteDockerSocket = "/var/run/docker.sock"

type conn struct {
	ssh    *ssh.Client
	docker *client.Client
}

func (c *conn) close() {
	c.docker.Close()
	c.ssh.Close()
}

// Pool keeps one SSH connection per server and talks to each server's Docker
// daemon by forwarding its unix socket through that connection.
type Pool struct {
	store *store.Store
	mu    sync.Mutex
	conns map[string]*conn
}

func NewPool(st *store.Store) *Pool {
	return &Pool{store: st, conns: map[string]*conn{}}
}

func (p *Pool) get(ctx context.Context, serverID string) (*conn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if c, ok := p.conns[serverID]; ok {
		if _, _, err := c.ssh.SendRequest("keepalive@openssh.com", true, nil); err == nil {
			return c, nil
		}
		c.close()
		delete(p.conns, serverID)
	}

	srv, err := p.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	sshClient, newHostKey, err := remote.Dial(ctx, remote.Target{
		Host:       srv.Host,
		Port:       srv.Port,
		Username:   srv.Username,
		Password:   srv.Password,
		PrivateKey: srv.PrivateKey,
		HostKey:    srv.HostKey,
	})
	if err != nil {
		return nil, err
	}
	if newHostKey != "" {
		if err := p.store.SetServerHostKey(srv.ID, newHostKey); err != nil {
			sshClient.Close()
			return nil, err
		}
	}

	dockerClient, err := client.NewClientWithOpts(
		client.WithHost("unix://"+remoteDockerSocket),
		client.WithDialContext(func(context.Context, string, string) (net.Conn, error) {
			return sshClient.Dial("unix", remoteDockerSocket)
		}),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		sshClient.Close()
		return nil, err
	}

	c := &conn{ssh: sshClient, docker: dockerClient}
	p.conns[serverID] = c
	return c, nil
}

// Docker returns a Docker client for the server's daemon.
func (p *Pool) Docker(ctx context.Context, serverID string) (*client.Client, error) {
	c, err := p.get(ctx, serverID)
	if err != nil {
		return nil, err
	}
	return c.docker, nil
}

// SSH returns the SSH connection to the server, for running shell commands.
func (p *Pool) SSH(ctx context.Context, serverID string) (*ssh.Client, error) {
	c, err := p.get(ctx, serverID)
	if err != nil {
		return nil, err
	}
	return c.ssh, nil
}

// Drop closes a server's connection, e.g. after its credentials or group membership changed.
func (p *Pool) Drop(serverID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if c, ok := p.conns[serverID]; ok {
		c.close()
		delete(p.conns, serverID)
	}
}
