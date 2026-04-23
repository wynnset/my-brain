#!/bin/sh
# init-volume.sh — prepares the persistent volume on boot.
#
# Multi-tenant only: tenants live under /data/users/<uuid>/{workspace,data}/.
# Provision them with scripts/brain-add-user.cjs. The server creates registry.db
# on first boot.

mkdir -p /data/users
if [ ! -f /data/.initialized ]; then
  touch /data/.initialized
  echo "Multi-user volume: /data/users ready (add tenants with brain-add-user.cjs)."
fi
exit 0
