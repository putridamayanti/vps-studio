// Package deployer runs app containers on remote servers' Docker daemons over SSH.
package deployer

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"

	"vps-studio/internal/config"
	"vps-studio/internal/crypto"
	"vps-studio/internal/registry"
	"vps-studio/internal/store"
)

const (
	labelManaged  = "vps-studio.managed"
	labelAppID    = "vps-studio.app-id"
	deployTimeout = 15 * time.Minute

	// Names of the Traefik entrypoint and cert resolver created by server setup.
	traefikEntrypoint   = "websecure"
	traefikCertResolver = "letsencrypt"
)

type Deployer struct {
	store *store.Store
	cfg   config.Config
	pool  *Pool
	locks sync.Map // app ID -> *sync.Mutex; one deploy per app at a time
}

func New(cfg config.Config, st *store.Store) *Deployer {
	return &Deployer{store: st, cfg: cfg, pool: NewPool(st)}
}

// Pool exposes the server connection pool, e.g. to drop a connection when a server is deleted.
func (d *Deployer) Pool() *Pool { return d.pool }

// ContainerName is the Docker container name for an app.
func ContainerName(app *store.App) string { return "app-" + app.Name }

// Deploy records a new deployment and runs it in the background.
func (d *Deployer) Deploy(app store.App, trigger string) (*store.Deployment, error) {
	dep := &store.Deployment{
		ID:      crypto.RandomToken(8),
		AppID:   app.ID,
		Image:   app.Image,
		Status:  store.StatusQueued,
		Trigger: trigger,
	}
	if err := d.store.CreateDeployment(dep); err != nil {
		return nil, err
	}
	go d.run(app, dep.ID)
	return dep, nil
}

func (d *Deployer) run(app store.App, depID string) {
	mu, _ := d.locks.LoadOrStore(app.ID, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), deployTimeout)
	defer cancel()

	logf := func(format string, args ...any) {
		line := time.Now().UTC().Format("15:04:05") + " " + fmt.Sprintf(format, args...)
		if err := d.store.AppendDeploymentLog(depID, line); err != nil {
			slog.Error("append deployment log", "deployment", depID, "err", err)
		}
	}

	containerID, err := d.deploy(ctx, &app, depID, logf)
	if err != nil {
		logf("ERROR: %v", err)
		_ = d.store.FinishDeployment(depID, store.StatusFailed, "", err.Error())
		slog.Warn("deployment failed", "app", app.Name, "deployment", depID, "err", err)
		return
	}
	if err := d.store.SetAppImage(app.ID, app.Image); err != nil {
		logf("Warning: could not save image on app: %v", err)
	}
	logf("Deployment succeeded")
	_ = d.store.FinishDeployment(depID, store.StatusSucceeded, containerID, "")
	slog.Info("deployment succeeded", "app", app.Name, "deployment", depID)
}

func (d *Deployer) deploy(ctx context.Context, app *store.App, depID string, logf func(string, ...any)) (string, error) {
	logf("Connecting to server")
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return "", err
	}

	// 1. Pull
	_ = d.store.SetDeploymentStatus(depID, store.StatusPulling)
	if err := d.pull(ctx, cli, app, logf); err != nil {
		return "", err
	}

	// 2. Network
	if err := d.ensureNetwork(ctx, cli); err != nil {
		return "", fmt.Errorf("ensure network: %w", err)
	}

	// 3. Swap containers, keeping the old one around until the new one is healthy.
	_ = d.store.SetDeploymentStatus(depID, store.StatusStarting)
	name := ContainerName(app)
	prevName := name + "-prev"

	if err := removeIfExists(ctx, cli, prevName); err != nil {
		return "", err
	}
	hadPrevious := false
	if _, err := cli.ContainerInspect(ctx, name); err == nil {
		logf("Stopping current container")
		timeout := 10
		if err := cli.ContainerStop(ctx, name, container.StopOptions{Timeout: &timeout}); err != nil {
			return "", fmt.Errorf("stop current container: %w", err)
		}
		if err := cli.ContainerRename(ctx, name, prevName); err != nil {
			return "", fmt.Errorf("rename current container: %w", err)
		}
		hadPrevious = true
	} else if !errdefs.IsNotFound(err) {
		return "", err
	}

	id, startErr := d.startNew(ctx, cli, app, logf)
	if startErr != nil {
		if hadPrevious {
			logf("Rolling back to previous container")
			if err := rollback(ctx, cli, name, prevName); err != nil {
				logf("Rollback failed: %v", err)
			}
		}
		return "", startErr
	}

	if hadPrevious {
		if err := removeIfExists(ctx, cli, prevName); err != nil {
			logf("Warning: could not remove previous container: %v", err)
		}
	}
	return id, nil
}

func (d *Deployer) pull(ctx context.Context, cli *client.Client, app *store.App, logf func(string, ...any)) error {
	provider, err := registry.Resolve(app.Image)
	if err != nil {
		return err
	}
	auth, err := provider.EncodeAuth(app.Image, registry.Credentials{Username: app.RegistryUsername, Token: app.RegistryToken})
	if err != nil {
		return fmt.Errorf("encode registry auth: %w", err)
	}
	logf("Pulling %s from %s", app.Image, provider.Host())
	return pullImage(ctx, cli, app.Image, auth, logf)
}

func pullImage(ctx context.Context, cli *client.Client, ref, auth string, logf func(string, ...any)) error {
	rc, err := cli.ImagePull(ctx, ref, image.PullOptions{RegistryAuth: auth})
	if err != nil {
		return fmt.Errorf("pull image: %w", err)
	}
	defer rc.Close()

	// The pull stream is newline-delimited JSON; keep the meaningful lines, skip progress bars.
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var msg struct {
			Status string `json:"status"`
			ID     string `json:"id"`
			Error  string `json:"error"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		if msg.Error != "" {
			return fmt.Errorf("pull image: %s", msg.Error)
		}
		switch msg.Status {
		case "Downloading", "Extracting", "Waiting", "Verifying Checksum", "Pulling fs layer", "Download complete", "Already exists":
			continue
		}
		if msg.ID != "" && strings.HasPrefix(msg.Status, "Pull complete") {
			continue
		}
		logf("%s", msg.Status)
	}
	return scanner.Err()
}

func (d *Deployer) startNew(ctx context.Context, cli *client.Client, app *store.App, logf func(string, ...any)) (string, error) {
	name := ContainerName(app)
	port := nat.Port(strconv.Itoa(app.Port) + "/tcp")

	env := make([]string, 0, len(app.Env)+1)
	for k, v := range app.Env {
		env = append(env, k+"="+v)
	}
	if _, ok := app.Env["PORT"]; !ok {
		env = append(env, "PORT="+strconv.Itoa(app.Port))
	}
	sort.Strings(env)

	hostCfg := &container.HostConfig{
		RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyUnlessStopped},
		NetworkMode:   container.NetworkMode(d.cfg.DockerNetwork),
		LogConfig: container.LogConfig{
			Type:   "json-file",
			Config: map[string]string{"max-size": "10m", "max-file": "3"},
		},
	}
	if app.HostPort > 0 {
		hostCfg.PortBindings = nat.PortMap{port: {{HostIP: "0.0.0.0", HostPort: strconv.Itoa(app.HostPort)}}}
	}

	logf("Creating container %s", name)
	created, err := cli.ContainerCreate(ctx, &container.Config{
		Image:        app.Image,
		Env:          env,
		ExposedPorts: nat.PortSet{port: {}},
		Labels:       d.labels(app),
	}, hostCfg, &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			d.cfg.DockerNetwork: {Aliases: []string{app.Name}},
		},
	}, nil, name)
	if err != nil {
		return "", fmt.Errorf("create container: %w", err)
	}

	logf("Starting container")
	if err := cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		_ = cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})
		return "", fmt.Errorf("start container: %w", err)
	}

	logf("Waiting %s to make sure the container stays up", d.cfg.StartupGrace)
	select {
	case <-time.After(d.cfg.StartupGrace):
	case <-ctx.Done():
		return "", ctx.Err()
	}
	info, err := cli.ContainerInspect(ctx, created.ID)
	if err != nil {
		return "", err
	}
	if !info.State.Running || info.State.Restarting {
		tail, _ := containerLogs(ctx, cli, created.ID, "50")
		_ = cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})
		return "", fmt.Errorf("container exited during startup (exit code %d). Last logs:\n%s", info.State.ExitCode, tail)
	}
	return created.ID, nil
}

func rollback(ctx context.Context, cli *client.Client, name, prevName string) error {
	if err := removeIfExists(ctx, cli, name); err != nil {
		return err
	}
	if err := cli.ContainerRename(ctx, prevName, name); err != nil {
		return err
	}
	return cli.ContainerStart(ctx, name, container.StartOptions{})
}

func (d *Deployer) labels(app *store.App) map[string]string {
	labels := map[string]string{
		labelManaged: "true",
		labelAppID:   app.ID,
	}
	if app.Domain != "" {
		router := "app-" + app.Name
		labels["traefik.enable"] = "true"
		labels["traefik.docker.network"] = d.cfg.DockerNetwork
		labels["traefik.http.routers."+router+".rule"] = fmt.Sprintf("Host(`%s`)", app.Domain)
		labels["traefik.http.routers."+router+".entrypoints"] = traefikEntrypoint
		labels["traefik.http.routers."+router+".tls.certresolver"] = traefikCertResolver
		labels["traefik.http.services."+router+".loadbalancer.server.port"] = strconv.Itoa(app.Port)
	}
	return labels
}

func (d *Deployer) ensureNetwork(ctx context.Context, cli *client.Client) error {
	_, err := cli.NetworkInspect(ctx, d.cfg.DockerNetwork, network.InspectOptions{})
	if err == nil {
		return nil
	}
	if !errdefs.IsNotFound(err) {
		return err
	}
	_, err = cli.NetworkCreate(ctx, d.cfg.DockerNetwork, network.CreateOptions{Driver: "bridge"})
	return err
}

func removeIfExists(ctx context.Context, cli *client.Client, name string) error {
	err := cli.ContainerRemove(ctx, name, container.RemoveOptions{Force: true})
	if err != nil && !errdefs.IsNotFound(err) {
		return fmt.Errorf("remove container %s: %w", name, err)
	}
	return nil
}

func containerLogs(ctx context.Context, cli *client.Client, nameOrID, tail string) (string, error) {
	rc, err := cli.ContainerLogs(ctx, nameOrID, container.LogsOptions{ShowStdout: true, ShowStderr: true, Tail: tail, Timestamps: true})
	if err != nil {
		return "", err
	}
	defer rc.Close()
	var buf bytes.Buffer
	if _, err := stdcopy.StdCopy(&buf, &buf, io.LimitReader(rc, 5<<20)); err != nil && !errors.Is(err, io.EOF) {
		return buf.String(), err
	}
	return buf.String(), nil
}

// ---- runtime operations ----

type ContainerStatus struct {
	State     string `json:"state"` // running, exited, restarting, not_deployed, ...
	StartedAt string `json:"started_at,omitempty"`
	Image     string `json:"image,omitempty"`
}

func (d *Deployer) Status(ctx context.Context, app *store.App) (ContainerStatus, error) {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return ContainerStatus{}, err
	}
	info, err := cli.ContainerInspect(ctx, ContainerName(app))
	if errdefs.IsNotFound(err) {
		return ContainerStatus{State: "not_deployed"}, nil
	}
	if err != nil {
		return ContainerStatus{}, err
	}
	return ContainerStatus{State: info.State.Status, StartedAt: info.State.StartedAt, Image: info.Config.Image}, nil
}

// Logs returns the combined stdout/stderr of the app's container. tail is a line count or "all".
func (d *Deployer) Logs(ctx context.Context, app *store.App, tail string) (string, error) {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return "", err
	}
	return containerLogs(ctx, cli, ContainerName(app), tail)
}

func (d *Deployer) Restart(ctx context.Context, app *store.App) error {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return err
	}
	timeout := 10
	return cli.ContainerRestart(ctx, ContainerName(app), container.StopOptions{Timeout: &timeout})
}

func (d *Deployer) Stop(ctx context.Context, app *store.App) error {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return err
	}
	timeout := 10
	return cli.ContainerStop(ctx, ContainerName(app), container.StopOptions{Timeout: &timeout})
}

func (d *Deployer) Start(ctx context.Context, app *store.App) error {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return err
	}
	return cli.ContainerStart(ctx, ContainerName(app), container.StartOptions{})
}

// Remove deletes the app's containers (current and any leftover previous one).
func (d *Deployer) Remove(ctx context.Context, app *store.App) error {
	cli, err := d.pool.Docker(ctx, app.ServerID)
	if err != nil {
		return err
	}
	if err := removeIfExists(ctx, cli, ContainerName(app)+"-prev"); err != nil {
		return err
	}
	return removeIfExists(ctx, cli, ContainerName(app))
}

func IsNotFound(err error) bool { return errdefs.IsNotFound(err) }
