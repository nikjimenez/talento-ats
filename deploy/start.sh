#!/bin/sh
# deploy/start.sh — starts the unmodified Node server on an internal port,
# then runs the Caddy reverse proxy in the foreground (see Caddyfile for
# why this two-process setup exists). Only used inside deploy/Dockerfile;
# local development uses `npm run dev` / `npm run dev:all` as documented
# in README.md — this script changes nothing about how the app itself runs.
set -e

# app/js/config.js's API_ORIGIN is documented (README.md) to be
# 'http://localhost:3000' for local development and empty in production,
# where the frontend and API share one origin — exactly this container's
# setup. There's no build step to inject that per environment, so patch
# only this deployed copy of the file (never the repo source app/ ships
# from, which local development still reads unmodified) rather than
# hardcoding a different value into the app itself.
sed -i "s#API_ORIGIN: 'http://localhost:3000',#API_ORIGIN: '',#" /srv/app/js/config.js

cd /srv/server

# migrate.js is designed to run every boot: it records each applied
# migration's hash and skips anything already applied (server/migrate.js).
# seed.js is likewise idempotent (ON CONFLICT DO NOTHING / equivalent
# guards — see server/test/db-functions.test.js's "seed: is idempotent"
# coverage), so running it on every boot is safe rather than a one-off
# step that has to happen out of band.
node --env-file-if-exists=.env migrate.js
node --env-file-if-exists=.env seed.js

PORT=3000 node --env-file-if-exists=.env index.js &
NODE_PID=$!

# If Node dies, the container should die too rather than keep serving a
# static frontend whose API calls all fail — Render then restarts it.
( while kill -0 "$NODE_PID" 2>/dev/null; do sleep 2; done; echo "node exited, stopping"; kill 0 ) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
