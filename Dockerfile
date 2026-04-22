FROM node:20-alpine

# System tools agents need; su-exec drops root after volume init (Claude CLI disallows
# --dangerously-skip-permissions when running as root).
RUN apk add --no-cache bash curl jq sqlite su-exec

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
COPY scripts/brain-add-user.cjs ./scripts/brain-add-user.cjs
COPY scripts/brain-delete-user.cjs ./scripts/brain-delete-user.cjs
COPY scripts/brain-set-limits.cjs ./scripts/brain-set-limits.cjs
COPY scripts/db             /usr/local/bin/db
RUN chmod +x init-volume.sh /usr/local/bin/db

ENV PORT=8080
ENV DATA_DIR=/data
ENV DB_DIR=/data
EXPOSE 8080

# Init + fix volume ownership (SFTP/seed often leaves root-owned files), then run as `node`
# so `claude -p --dangerously-skip-permissions` is allowed.
CMD ["sh", "-c", "./init-volume.sh && chown -R node:node /data && exec su-exec node node server.js"]
