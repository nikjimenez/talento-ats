# Dockerfile — packages the EXISTING app (server/ + app/) behind a single
# public port, for hosts that only expose one port per service (e.g.
# Render's free tier). It installs the server's own dependencies with its
# own lockfile and copies both halves in verbatim — nothing here changes
# application code, only how it's packaged for this kind of host. Local
# development doesn't use this file at all; see README.md.
#
# Node comes from the official node:20-alpine image throughout (the same
# image node_modules is built against), and the Caddy binary is copied
# from Caddy's own official image rather than installed via a package
# manager, so there's no risk of a Node/native-addon ABI mismatch or an
# unpinned Caddy version. Build context must be the repository root.

FROM node:20-alpine AS server-deps
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM caddy:2-alpine AS caddy-bin

FROM node:20-alpine
COPY --from=caddy-bin /usr/bin/caddy /usr/local/bin/caddy

WORKDIR /srv
COPY --from=server-deps /srv/server/node_modules ./server/node_modules
COPY server ./server
COPY app ./app
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/start.sh /srv/start.sh
RUN chmod +x /srv/start.sh /usr/local/bin/caddy

ENV NODE_ENV=production
EXPOSE 10000
CMD ["/srv/start.sh"]
