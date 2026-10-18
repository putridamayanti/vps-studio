#!/bin/sh
# Runs the Go API and the Next.js dashboard together; the container stops when either exits.
set -u

# Both servers read PORT, so set each one explicitly. The dashboard proxies to the API on
# localhost:8081 (baked into the client build), so the API port is fixed.
PORT=8081 vps-studio &
api=$!

cd /app/client
PORT="${PORT:-3100}" HOSTNAME=0.0.0.0 node server.js &
web=$!

stopping=0
stop() {
  kill -TERM "$api" "$web" 2>/dev/null
}
trap 'stopping=1; stop' TERM INT

while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
  sleep 1
done

stop
wait "$api"
api_status=$?
wait "$web"
web_status=$?
# A requested stop (docker stop) is a clean exit; otherwise report the process that failed.
[ "$stopping" -eq 1 ] && exit 0
[ "$api_status" -ne 0 ] && exit "$api_status"
exit "$web_status"
