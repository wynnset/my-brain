#!/usr/bin/env bash
# fly-deploy.sh — single-command deploy that works around the flyctl 0.4.42
# planner bug for single-volume single-machine apps.
#
# What it does:
#   1) `fly deploy --build-only` to build + push the image.
#   2) Extracts the pushed image reference from the build output.
#   3) `fly machine update <id> --image <ref>` for every machine in the
#      app's `app` process group, in sequence.
#
# Why: `fly deploy` (>= 0.4.42) insists on creating a *new* machine and
# fails because the only `brain_data_v2` volume is already attached to the
# existing machine. `fly machine update` updates in place, keeps the volume
# attached, and survives the planner's bad mood. See fly.toml for the long
# version of this story.
#
# Run from the repo root so flyctl picks up fly.toml automatically.
set -euo pipefail

if ! command -v fly >/dev/null 2>&1; then
  echo "fly-deploy: flyctl not found in PATH" >&2
  exit 1
fi

if [ ! -f "fly.toml" ]; then
  echo "fly-deploy: must be run from the repo root (fly.toml not found in $(pwd))" >&2
  exit 1
fi

BUILD_LOG="$(mktemp -t fly-deploy.XXXXXX)"
trap 'rm -f "$BUILD_LOG"' EXIT

echo "==> Building and pushing image (fly deploy --build-only) ..."
if ! fly deploy --build-only "$@" 2>&1 | tee "$BUILD_LOG"; then
  echo "fly-deploy: build failed; aborting." >&2
  exit 1
fi

IMAGE_REF="$(awk '/^image: / { print $2; exit }' "$BUILD_LOG")"
if [ -z "${IMAGE_REF:-}" ]; then
  echo "fly-deploy: could not find 'image:' line in build output; aborting." >&2
  exit 1
fi
echo "==> Built image: $IMAGE_REF"

# Grab every machine in process group 'app' so this still works if the app
# is ever scaled out (each machine has its own volume on Fly).
mapfile -t MACHINES < <(
  fly machine list --json \
    | python3 -c '
import json, sys
for m in json.load(sys.stdin):
    if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app":
        print(m["id"])
'
)

if [ "${#MACHINES[@]}" -eq 0 ]; then
  echo "fly-deploy: no machines found in process group 'app'; aborting." >&2
  exit 1
fi

echo "==> Updating ${#MACHINES[@]} machine(s) in process group 'app' ..."
for MID in "${MACHINES[@]}"; do
  echo "--> fly machine update $MID"
  fly machine update "$MID" --image "$IMAGE_REF" --yes
done

echo "==> Done. Current status:"
fly status
