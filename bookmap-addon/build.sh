#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOKMAP_HOME="${BOOKMAP_HOME:-/Applications/Bookmap.app/Contents/app}"
LIB="$BOOKMAP_HOME/lib"
OUT="$ROOT/bookmap-addon/dist"
CLASSES="$OUT/classes"
COLLECTOR_JAR="$OUT/bushidoyasu_flow_collector_delayed_replay_v1_1.jar"
SIGNAL_RESEARCH_JAR="$OUT/bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar"
SIGNAL_DISPLAY_JAR="$OUT/bushidoyasu_flow_signal_display_v1_0.jar"
LEGACY_SIGNAL_RESEARCH_JARS=(
  "$OUT/bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar"
  "$OUT/bushidoyasu_flow_signal_research_delayed_replay_v1_1.jar"
)
JAVA_21_HOME="${JAVA_21_HOME:-/usr/local/opt/openjdk@21}"
# The pinned JDK when it is installed, otherwise whatever is on PATH. CI has a
# JDK but not this one, and the engine is ordinary Java that any of them builds.
if [[ -x "$JAVA_21_HOME/bin/javac" ]]; then
  JAVAC="$JAVA_21_HOME/bin/javac"
  JAR="$JAVA_21_HOME/bin/jar"
else
  JAVAC="$(command -v javac || true)"
  JAR="$(command -v jar || true)"
fi

SIMPLIFIED_API="$LIB/bm-simplified-api-wrapper.jar"
L1_API="$LIB/bm-l1api.jar"

for tool in "$JAVAC" "$JAR"; do
  if [[ -z "$tool" || ! -x "$tool" ]]; then
    printf 'No JDK found. Install openjdk@21 or set JAVA_21_HOME to a JDK root.\n' >&2
    exit 1
  fi
done

# The Bookmap SDK is a licensed desktop install, so it cannot be present on a CI
# runner. Everything that imports it is skipped there rather than failing the
# build; FlowSignalEngine imports nothing from Bookmap and is always built and
# tested, which is where the signal logic actually lives.
SDK_PRESENT=1
for dependency in "$SIMPLIFIED_API" "$L1_API"; do
  if [[ ! -f "$dependency" ]]; then SDK_PRESENT=0; fi
done

rm -rf "$CLASSES"
mkdir -p "$CLASSES"

if [[ "$SDK_PRESENT" -eq 0 ]]; then
  rm -f "$COLLECTOR_JAR" "$SIGNAL_RESEARCH_JAR" "${LEGACY_SIGNAL_RESEARCH_JARS[@]}"
  printf 'Bookmap SDK not found under %s - building the SDK-free signal engine only\n' "$LIB"
  "$JAVAC" --release 17 -d "$CLASSES" \
    "$ROOT/bookmap-addon/src/main/java/jp/bushido/bookmap/FlowSignalEngine.java" \
    "$ROOT/bookmap-addon/src/main/java/jp/bushido/bookmap/FlowSignalMarker.java"
  printf 'Built FlowSignalEngine (no installable JAR without the SDK)\n'
  exit 0
fi

rm -f "${LEGACY_SIGNAL_RESEARCH_JARS[@]}"

"$JAVAC" --release 17 \
  -cp "$SIMPLIFIED_API:$L1_API" \
  -d "$CLASSES" \
  "$ROOT"/bookmap-addon/src/main/java/jp/bushido/bookmap/*.java

# The collector writes external JSONL. Keep the installable artifact narrowly
# scoped so it cannot be confused with a future approved display-only JAR.
"$JAR" --create --file "$COLLECTOR_JAR" \
  -C "$CLASSES" jp/bushido/bookmap/FlowCollector.class
printf 'Built delayed/Replay-only collector %s\n' "$COLLECTOR_JAR"

# The signal recorder is a separate delayed/Replay-only artifact. It includes
# the pure signal engine but never the raw-data collector.
(
  cd "$CLASSES"
  "$JAR" --create --file "$SIGNAL_RESEARCH_JAR" \
    jp/bushido/bookmap/FlowSignalResearch.class \
    jp/bushido/bookmap/FlowSignalEngine*.class \
    jp/bushido/bookmap/FlowSignalMarker*.class
)
printf 'Built delayed/Replay-only signal research %s\n' "$SIGNAL_RESEARCH_JAR"

# Display only. It keeps nothing, so it carries neither the collector nor the
# recorder, and the check below is on the bytecode rather than on intent.
(
  cd "$CLASSES"
  "$JAR" --create --file "$SIGNAL_DISPLAY_JAR" \
    jp/bushido/bookmap/FlowSignalDisplay.class \
    jp/bushido/bookmap/FlowSignalEngine*.class \
    jp/bushido/bookmap/FlowSignalMarker*.class
)
printf 'Built display-only signal marker %s\n' "$SIGNAL_DISPLAY_JAR"
