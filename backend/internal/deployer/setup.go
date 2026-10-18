package deployer

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
	"github.com/docker/go-connections/nat"

	"vps-studio/internal/remote"
	"vps-studio/internal/store"
)

const (
	setupTimeout     = 15 * time.Minute
	traefikContainer = "vps-studio-traefik"
	traefikImage     = "traefik:v3.6"
)

// SetupServer prepares a server in the background: installs Docker if missing,
// creates the shared network and starts Traefik for HTTPS when an ACME email is set.
func (d *Deployer) SetupServer(srv store.Server) error {
	if err := d.store.ResetServerLog(srv.ID); err != nil {
		return err
	}
	if err := d.store.SetServerStatus(srv.ID, store.ServerSettingUp); err != nil {
		return err
	}
	go d.runSetup(srv)
	return nil
}

func (d *Deployer) runSetup(srv store.Server) {
	mu, _ := d.locks.LoadOrStore("server:"+srv.ID, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), setupTimeout)
	defer cancel()

	logf := func(format string, args ...any) {
		line := time.Now().UTC().Format("15:04:05") + " " + fmt.Sprintf(format, args...)
		if err := d.store.AppendServerLog(srv.ID, line); err != nil {
			slog.Error("append server log", "server", srv.ID, "err", err)
		}
	}

	if err := d.setup(ctx, &srv, logf); err != nil {
		logf("ERROR: %v", err)
		_ = d.store.SetServerStatus(srv.ID, store.ServerError)
		slog.Warn("server setup failed", "server", srv.Name, "err", err)
		return
	}
	logf("Server is ready")
	_ = d.store.SetServerStatus(srv.ID, store.ServerReady)
	slog.Info("server ready", "server", srv.Name)
}

func (d *Deployer) setup(ctx context.Context, srv *store.Server, logf func(string, ...any)) error {
	sshClient, err := d.pool.SSH(ctx, srv.ID)
	if err != nil {
		return err
	}
	logf("Connected to %s@%s", srv.Username, srv.Host)

	sudo, stdin := "", ""
	if srv.Username != "root" {
		if srv.Password != "" {
			sudo, stdin = "sudo -S -p '' ", srv.Password+"\n"
		} else {
			sudo = "sudo -n "
		}
	}
	out := &lineWriter{logf: logf}
	defer out.Flush()

	if _, err := remote.Output(sshClient, "command -v docker"); err != nil {
		logf("Docker is not installed; installing it (this takes 1-3 minutes)")
		if err := remote.Run(sshClient, sudo+"sh -c 'curl -fsSL https://get.docker.com | sh'", stdin, out); err != nil {
			out.Flush()
			return fmt.Errorf("install docker: %w", err)
		}
		out.Flush()
	} else {
		logf("Docker is already installed")
	}
	// Make sure the daemon runs now and after reboots; ignored on systems without systemd.
	_ = remote.Run(sshClient, sudo+"systemctl enable --now docker", stdin, io.Discard)
	if _, err := remote.Output(sshClient, "test -S "+remoteDockerSocket); err != nil {
		return fmt.Errorf("docker is installed but its daemon is not running; on the server run: sudo systemctl start docker")
	}

	if srv.Username != "root" {
		groups, _ := remote.Output(sshClient, "id -nG")
		if !slices.Contains(strings.Fields(groups), "docker") {
			logf("Adding %s to the docker group", srv.Username)
			if err := remote.Run(sshClient, sudo+"usermod -aG docker "+srv.Username, stdin, out); err != nil {
				out.Flush()
				return fmt.Errorf("add user to docker group: %w", err)
			}
			d.pool.Drop(srv.ID) // reconnect so the new group membership applies
		}
	}

	cli, err := d.pool.Docker(ctx, srv.ID)
	if err != nil {
		return err
	}
	version, err := cli.ServerVersion(ctx)
	if err != nil {
		if strings.Contains(err.Error(), "open failed") {
			return fmt.Errorf("the SSH server refused to forward the Docker socket; in /etc/ssh/sshd_config set AllowTcpForwarding yes and AllowStreamLocalForwarding yes, restart sshd, then run setup again (%w)", err)
		}
		return fmt.Errorf("reach docker daemon: %w", err)
	}
	logf("Docker %s is running", version.Version)

	if err := d.ensureNetwork(ctx, cli); err != nil {
		return fmt.Errorf("create network: %w", err)
	}
	logf("Network %s is ready", d.cfg.DockerNetwork)

	if srv.ACMEEmail == "" {
		logf("No acme_email set: skipping the HTTPS proxy. Apps on this server must use host_port instead of domain")
		return nil
	}
	return d.ensureTraefik(ctx, cli, srv.ACMEEmail, logf)
}

func (d *Deployer) ensureTraefik(ctx context.Context, cli *client.Client, email string, logf func(string, ...any)) error {
	cmd := []string{
		"--providers.docker=true",
		"--providers.docker.exposedbydefault=false",
		"--providers.docker.network=" + d.cfg.DockerNetwork,
		"--entrypoints.web.address=:80",
		"--entrypoints.web.http.redirections.entrypoint.to=" + traefikEntrypoint,
		"--entrypoints." + traefikEntrypoint + ".address=:443",
		"--certificatesresolvers." + traefikCertResolver + ".acme.email=" + email,
		"--certificatesresolvers." + traefikCertResolver + ".acme.storage=/letsencrypt/acme.json",
		"--certificatesresolvers." + traefikCertResolver + ".acme.httpchallenge.entrypoint=web",
	}

	info, err := cli.ContainerInspect(ctx, traefikContainer)
	switch {
	case err == nil && info.State.Running && info.Config.Image == traefikImage && slices.Equal(info.Config.Cmd, cmd):
		logf("HTTPS proxy (Traefik) is already running")
		return nil
	case err == nil:
		logf("Updating HTTPS proxy (Traefik)")
		if err := removeIfExists(ctx, cli, traefikContainer); err != nil {
			return err
		}
	case !errdefs.IsNotFound(err):
		return err
	}

	logf("Pulling %s", traefikImage)
	if err := pullImage(ctx, cli, traefikImage, "", logf); err != nil {
		return err
	}

	created, err := cli.ContainerCreate(ctx, &container.Config{
		Image:        traefikImage,
		Cmd:          cmd,
		ExposedPorts: nat.PortSet{"80/tcp": {}, "443/tcp": {}},
		Labels:       map[string]string{labelManaged: "true"},
	}, &container.HostConfig{
		RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyUnlessStopped},
		NetworkMode:   container.NetworkMode(d.cfg.DockerNetwork),
		PortBindings: nat.PortMap{
			"80/tcp":  {{HostIP: "0.0.0.0", HostPort: "80"}},
			"443/tcp": {{HostIP: "0.0.0.0", HostPort: "443"}},
		},
		Binds: []string{
			remoteDockerSocket + ":/var/run/docker.sock:ro",
			"vps-studio-letsencrypt:/letsencrypt",
		},
	}, nil, nil, traefikContainer)
	if err != nil {
		return fmt.Errorf("create traefik: %w", err)
	}
	if err := cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		_ = removeIfExists(ctx, cli, traefikContainer)
		if strings.Contains(err.Error(), "already allocated") || strings.Contains(err.Error(), "address already in use") {
			return fmt.Errorf("ports 80/443 are already used on the server (often nginx or apache); stop that service and run setup again: %w", err)
		}
		return fmt.Errorf("start traefik: %w", err)
	}
	logf("HTTPS proxy (Traefik) started on ports 80 and 443")
	return nil
}

// lineWriter turns streamed command output into log lines.
type lineWriter struct {
	logf func(string, ...any)
	buf  []byte
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		i := slices.Index(w.buf, '\n')
		if i < 0 {
			break
		}
		if line := strings.TrimSpace(string(w.buf[:i])); line != "" {
			w.logf("  %s", line)
		}
		w.buf = w.buf[i+1:]
	}
	return len(p), nil
}

func (w *lineWriter) Flush() {
	if line := strings.TrimSpace(string(w.buf)); line != "" {
		w.logf("  %s", line)
	}
	w.buf = nil
}
