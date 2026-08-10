package jp.bushido.bookmap;

import java.io.BufferedWriter;
import java.io.StringWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import velox.api.layer1.data.InstrumentInfo;
import velox.api.layer1.data.TradeInfo;

/** Minimal no-dependency unit tests run with {@code java -ea}. */
public final class FlowCollectorTest {
    public static void main(String[] args) throws Exception {
        escapesJsonStringsAndSanitizesFileNames();
        usesOnlyBookmapSupportedParameterTypes();
        serializesDepthWithNormalizedPriceAndTimestamp();
        writesSnapshotCompletionMarker();
        preservesUnknownTradeMetadataInsteadOfInventingASide();
        preservesProvidedTradeMetadata();
        recordsInstrumentEvidenceRequiredToInterpretTheFeed();
        serializesNonFinitePricesAsJsonNull();
        writesStopMarkerAndFlushesPendingRecords();
        System.out.println("FlowCollectorTest: PASS");
    }

    private static void escapesJsonStringsAndSanitizesFileNames() throws Exception {
        Method json = FlowCollector.class.getDeclaredMethod("json", String.class);
        json.setAccessible(true);
        assertEquals("a\\\\b\\\"c\\nd\\re\\t\\u0001", json.invoke(null, "a\\b\"c\nd\re\t\u0001"));

        Method safeFilePart = FlowCollector.class.getDeclaredMethod("safeFilePart", String.class);
        safeFilePart.setAccessible(true);
        assertEquals("6EQ6_CME_BMD", safeFilePart.invoke(null, "6EQ6:CME/BMD"));
    }

    private static void usesOnlyBookmapSupportedParameterTypes() throws Exception {
        assertEquals(String.class, FlowCollector.class.getField("outputDirectory").getType());
        assertEquals(Integer.class, FlowCollector.class.getField("flushEveryRecords").getType());
    }

    private static void preservesUnknownTradeMetadataInsteadOfInventingASide() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        collector.onTrade(115_600.0, 3, null);
        collector.stop();

        String line = output.toString().split("\\n")[0];
        assertContains(line, "\"aggressor\":\"unknown\"");
        assertContains(line, "\"trade_info_available\":false");
        assertContains(line, "\"is_otc\":null");
        assertContains(line, "\"is_execution_start\":null");
        assertContains(line, "\"is_execution_end\":null");
    }

    private static void preservesProvidedTradeMetadata() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        collector.onTrade(115_600.0, 3, new TradeInfo(true, true, true, false));
        collector.stop();

        String line = output.toString().split("\\n")[0];
        assertContains(line, "\"aggressor\":\"buy\"");
        assertContains(line, "\"trade_info_available\":true");
        assertContains(line, "\"is_otc\":true");
        assertContains(line, "\"is_execution_start\":true");
        assertContains(line, "\"is_execution_end\":false");
    }

    private static void recordsInstrumentEvidenceRequiredToInterpretTheFeed() throws Exception {
        Path directory = Files.createTempDirectory("flow-collector-test-");
        try {
            FlowCollector collector = new FlowCollector();
            collector.outputDirectory = directory.toString();
            collector.initialize("6EQ6:CME", new InstrumentInfo("6EQ6", "CME", "BMD",
                    0.00001d, 125_000d, "Euro FX", true, 1d, false), null, null);

            String record = Files.readString(singleFile(directory));
            assertContains(record, "\"symbol\":\"6EQ6\"");
            assertContains(record, "\"exchange\":\"CME\"");
            assertContains(record, "\"instrument_type\":\"BMD\"");
            assertContains(record, "\"is_full_depth\":true");
            assertContains(record, "\"depth_listener_representation\":\"price_level_aggregated\"");
            assertContains(record, "\"mbo_captured\":false");
            assertContains(record, "\"is_crypto\":false");
            assertContains(record, "\"size_multiplier\":1.0");
            assertContains(record, "\"data_delay_raw\":");
            collector.stop();
        } finally {
            try (Stream<Path> entries = Files.list(directory)) {
                for (Path entry : (Iterable<Path>) entries::iterator) {
                    Files.deleteIfExists(entry);
                }
            }
            Files.deleteIfExists(directory);
        }
    }

    private static void serializesNonFinitePricesAsJsonNull() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        set(collector, "tickSize", Double.NaN);
        collector.onDepth(false, 115_700, 7);
        collector.stop();

        String line = output.toString().split("\\n")[0];
        assertContains(line, "\"price\":null");
        assertFalse(line.contains("NaN"));
        assertFalse(line.contains("Infinity"));
    }

    private static void serializesDepthWithNormalizedPriceAndTimestamp() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        collector.onTimestamp(1_234_567_890L);
        collector.onDepth(true, 115_600, 42);
        collector.stop();

        String line = output.toString().split("\\n")[0];
        assertContains(line, "\"event_type\":\"depth\"");
        assertContains(line, "\"instrument_alias\":\"6EQ6:CME\"");
        assertContains(line, "\"bookmap_time_ns\":\"1234567890\"");
        assertContains(line, "\"side\":\"bid\"");
        assertContains(line, "\"price_level\":115600");
        assertContains(line, "\"price\":1.156");
        assertContains(line, "\"size\":42");
    }

    private static void writesSnapshotCompletionMarker() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        collector.onSnapshotEnd();
        collector.stop();
        assertContains(output.toString(), "\"event_type\":\"snapshot_end\"");
    }

    private static void writesStopMarkerAndFlushesPendingRecords() throws Exception {
        StringWriter output = new StringWriter();
        FlowCollector collector = collector(output);
        collector.flushEveryRecords = 1000;
        collector.onDepth(false, 115_700, 0);
        collector.stop();

        String text = output.toString();
        assertContains(text, "\"event_type\":\"depth\"");
        assertContains(text, "\"side\":\"ask\"");
        assertContains(text, "\"size\":0");
        assertContains(text, "\"event_type\":\"collector_stop\"");
    }

    private static Path singleFile(Path directory) throws Exception {
        try (Stream<Path> entries = Files.list(directory)) {
            return entries.findFirst().orElseThrow(() -> new AssertionError("No collector output file"));
        }
    }

    private static FlowCollector collector(StringWriter output) throws Exception {
        FlowCollector collector = new FlowCollector();
        set(collector, "writer", new BufferedWriter(output));
        set(collector, "alias", "6EQ6:CME");
        set(collector, "tickSize", 0.00001d);
        collector.flushEveryRecords = 1;
        return collector;
    }

    private static void set(Object target, String name, Object value) throws Exception {
        Field field = FlowCollector.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void assertContains(String actual, String expected) {
        if (!actual.contains(expected)) {
            throw new AssertionError("Expected <" + actual + "> to contain <" + expected + ">");
        }
    }

    private static void assertEquals(Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
        }
    }

    private static void assertFalse(boolean actual) {
        if (actual) {
            throw new AssertionError("Expected false");
        }
    }
}
