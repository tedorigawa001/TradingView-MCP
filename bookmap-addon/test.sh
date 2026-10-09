#!/usr/bin/env bash
# The earlier macOS test run, kept for anything that still calls it. It built through build.sh and chose its own
# tests and JAR checks, which drifted from the Node run: without the Bookmap SDK the engine test failed to compile
# (BACKLOG 102-26). It now runs the Node tests, which build first. Prefer `npm run test:bookmap-addon`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/bookmap-addon/test.mjs" "$@"
