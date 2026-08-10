#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOKMAP_HOME="${BOOKMAP_HOME:-/Applications/Bookmap.app/Contents/app}"
LIB="$BOOKMAP_HOME/lib"
JAVA_21_HOME="${JAVA_21_HOME:-/usr/local/opt/openjdk@21}"
JAVAC="$JAVA_21_HOME/bin/javac"
JAVA="$JAVA_21_HOME/bin/java"
TEST_CLASSES="$ROOT/bookmap-addon/dist/test-classes"

"$ROOT/bookmap-addon/build.sh"
rm -rf "$TEST_CLASSES"
mkdir -p "$TEST_CLASSES"

"$JAVAC" --release 17 \
  -cp "$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  -d "$TEST_CLASSES" \
  "$ROOT/bookmap-addon/src/test/java/jp/bushido/bookmap/FlowCollectorTest.java"

"$JAVA" -ea \
  -cp "$TEST_CLASSES:$ROOT/bookmap-addon/dist/classes:$LIB/bm-simplified-api-wrapper.jar:$LIB/bm-l1api.jar" \
  jp.bushido.bookmap.FlowCollectorTest
