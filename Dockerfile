FROM node:20-alpine

# System tools agents need; su-exec drops root after volume init (Claude CLI disallows
# --dangerously-skip-permissions when running as root).
RUN apk add --no-cache bash curl jq sqlite su-exec

# Litestream — streams SQLite WAL frames to Tigris (Fly object storage) for
# near-real-time backup of every per-tenant DB on the volume. Pinned to a
# specific release so deploys are reproducible.
ARG LITESTREAM_VERSION=0.5.10
RUN curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz" \
      -o /tmp/litestream.tar.gz \
  && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
  && chmod +x /usr/local/bin/litestream \
  && rm /tmp/litestream.tar.gz \
  && /usr/local/bin/litestream version

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Node dependencies
COPY app/package.json ./
RUN npm install --omit=dev

# App code
COPY app/server.js ./
COPY app/server ./server
COPY app/public ./public
COPY app/chat-sdk-runner.mjs app/mcp-brain-db.mjs ./
# Tracked seeds (not under gitignored data/) so remote Fly builds receive them
COPY docker-seed/registry.sql ./data/registry.sql
COPY docker-seed/brain.sql ./docker-seed/brain.sql

# Seed files (under docker-seed/ so Fly/git builds work after local migration moved repo-root team/ & CYRUS.md)
COPY docker-seed/team/        ./seed/team/
COPY docker-seed/docs/        ./seed/docs/
COPY docker-seed/CYRUS.md    ./seed/CYRUS.md
COPY docker-seed/config.json  ./seed/config.json
COPY tenant-defaults/         ./tenant-defaults/

# Scripts
COPY scripts/init-volume.sh ./init-volume.sh
COPY scripts/entrypoint.sh ./entrypoint.sh
COPY scripts/brain-add-user.cjs ./scripts/brain-add-user.cjs
COPY scripts/brain-delete-user.cjs ./scripts/brain-delete-user.cjs
COPY scripts/brain-set-limits.cjs ./scripts/brain-set-limits.cjs
COPY scripts/db             /usr/local/bin/db
COPY scripts/litestream-restore.sh /usr/local/bin/litestream-restore
COPY litestream.yml         /etc/litestream.yml
RUN chmod +x init-volume.sh entrypoint.sh /usr/local/bin/db /usr/local/bin/litestream-restore

ENV PORT=8080
ENV DATA_DIR=/data
ENV DB_DIR=/data
EXPOSE 8080

# entrypoint.sh runs init-volume.sh, chowns /data, then either:
#   - hands off to `litestream replicate` (which supervises `node server.js`
#     via the `exec:` directive in litestream.yml) when BUCKET_NAME is set, or
#   - runs `node server.js` directly as a no-backup fallback.
CMD ["sh", "-c", "exec ./entrypoint.sh"]
