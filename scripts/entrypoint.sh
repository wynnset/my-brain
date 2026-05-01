#!/bin/sh
# entrypoint.sh — container entrypoint that conditionally enables Litestream.
#
# If BUCKET_NAME is set (i.e. `fly storage create` was run), we hand the
# process to Litestream which replicates SQLite DBs to Tigris and supervises
# the Node server via the `exec:` directive in /etc/litestream.yml.
#
# If BUCKET_NAME is missing (local dev, or someone deletes the bucket), we
# fall back to running the server directly so the app stays up. Backup is a
# defense-in-depth thing; it should never take the app down on its own.
set -eu

echo "[entrypoint] init-volume.sh ..."
./init-volume.sh

echo "[entrypoint] chowning /data to node:node ..."
chown -R node:node /data

if [ -n "${BUCKET_NAME:-}" ] && [ -x /usr/local/bin/litestream ] && [ -f /etc/litestream.yml ]; then
  echo "[entrypoint] Litestream replicate → s3://${BUCKET_NAME} (endpoint: ${AWS_ENDPOINT_URL_S3:-?})"
  exec /usr/local/bin/litestream replicate -config /etc/litestream.yml
else
  echo "[entrypoint] WARNING: Litestream disabled (BUCKET_NAME unset or binary/config missing). Running server without backup."
  exec gosu node node server.js
fi
