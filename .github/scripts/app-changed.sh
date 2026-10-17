#!/usr/bin/env bash
# Prints "true" when the app changed between two commits, else "false". Every release bumps the
# version in app/package.json, app/app.json and app/package-lock.json; a change there that is only
# that version (or versionCode) does not count, anything else in app/ does.
# Usage: app-changed.sh <from> <to>
set -euo pipefail
from=$1
to=$2
versions=(app/package.json app/app.json app/package-lock.json)
if ! git diff --quiet "$from" "$to" -- app/ "${versions[@]/#/:(exclude)}"; then
  echo true
  exit 0
fi
other=$(git diff -U0 "$from" "$to" -- "${versions[@]}" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[+-][[:space:]]*"(version|versionCode)":' || true)
if [ -n "$other" ]; then echo true; else echo false; fi
