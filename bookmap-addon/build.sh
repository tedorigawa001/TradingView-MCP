#!/usr/bin/env bash
# The earlier macOS build, kept for anything that still calls it. It compiled its own source list, which drifted from
# the Node build: without the Bookmap SDK it left out FlowSweepReplay, which the engine test uses, so the tests failed
# to compile (BACKLOG 102-26). It now runs the Node build, so there is one source set and one set of JARs. Prefer
# `npm run build:bookmap-addon`, which works on every platform.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/bookmap-addon/build.mjs" "$@"
