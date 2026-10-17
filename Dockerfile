# One image with both parts of vps-studio:
#   - the Go API on :8080 (internal only)
#   - the Next.js dashboard on :3000, which proxies /api, /hooks and /healthz to the API
# Only port 3000 needs to be published.

FROM golang:1.26-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vps-studio ./cmd/server

FROM node:24-alpine AS web
WORKDIR /src
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache ca-certificates tzdata tini
WORKDIR /app
COPY --from=api /out/vps-studio /usr/local/bin/vps-studio
COPY --from=web /src/.next/standalone ./client
COPY --from=web /src/.next/static ./client/.next/static
COPY --from=web /src/public ./client/public
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/vps-studio.db
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "start.sh"]
