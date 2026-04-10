#!/bin/sh
# init-volume.sh — seeds the persistent volume on first boot only.
# On subsequent boots (.initialized exists), exits immediately after repairs.

# ── Repairs (run every boot; volume may already be .initialized) ─────────────
# 1) Bogus file /data/team/team or /data/docs/docs — happens when a folder is
#    uploaded as a single file (SFTP / bad archive) instead of as a directory.
# 2) Nested directory /data/team/team from old `cp -r seed/team/ /data/team/`.
# 3) If team/docs still have no top-level *.md, merge from image seed (fills
#    empty dirs after (1) or partial uploads).

for d in team docs; do
  base="/data/$d"
  nested="$base/$d"
  mkdir -p "$base"

  if [ -f "$nested" ]; then
    echo "Removing bogus file $nested (folder was stored as a regular file)"
    rm -f "$nested"
  fi

  if [ -d "$nested" ]; then
    file_count=0
    for x in "$base"/*; do
      [ -f "$x" ] && file_count=$((file_count + 1))
    done
    if [ "$file_count" -eq 0 ]; then
      echo "Lifting nested $nested → $base (repair)"
      mv "$nested"/* "$base/" 2>/dev/null || true
      rmdir "$nested" 2>/dev/null || true
    fi
  fi

  # After first init only — avoids duplicating the full seed copy below on brand-new volumes.
  if [ -f /data/.initialized ]; then
    first_md=$(find "$base" -maxdepth 1 -type f -name '*.md' 2>/dev/null | head -n 1)
    if [ -z "$first_md" ] && [ -d "/app/seed/$d" ]; then
      echo "Merging /app/seed/$d into $base (no top-level .md yet)"
      cp -r "/app/seed/$d/." "$base/"
    fi
  fi
done

if [ -f /data/.initialized ]; then
  echo "Volume already initialized — skipping seed."
  exit 0
fi

echo "Initializing volume from image seed..."

mkdir -p /data/team /data/docs /data/owners-inbox /data/team-inbox

# Trailing /. copies directory *contents* into the target (avoids /data/team/team/).
cp -r /app/seed/team/. /data/team/
cp -r /app/seed/docs/. /data/docs/
cp    /app/seed/CYRUS.md   /data/CYRUS.md
cp    /app/seed/config.json /data/config.json

touch /data/.initialized
echo "Volume initialized."
