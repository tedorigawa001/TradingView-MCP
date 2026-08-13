#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOKMAP_HOME="${BOOKMAP_HOME:-/Applications/Bookmap.app/Contents/app}"
LIB="$BOOKMAP_HOME/lib"
JAVA_21_HOME="${JAVA_21_HOME:-/usr/local/opt/openjdk@21}"
if [[ -x "$JAVA_21_HOME/bin/javac" ]]; then
  JAVAC="$JAVA_21_HOME/bin/javac"
  JAVA="$JAVA_21_HOME/bin/java"
  JAR="$JAVA_21_HOME/bin/jar"
else
  JAVAC="$(command -v javac)"
  JAVA="$(command -v java)"
  JAR="$(command -v jar)"
fi
TEST_CLASSES="$ROOT/bookmap-addon/dist/test-classes"
COLLECTOR_JAR="$ROOT/bookmap-addon/dist/bushidoyasu_flow_collector_delayed_replay_v1_1.jar"
SIGNAL_RESEARCH_JAR="$ROOT/bookmap-addon/dist/bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar"

"$ROOT/bookmap-addon/build.sh"

# Without the licensed SDK only the engine exists, so only its test can run. It
# is the one that carries the signal logic; the two skipped tests cover the thin
# Bookmap adapters around it.
if [[ ! -f "$LIB/bm-simplified-api-wrapper.jar" ]]; then
  rm -rf "$TEST_CLASSES"
  mkdir -p "$TEST_CLASSES"
  "$JAVAC" --release 17 -cp "$ROOT/bookmap-addon/dist/classes" -d "$TEST_CLASSES" \
    "$ROOT/bookmap-addon/src/test/java/jp/bushido/bookmap/FlowSignalEngineTest.java"
  "$JAVA" -ea -cp "$TEST_CLASSES:$ROOT/bookmap-addon/dist/classes" \
    jp.bushido.bookmap.FlowSignalEngineTest
  printf 'SKIPPED (no Bookmap SDK): FlowCollectorTest, FlowSignalResearchTest\n'
  exit 0
fi

if "$JAR" --list --file "$COLLECTOR_JAR" | grep -q 'FlowSignalEngine'; then
  printf 'Collector JAR must not contain display/research signal classes\n' >&2
  exit 1
fi
if "$JAR" --list --file "$SIGNAL_RESEARCH_JAR" | grep -q 'FlowCollector'; then
  printf 'Signal research JAR must not contain the raw-data collector\n' >&2
  exit 1
fi
rm -rf "$TEST_CLASSES"
mkdir -p "$TEST_CLASSES"

"$JAVAC" --release 17 \
  -cp "$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  -d "$TEST_CLASSES" \
  "$ROOT"/bookmap-addon/src/test/java/jp/bushido/bookmap/*.java

"$JAVA" -ea \
  -cp "$TEST_CLASSES:$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  jp.bushido.bookmap.FlowCollectorTest

"$JAVA" -ea \
  -cp "$TEST_CLASSES:$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  jp.bushido.bookmap.FlowSignalEngineTest

"$JAVA" -ea \
  -cp "$TEST_CLASSES:$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  jp.bushido.bookmap.FlowSignalResearchTest
