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
| [frontend/](frontend/) | Next.js dashboard. Proxies `/api` and `/hooks` to the backend | `ghcr.io/<owner>/<repo>-frontend` |

The browser only talks to the frontend. The backend doesn't need to be exposed to the internet.

## Run locally

Requirements: Go 1.26+, Node.js 24+.

**1. Backend** (terminal 1):

```bash
cd backend
cp .env.example .env      # set API_KEY and SECRET_KEY: openssl rand -hex 32
go run ./cmd/server       # http://localhost:8081; uses DATABASE_URL if set, else backend/data/vps-studio.db
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

- Set `DATABASE_URL` to a Postgres database (e.g. Neon) to keep data outside the container. Without
  it, the backend uses SQLite in the `vps-studio-data` volume (`/data` in the backend container);
  back that up.
- To move existing SQLite data into Postgres, run once with `DATABASE_URL` set:
  `go run ./cmd/server migrate-sqlite [path/to/vps-studio.db]`. It refuses to run if the target
  already has data. Use the same `SECRET_KEY` afterwards.
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
| `DATABASE_URL` | — | Postgres URL, e.g. Neon's `postgresql://...?sslmode=require`. Overrides `DATABASE_PATH` |
| `DATABASE_PATH` | `data/vps-studio.db` (image: `/data/vps-studio.db`) | SQLite file, used when `DATABASE_URL` is empty |
| `DOCKER_NETWORK` | `vps-studio` | Network deployed apps join on each VPS |
| `STARTUP_GRACE_SECONDS` | `5` | How long a new container must stay up before a deploy succeeds |

Frontend:

| Variable | Default | Notes |
|---|---|---|
| `API_URL` | `http://localhost:8081` (image: `http://backend:8081`) | Backend address, read at startup |
| `PORT` | `3100` | |

## Deploy the frontend to Vercel (from your machine)

You can host the dashboard on Vercel and keep the backend on your own server. You deploy straight
from your laptop with the Vercel CLI, so no Git connection or GitHub Actions setup is needed.

```
browser ──► Vercel (frontend) ──HTTPS──► your server (backend, :8081)
```

The frontend on Vercel forwards `/api` and `/hooks` to `API_URL`, so **the backend
needs a public HTTPS URL** (for example `https://api.example.com`).

### 1. Run the backend with a public URL

On your server, log in to GHCR if the package is private (see [Deploy](#deploy)), then start only
the backend. Bind it to `127.0.0.1` so it's reachable only through the reverse proxy:

```bash
docker run -d --name vps-studio-backend --restart unless-stopped \
  -p 127.0.0.1:8081:8081 \
  -e API_KEY=<openssl rand -hex 32> \
  -e SECRET_KEY=<openssl rand -hex 32> \
  -v vps-studio-data:/data \
  ghcr.io/<owner>/<repo>-backend:latest
```

Point a DNS A record (`api.example.com`) at the server, then put HTTPS in front of it. With
Caddy (`/etc/caddy/Caddyfile`):

```
api.example.com {
  reverse_proxy localhost:8081
}
```

Check it from the server: `curl localhost:8081/healthz` should return `{"status":"ok"}`.

`/healthz` is meant for Docker's health check only. To keep it off the internet, block it in Caddy:

```
api.example.com {
  respond /healthz 404
  reverse_proxy localhost:8081
}
```

Every `/api/*` call needs `API_KEY`, but the backend is now on the internet, so use a long random
key.

### 2. Install the Vercel CLI and log in

```bash
npm install -g vercel
vercel login
```

### 3. Link the frontend folder to a Vercel project

Run every Vercel command from `frontend/`, so Vercel treats it as the project root:

```bash
cd frontend
vercel link
```

Answer the prompts: choose your scope, then create a new project (e.g. `vps-studio`) or pick an
existing one. Vercel detects Next.js automatically; keep the default build settings. This creates
`frontend/.vercel/` (already git-ignored).

### 4. Set `API_URL`

```bash
vercel env add API_URL production --value https://api.example.com
vercel env add API_URL preview --value https://api.example.com   # optional, for preview deploys
```

Don't add a trailing slash. `API_URL` is read on every request, so if you change it later, redeploy
(step 5) for the new value to take effect.

### 5. Deploy

```bash
vercel          # preview deployment, gets its own URL
vercel --prod   # production deployment
```

The CLI uploads `frontend/`, builds it on Vercel and prints the URL. Open it and sign in with the
backend's `API_KEY`.

To add your own domain (e.g. `studio.example.com`):

```bash
vercel domains add studio.example.com
```

Then add the DNS record Vercel shows you.

### Updating

After changing the frontend, deploy again from `frontend/`:

```bash
vercel --prod
```

To roll back to the previous production deployment: `vercel rollback`.

### Notes

- Webhook URLs shown in the dashboard use the Vercel domain. They work because `/hooks/*` is
  forwarded to the backend.
- `vercel env ls` lists the variables. `vercel env pull .env` downloads them for local development,
  but it overwrites your local `frontend/.env`, which points at `http://localhost:8081`.
- The GitHub Actions frontend image is still built, but you don't need it when Vercel hosts the
  frontend.

## Using vps-studio

Add a VPS, deploy apps, manage env vars and set up CI webhooks from the dashboard, or with the API
described in [backend/README.md](backend/README.md).
