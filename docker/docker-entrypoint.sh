#!/bin/sh
# Prepares the data directory and drops root privileges before starting Vidalune.
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only touch files with the wrong owner, so restarts stay fast on large caches.
  find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
  # Keep the groups of the graphics devices passed in (/dev/dri), so video conversion can use them.
  GPU_GROUPS=$(stat -c %g /dev/dri/renderD* /dev/dri/card* 2> /dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
  if [ -n "$GPU_GROUPS" ]; then
    exec setpriv --reuid="$PUID" --regid="$PGID" --groups="$GPU_GROUPS" -- "$@"
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

exec "$@"
