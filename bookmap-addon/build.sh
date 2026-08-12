#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOKMAP_HOME="${BOOKMAP_HOME:-/Applications/Bookmap.app/Contents/app}"
LIB="$BOOKMAP_HOME/lib"
OUT="$ROOT/bookmap-addon/dist"
CLASSES="$OUT/classes"
COLLECTOR_JAR="$OUT/bushidoyasu_flow_collector_delayed_replay_v1_1.jar"
SIGNAL_RESEARCH_JAR="$OUT/bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar"
JAVA_21_HOME="${JAVA_21_HOME:-/usr/local/opt/openjdk@21}"
JAVAC="$JAVA_21_HOME/bin/javac"
JAR="$JAVA_21_HOME/bin/jar"

SIMPLIFIED_API="$LIB/bm-simplified-api-wrapper.jar"
L1_API="$LIB/bm-l1api.jar"

for dependency in "$SIMPLIFIED_API" "$L1_API"; do
  if [[ ! -f "$dependency" ]]; then
    printf 'Bookmap SDK dependency not found: %s\n' "$dependency" >&2
    exit 1
  fi
done

for tool in "$JAVAC" "$JAR"; do
  if [[ ! -x "$tool" ]]; then
    printf 'Java 21 build tool not found: %s\n' "$tool" >&2
    printf 'Install openjdk@21 or set JAVA_21_HOME to its JDK root.\n' >&2
    exit 1
  fi
done

rm -rf "$CLASSES"
mkdir -p "$CLASSES"

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
    jp/bushido/bookmap/FlowSignalEngine*.class
)
printf 'Built delayed/Replay-only signal research %s\n' "$SIGNAL_RESEARCH_JAR"
