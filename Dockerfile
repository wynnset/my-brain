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
COPY app/chat-sdk-runner.mjs app/mcp-brain-db.mjs ./
COPY app/dashboard.html app/login.html app/dashboard.css app/dashboard-app.js app/favicon.svg ./

# Seed files — copied to /data volume on first boot only
COPY team/        ./seed/team/
COPY docs/        ./seed/docs/
COPY CYRUS.md     ./seed/CYRUS.md
COPY data/config.json ./seed/config.json

# Scripts
COPY scripts/init-volume.sh ./init-volume.sh
COPY scripts/db             /usr/local/bin/db
RUN chmod +x init-volume.sh /usr/local/bin/db

ENV PORT=8080
ENV DATA_DIR=/data
ENV DB_DIR=/data
EXPOSE 8080

# Init + fix volume ownership (SFTP/seed often leaves root-owned files), then run as `node`
# so `claude -p --dangerously-skip-permissions` is allowed.
CMD ["sh", "-c", "./init-volume.sh && chown -R node:node /data && exec su-exec node node server.js"]
