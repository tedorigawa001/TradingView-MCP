package jp.bushido.bookmap;

import java.io.BufferedWriter;
import java.io.StringWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

import velox.api.layer1.data.TradeInfo;

/** Unit tests for the delayed/Replay flow-signal recorder. */
public final class FlowSignalResearchTest {
    public static void main(String[] args) throws Exception {
        usesOnlyBookmapSupportedParameterTypes();
        recordsAFlowSignalWithAuditableFields();
        usesBookmapTimeForReplayWindowExpiry();
        rejectsNonIntegralPriceLevelsWithoutInventingASignal();
        System.out.println("FlowSignalResearchTest: PASS");
    }

    private static void usesOnlyBookmapSupportedParameterTypes() throws Exception {
        assertEquals(String.class, FlowSignalResearch.class.getField("outputDirectory").getType());
        assertEquals(Integer.class, FlowSignalResearch.class.getField("minimumSweepTrades").getType());
        assertEquals(Double.class, FlowSignalResearch.class.getField("withdrawalRatio").getType());
        assertEquals(Integer.class, FlowSignalResearch.class.getField("absorptionWindowMilliseconds").getType());
        assertEquals(Integer.class, FlowSignalResearch.class.getField("sweepWindowMilliseconds").getType());
    }

    private static void recordsAFlowSignalWithAuditableFields() throws Exception {
        StringWriter output = new StringWriter();
        FlowSignalResearch research = research(output);
        research.onSnapshotEnd();
        research.onTrade(101.0, 1, new TradeInfo(false, true, false, false));
        research.onTrade(100.0, 1, new TradeInfo(false, true, false, false));
        research.stop();

        String line = lineWith(output.toString(), "\"event_type\":\"flow_signal\"");
        assertContains(line, "\"kind\":\"TRADE_SWEEP\"");
        assertContains(line, "\"direction\":\"SELL\"");
        assertContains(line, "\"price_level\":100");
        assertContains(line, "\"price\":0.001");
        assertContains(line, "\"callback_sequence\":2");
        assertContains(line, "\"episode_start_bookmap_time_ns\":\"1000000000\"");
        assertContains(line, "\"duration_ms\":0");
        assertContains(line, "\"trade_count\":2");
        assertContains(line, "\"price_levels\":2");
        assertContains(line, "\"aggressive_volume\":2");
    }

    private static void rejectsNonIntegralPriceLevelsWithoutInventingASignal() throws Exception {
        Method exactPriceLevel = FlowSignalResearch.class.getDeclaredMethod("exactPriceLevel", double.class);
        exactPriceLevel.setAccessible(true);
        assertEquals(null, exactPriceLevel.invoke(null, 100.5));
        assertEquals(100, exactPriceLevel.invoke(null, 100.0));
    }

    private static void usesBookmapTimeForReplayWindowExpiry() throws Exception {
        FlowSignalResearch research = new FlowSignalResearch();
        research.withdrawalWindowMilliseconds = 1_000;
        set(research, "latestBookmapTimeNs", 1_000_000_000L);
        Method createEngine = FlowSignalResearch.class.getDeclaredMethod("createEngine");
        createEngine.setAccessible(true);
        FlowSignalEngine engine = (FlowSignalEngine) createEngine.invoke(research);
        engine.onBbo(20, 20);
        engine.onBbo(20, 5);
        set(research, "latestBookmapTimeNs", 2_001_000_000L);
        assertEquals(null, engine.onTrade(100, 1, FlowSignalEngine.Direction.BUY));
    }

    private static FlowSignalResearch research(StringWriter output) throws Exception {
        FlowSignalResearch research = new FlowSignalResearch();
        set(research, "writer", new BufferedWriter(output));
        set(research, "alias", "6EQ6:CME");
        set(research, "tickSize", 0.00001d);
        set(research, "latestBookmapTimeNs", 1_000_000_000L);
        research.minimumSweepTrades = 2;
        research.minimumSweepPriceLevels = 2;
        research.minimumAbsorptionVolume = 1_000;
        research.minimumPassiveSize = 1;
        Method createEngine = FlowSignalResearch.class.getDeclaredMethod("createEngine");
        createEngine.setAccessible(true);
        set(research, "engine", createEngine.invoke(research));
        return research;
    }

    private static String lineWith(String text, String expected) {
        for (String line : text.split("\\n")) {
            if (line.contains(expected)) return line;
        }
        throw new AssertionError("No line contains " + expected + ": " + text);
    }

    private static void set(Object target, String name, Object value) throws Exception {
        Field field = FlowSignalResearch.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void assertContains(String actual, String expected) {
        if (!actual.contains(expected)) {
            throw new AssertionError("Expected <" + actual + "> to contain <" + expected + ">");
        }
    }

    private static void assertEquals(Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
        }
    }
}
