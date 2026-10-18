# vps-studio

Railway/Render-style deploys to your own VPS. Add a server with its IP, username and password,
then give vps-studio a Docker image URL (plus a token for private GHCR packages). It connects over
SSH, installs Docker if needed, runs your container, and puts it behind HTTPS on your domain.

```
browser ──► frontend (Next.js, :3100) ──► backend (Go API, :8081)
                                              │  SSH
                                              ▼
                                   VPS ── Docker ── your apps
                                        └─ Traefik (HTTPS, Let's Encrypt)
```

| Folder | What it is | Image |
|---|---|---|
| [backend/](backend/) | Go API: stores servers and apps, deploys over SSH. API reference in [backend/README.md](backend/README.md) | `ghcr.io/<owner>/<repo>-backend` |
| [frontend/](frontend/) | Next.js dashboard. Proxies `/api`, `/hooks` and `/healthz` to the backend | `ghcr.io/<owner>/<repo>-frontend` |

The browser only talks to the frontend. The backend doesn't need to be exposed to the internet.

## Run locally

Requirements: Go 1.26+, Node.js 24+.

**1. Backend** (terminal 1):

```bash
cd backend
cp .env.example .env      # set API_KEY and SECRET_KEY: openssl rand -hex 32
go run ./cmd/server       # http://localhost:8081, data in backend/data/vps-studio.db
```

**2. Frontend** (terminal 2):

```bash
cd frontend
cp .env.example .env      # API_URL=http://localhost:8081
npm install
npm run dev               # http://localhost:3100
```

Open http://localhost:3100 and sign in with `API_KEY`.

### Run the Docker images locally

To try the production images without pushing them:

```bash
docker build -t vps-studio-backend backend
docker build -t vps-studio-frontend frontend

cp .env.example .env      # set API_KEY and SECRET_KEY, then:
#   BACKEND_IMAGE=vps-studio-backend
#   FRONTEND_IMAGE=vps-studio-frontend
docker compose up -d
```

## Build images with GitHub Actions

There's one workflow per image:

| Workflow | Runs when | Pushes |
|---|---|---|
| [backend.yml](.github/workflows/backend.yml) | `backend/**` changes on `main` | `ghcr.io/<owner>/<repo>-backend` |
| [frontend.yml](.github/workflows/frontend.yml) | `frontend/**` changes on `main` | `ghcr.io/<owner>/<repo>-frontend` |

Both also run for every `v*` tag and can be started by hand from the Actions tab
(**Run workflow**). Each image gets these tags:

- `latest`: the newest build from `main`
- `sha-<short sha>`: every build
- `1.2.3`: from a `v1.2.3` tag

They use the built-in `GITHUB_TOKEN`, so no secrets are needed. New GHCR packages are private.
Either make them public (package page → **Package settings** → **Change visibility**) or log in on
the server that pulls them (see below).

A `v*` tag builds both images with the same version, which is the easiest way to release a matching
pair.

## Deploy

Run both images on any machine with Docker: a small VPS, a home server, or your laptop. vps-studio
only needs outbound SSH to the servers it manages.

**1. Log in to GHCR** (skip if the packages are public). Use a GitHub PAT (classic) with
`read:packages`:

```bash
echo <token> | docker login ghcr.io -u <github-username> --password-stdin
```

**2. Copy [docker-compose.yml](docker-compose.yml) and [.env.example](.env.example)** to the server,
in the same folder:

```bash
cp .env.example .env
```

Fill in `.env`:

```bash
API_KEY=<openssl rand -hex 32>
SECRET_KEY=<openssl rand -hex 32>
BACKEND_IMAGE=ghcr.io/<owner>/<repo>-backend:latest
FRONTEND_IMAGE=ghcr.io/<owner>/<repo>-frontend:latest
```

Use lowercase for `<owner>/<repo>`. Pin a version (`:1.2.3` or `:sha-abc1234`) instead of `latest`
if you want upgrades only when you choose.

**3. Start it:**

```bash
docker compose up -d
```

Open `http://<host>:3100` and sign in with `API_KEY`. Only the frontend publishes a port; the
backend is reachable only from the frontend container. Set `FRONTEND_PORT` in `.env` to use a
different port.

**4. Upgrade** after new images are pushed:

```bash
docker compose pull && docker compose up -d
```

### HTTPS

Put a reverse proxy (Caddy, Traefik, nginx) in front of port 3100. With Caddy:

```
studio.example.com {
  reverse_proxy localhost:3100
}
```

A public HTTPS URL is also what the CI deploy webhooks need
([details](backend/README.md#auto-deploy-from-github-actions)).

### Data and secrets

- The database is in the `vps-studio-data` volume (`/data` in the backend container). Back it up.
- Keep `SECRET_KEY` unchanged after adding servers; it decrypts the stored VPS logins and registry
  tokens.
- vps-studio can run anything on the servers it manages. Keep `API_KEY`, `SECRET_KEY` and the data
  volume private.

### Configuration

Backend (`backend` service in `docker-compose.yml`, or `backend/.env` locally):

| Variable | Default | Notes |
|---|---|---|
| `API_KEY` | — | Required, min 16 chars. Sign-in key for the dashboard and `/api/*` |
| `SECRET_KEY` | — | Required, min 16 chars. Encrypts secrets at rest |
| `PORT` | `8081` | |
| `DATABASE_PATH` | `data/vps-studio.db` (image: `/data/vps-studio.db`) | |
| `DOCKER_NETWORK` | `vps-studio` | Network deployed apps join on each VPS |
| `STARTUP_GRACE_SECONDS` | `5` | How long a new container must stay up before a deploy succeeds |

Frontend:

| Variable | Default | Notes |
|---|---|---|
| `API_URL` | `http://localhost:8081` (image: `http://backend:8081`) | Backend address, read at startup |
| `PORT` | `3100` | |

## Using vps-studio

Add a VPS, deploy apps, manage env vars and set up CI webhooks from the dashboard, or with the API
described in [backend/README.md](backend/README.md).
