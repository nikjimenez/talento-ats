# Dockerfile — packages the EXISTING app (server/ + app/ + the Python
# extractor) behind a single public port, for hosts that only expose one
# port per service (e.g. Render's free tier). It installs each half's own
# dependencies with its own lockfile/requirements and copies the source in
# verbatim — nothing here changes application code, only how it's packaged
# for this kind of host. Local development doesn't use this file at all;
# see README.md.
#
# All stages build FROM THE SAME caddy:2-alpine base, with Node and Python
# added via apk in that exact base, rather than copying a binary in from
# an unrelated image — some sandboxed container runtimes (this one
# included) refuse to exec a binary that arrived via a cross-image
# COPY --from with "Operation not permitted", even after chmod +x.
# Installing everything through the base image's own package manager
# avoids that entirely, and also means node_modules and the extractor's
# venv are both built and run against the exact same Node/Python.
# Build context must be the repository root.

FROM caddy:2-alpine AS base
RUN apk add --no-cache nodejs npm python3 py3-pip libcap && \
    (setcap -r /usr/bin/caddy || true) && \
    apk del libcap

FROM base AS server-deps
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# The extractor's dependencies (pdfplumber, lxml, uvicorn[standard], ...)
# don't all ship prebuilt musl/Alpine wheels, so this stage carries the
# full toolchain needed to compile whatever pip can't find a wheel for —
# only this build stage pays for that, not the final image.
FROM base AS extractor-deps
RUN apk add --no-cache gcc musl-dev python3-dev libffi-dev openssl-dev \
    libxml2-dev libxslt-dev jpeg-dev zlib-dev cargo rust
WORKDIR /srv/server/extractor
COPY server/extractor/requirements.txt ./
RUN python3 -m venv .venv && \
    .venv/bin/pip install --no-cache-dir --upgrade pip && \
    .venv/bin/pip install --no-cache-dir -r requirements.txt

FROM base
WORKDIR /srv
COPY --from=server-deps /srv/server/node_modules ./server/node_modules
COPY --from=extractor-deps /srv/server/extractor/.venv ./server/extractor/.venv
COPY server ./server
COPY app ./app
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/start.sh /srv/start.sh
RUN chmod +x /srv/start.sh

ENV NODE_ENV=production
EXPOSE 10000
CMD ["/srv/start.sh"]
