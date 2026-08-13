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

# Without the complete licensed SDK only the engine exists, so only its test can
# run. Keep this dependency check aligned with build.sh; a partial SDK install
# cannot compile or test the Bookmap adapters.
SDK_PRESENT=1
for dependency in "$LIB/bm-simplified-api-wrapper.jar" "$LIB/bm-l1api.jar"; do
  if [[ ! -f "$dependency" ]]; then SDK_PRESENT=0; fi
done
if [[ "$SDK_PRESENT" -eq 0 ]]; then
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
