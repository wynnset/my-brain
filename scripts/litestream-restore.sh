#!/bin/sh
# litestream-restore.sh — restore a single SQLite DB from Tigris (Litestream v0.5).
#
# Usage (run inside a Fly machine that already has BUCKET_NAME / AWS_* secrets):
#
#   litestream-restore <db-path-on-volume> [<output-path>] [-timestamp 2026-04-01T12:00:00Z]
#
# Examples:
#   # Latest registry.db → /tmp (auto-named)
#   litestream-restore /data/registry.db
#
#   # Specific tenant DB at a point in time → custom path
#   litestream-restore /data/users/c874982d-23f7-459b-a4bb-11ae6f1e0576/data/brain.db \
#                      /tmp/brain.restored.db \
#                      -timestamp 2026-04-23T12:00:00Z
#
# Notes:
#   * /data/registry.db is in /etc/litestream.yml so we resolve via config (-config).
#   * Tenant DBs under /data/users/* are dir-discovered at runtime — we restore
#     by explicit s3:// URL using the AWS_* env vars Fly already injects.
#   * Refuses to overwrite existing files — pick a new output path.

set -eu

if [ -z "${BUCKET_NAME:-}" ] || [ -z "${AWS_ENDPOINT_URL_S3:-}" ]; then
  echo "ERROR: BUCKET_NAME / AWS_ENDPOINT_URL_S3 not set in env." >&2
  echo "       Run this inside a Fly machine that has the Tigris secrets." >&2
  exit 1
fi

DB_PATH="${1:-}"
OUT_PATH="${2:-}"
shift || true
shift || true
EXTRA_ARGS="$*"

if [ -z "$DB_PATH" ]; then
  echo "Usage: $0 <db-path-on-volume> [<output-path>] [-timestamp <RFC3339>]" >&2
  exit 2
fi

if [ -z "$OUT_PATH" ]; then
  OUT_PATH="/tmp/$(basename "$DB_PATH").restored.$(date -u +%Y%m%dT%H%M%SZ)"
fi

if [ -e "$OUT_PATH" ]; then
  echo "ERROR: $OUT_PATH already exists. Refusing to overwrite." >&2
  exit 3
fi

case "$DB_PATH" in
  /data/registry.db)
    # Config-driven: Litestream looks up the replica from /etc/litestream.yml.
    echo "[restore] config-driven restore for $DB_PATH"
    echo "[restore] output file: $OUT_PATH"
    echo "[restore] extra args:  ${EXTRA_ARGS:-(latest)}"
    exec /usr/local/bin/litestream restore \
      -config /etc/litestream.yml \
      -o "$OUT_PATH" \
      $EXTRA_ARGS \
      "$DB_PATH"
    ;;

  /data/users/*)
    REL="${DB_PATH#/data/users/}"
    REPLICA_URL="s3://${BUCKET_NAME}/tenants/${REL}"
    echo "[restore] URL-driven restore"
    echo "[restore] source replica: $REPLICA_URL"
    echo "[restore] endpoint:       $AWS_ENDPOINT_URL_S3"
    echo "[restore] output file:    $OUT_PATH"
    echo "[restore] extra args:     ${EXTRA_ARGS:-(latest)}"
    # AWS_ENDPOINT_URL_S3 / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    # are read from env by Litestream's S3 client.
    exec /usr/local/bin/litestream restore \
      -o "$OUT_PATH" \
      $EXTRA_ARGS \
      "$REPLICA_URL"
    ;;

  *)
    echo "ERROR: $DB_PATH is not a recognized backup path." >&2
    echo "       Expected /data/registry.db or /data/users/<tenant>/data/<name>.db" >&2
    exit 4
    ;;
esac
