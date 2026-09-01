# Dockerfile — packages the EXISTING app (server/ + app/) behind a single
# public port, for hosts that only expose one port per service (e.g.
# Render's free tier). It installs the server's own dependencies with its
# own lockfile and copies both halves in verbatim — nothing here changes
# application code, only how it's packaged for this kind of host. Local
# development doesn't use this file at all; see README.md.
#
# Both stages build FROM THE SAME caddy:2-alpine base, with Node added via
# apk in that exact base, rather than copying a binary in from an unrelated
# image — some sandboxed container runtimes (this one included) refuse to
# exec a binary that arrived via a cross-image COPY --from with
# "Operation not permitted", even after chmod +x. Installing everything
# through the base image's own package manager avoids that entirely, and
# also means node_modules is built and run against the exact same Node.
# Build context must be the repository root.

FROM caddy:2-alpine AS base
RUN apk add --no-cache nodejs npm

FROM base AS server-deps
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM base
WORKDIR /srv
COPY --from=server-deps /srv/server/node_modules ./server/node_modules
COPY server ./server
COPY app ./app
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/start.sh /srv/start.sh
RUN chmod +x /srv/start.sh

ENV NODE_ENV=production
EXPOSE 10000
CMD ["/srv/start.sh"]
