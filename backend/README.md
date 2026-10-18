# vps-studio

Railway/Render-style deploys to your own VPS. Add a server with its IP, username and password,
then give vps-studio a Docker image URL (plus a token for private GHCR packages). It connects over
SSH, installs Docker if needed, runs your container, and puts it behind HTTPS on your domain.

Nothing needs to be installed on the VPS by hand. This folder is the Go API; the dashboard is in
[../frontend](../frontend). See the [main README](../README.md) for local setup and deployment.

```
vps-studio (your laptop or any machine)
     │  SSH
     ▼
VPS ── Docker ── your apps
     └─ Traefik (HTTPS, Let's Encrypt)
```

## Run it

From this folder:

```bash
cp .env.example .env              # fill in API_KEY and SECRET_KEY (openssl rand -hex 32)
go run ./cmd/server               # reads .env from the current directory, listens on :8081
```

Data (servers, apps, deployments) is stored in `data/vps-studio.db`.

## 1. Add your VPS

```bash
curl -X POST localhost:8081/api/servers \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "sumopod",
    "host": "203.0.113.10",
    "username": "root",
    "password": "your-vps-password",
    "acme_email": "you@example.com"
  }'
```

vps-studio checks the login right away and returns an error if it fails. It then sets the server
up in the background:

1. Installs Docker if it's missing.
2. Creates the `vps-studio` network.
3. If `acme_email` is set, starts Traefik on ports 80/443 for automatic HTTPS. Leave `acme_email`
   out if you don't have a domain yet.

Follow progress with `GET /api/servers/sumopod`. When `status` is `ready`, you can deploy.
If it says `error`, read `setup_log`, fix the problem, and run `POST /api/servers/sumopod/setup`.

| Field | Notes |
|---|---|
| `host` | VPS IP address (from the Sumopod dashboard) |
| `port` | SSH port, default `22` |
| `username` | Default `root`. Non-root users need sudo; they are added to the `docker` group |
| `password` / `private_key` | One is required. Encrypted at rest and never returned |
| `acme_email` | Enables the HTTPS proxy; Let's Encrypt uses it for expiry notices |

The server's SSH host key is saved on first connect, and later connections are refused if it
changes. If you rebuild the VPS, delete the server and add it again.

## 2. Deploy an app

```bash
curl -X POST localhost:8081/api/apps \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "my-api",
    "image": "ghcr.io/my-org/my-api:latest",
    "registry_token": "ghp_xxx",
    "port": 3000,
    "domain": "api.example.com",
    "env": { "DATABASE_URL": "postgres://..." }
  }'
```

For `domain`, add a DNS A record pointing at the VPS IP. Without a domain, use `"host_port": 3000`
and open `http://VPS_IP:3000`.

| Field | Notes |
|---|---|
| `name` | lowercase, digits, `-`. Other apps reach it at `http://<name>:<port>` |
| `server` | Server name or ID. Optional when you have only one server |
| `image` | Only `ghcr.io/...` for now |
| `registry_token` | GitHub PAT (classic) with `read:packages`. Leave it out for public packages |
| `registry_username` | Optional. Defaults to the image owner |
| `port` | The port your app listens on inside the container. `PORT` is set to it unless you set it in `env` |
| `domain` | Optional. Needs a server with `acme_email` |
| `host_port` | Optional. Publishes the port directly on the VPS |
| `env` | Environment variables as JSON. On PATCH it's merged: listed keys are set, `null` removes a key |
| `env_file` | Contents of a `.env` file (create or PATCH). `env` overrides it |

### Environment variables

Upload your `.env` file as it is. It's merged into the app's env: keys in the file are added or
updated, and other keys stay unchanged.

```bash
curl -X PUT "localhost:8081/api/apps/my-api/env?deploy=true" \
  -H "Authorization: Bearer $API_KEY" --data-binary @.env
```

- The response lists the `added`, `updated` and `removed` keys.
- Add `replace=true` to remove keys that aren't in the file.
- Without `deploy=true`, changes apply on the next deploy.
- `${VAR}` references are resolved against keys in the same file.

Change or remove single keys without the file:

```bash
curl -X PATCH localhost:8081/api/apps/my-api -H "Authorization: Bearer $API_KEY" \
  -d '{"env": {"APP_DEBUG": "false", "OLD_KEY": null}, "deploy": true}'
```

See what the container gets: `GET /api/apps/my-api/env` returns it in `.env` format.

The values are passed as real environment variables, not copied as a file. Frameworks such as
Laravel read real environment variables before any `.env` file.

### How a deploy works

1. Pull the image on the VPS using the app's registry credentials.
2. Stop the current container and keep it as `app-<name>-prev`.
3. Start the new container `app-<name>`.
4. Wait `STARTUP_GRACE_SECONDS`. If it's still running, delete the previous container.
   Otherwise put the previous one back (rollback).

## API

Every `/api/*` call needs `Authorization: Bearer $API_KEY`. `:id` accepts an ID or a name.

| Method | Path | Description |
|---|---|---|
| POST | `/api/servers` | Add a VPS (tests SSH, then sets it up unless `"setup": false`) |
| GET | `/api/servers` / `/api/servers/:id` | List servers / details with `setup_log` |
| PATCH | `/api/servers/:id` | Change credentials etc.; add `"setup": true` to re-run setup |
| POST | `/api/servers/:id/setup` | Re-run setup |
| DELETE | `/api/servers/:id` | Remove a server (it must have no apps) |
| POST | `/api/apps` | Create an app (deploys immediately unless `"deploy": false`) |
| GET | `/api/apps` / `/api/apps/:id` | List apps / details, with container state |
| PATCH | `/api/apps/:id` | Update fields; add `"deploy": true` to redeploy |
| DELETE | `/api/apps/:id` | Remove the container and the app |
| GET | `/api/apps/:id/env` | The app's env in `.env` format |
| PUT | `/api/apps/:id/env` | Merge an uploaded `.env` file (`?replace=true`, `?deploy=true`) |
| POST | `/api/apps/:id/deploy` | Redeploy (optional body `{"image": "...:new-tag"}`) |
| GET | `/api/apps/:id/deployments` | Deployment history |
| GET | `/api/deployments/:id` | One deployment, including its log |
| GET | `/api/apps/:id/logs?tail=200` | Container logs |
| POST | `/api/apps/:id/restart` / `stop` / `start` | Container controls |
| POST | `/hooks/apps/:id/deploy` | Deploy webhook for CI (`X-Webhook-Token` header) |

### Auto-deploy from GitHub Actions

This only works when vps-studio runs at a public URL (not only on your laptop). The app's create
response includes a `webhook_token`. Store it as a repo secret, then add this step after pushing
the image:

```yaml
- name: Deploy
  run: |
    curl -fsS -X POST https://studio.example.com/hooks/apps/my-api/deploy \
      -H "X-Webhook-Token: ${{ secrets.VPS_STUDIO_WEBHOOK_TOKEN }}" \
      -d '{"image":"ghcr.io/my-org/my-api:sha-${{ github.sha }}"}'
```

The webhook can only deploy a tag or digest of the app's own repository.

## Docker image

The `Dockerfile` builds the API only. It listens on port 8081 and keeps its database in `/data`.
Run it together with the dashboard image using [docker-compose.yml](../docker-compose.yml); see
[Deploy](../README.md#deploy) in the main README. GitHub Actions publishes it as
`ghcr.io/<owner>/<repo>-backend` ([workflow](../.github/workflows/backend.yml)).

## Adding another registry

Implement `registry.Provider` (see [internal/registry/ghcr.go](internal/registry/ghcr.go)) and add it
to `providers` in [internal/registry/registry.go](internal/registry/registry.go).

## Security notes

- vps-studio stores the VPS login, and it can run anything on the VPS. Keep `API_KEY`, `SECRET_KEY`
  and `data/` private. An SSH key is safer than a password.
- Don't change `SECRET_KEY` after adding servers, or the stored secrets can't be decrypted.
