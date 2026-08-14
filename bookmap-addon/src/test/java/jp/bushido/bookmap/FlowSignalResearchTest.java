package jp.bushido.bookmap;

import java.io.BufferedWriter;
import java.io.StringWriter;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

import velox.api.layer1.data.TradeInfo;
import velox.api.layer1.simplified.AxisRules;
import velox.api.layer1.simplified.Indicator;
import velox.api.layer1.simplified.LineStyle;
import velox.api.layer1.simplified.WidgetRules;

/** Unit tests for the delayed/Replay flow-signal recorder. */
public final class FlowSignalResearchTest {
    public static void main(String[] args) throws Exception {
        usesOnlyBookmapSupportedParameterTypes();
        recordsAFlowSignalWithAuditableFields();
        displaysExactlyOneMarkerAtTheSignalPrice();
        drawsOneMarkerPerEpisodeWhileRecordingEveryContinuation();
        markerSettingDoesNotDisableEvidenceRecording();
        markerFailureDoesNotDisableEvidenceRecording();
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
        assertEquals(Boolean.class, FlowSignalResearch.class.getField("showChartMarkers").getType());
    }

    private static void displaysExactlyOneMarkerAtTheSignalPrice() throws Exception {
        StringWriter output = new StringWriter();
        FlowSignalResearch research = research(output);
        RecordingIndicator indicator = new RecordingIndicator();
        set(research, "markerIndicator", indicator);

        research.onTrade(101.0, 1, new TradeInfo(false, true, false, false));
        research.onTrade(100.0, 1, new TradeInfo(false, true, false, false));

        assertEquals(1, indicator.icons);
        assertEquals(100.0, indicator.value);
        assertTrue(indicator.image != null, "signal marker image must be present");
        assertTrue(indicator.yOffset < 0, "SELL marker must render above its price");
    }

    /**
     * Continuations of a run arrive seconds apart at nearly the same price. The
     * evidence file keeps every one of them; the chart gets the first only,
     * because stacked badges were unreadable on the real feed.
     */
    private static void drawsOneMarkerPerEpisodeWhileRecordingEveryContinuation() throws Exception {
        StringWriter output = new StringWriter();
        FlowSignalResearch research = research(output);
        RecordingIndicator indicator = new RecordingIndicator();
        set(research, "markerIndicator", indicator);

        for (int round = 0; round < 3; round += 1) {
            research.onTimestamp(1_000_000_000L + round * 4_000_000_000L);
            // The bid side halves, which arms a SELL withdrawal; isBidAggressor
            // maps to SELL, so the trade that follows is the one that can match it.
            research.onBbo(99, 100, 101, 100);
            research.onBbo(99, 10, 101, 100);
            research.onTrade(99.0, 3, new TradeInfo(false, true, false, false));
        }

        long recorded = output.toString().lines()
                .filter(line -> line.contains("\"event_type\":\"flow_signal\"")).count();
        assertEquals(3L, recorded);
        assertEquals(1, indicator.icons);
        long drawn = output.toString().lines()
                .filter(line -> line.contains("\"chart_marker_drawn\":true")).count();
        assertEquals(1L, drawn);
        assertTrue(output.toString().contains("\"episode_signal_index\":3"),
                "the third signal must be recorded as the third of its episode");
    }

    private static void markerSettingDoesNotDisableEvidenceRecording() throws Exception {
        StringWriter output = new StringWriter();
        FlowSignalResearch research = research(output);
        RecordingIndicator indicator = new RecordingIndicator();
        research.showChartMarkers = false;
        set(research, "markerIndicator", indicator);

        emitSellSweep(research);

        assertEquals(0, indicator.icons);
        assertContains(output.toString(), "\"event_type\":\"flow_signal\"");
    }

    private static void markerFailureDoesNotDisableEvidenceRecording() throws Exception {
        StringWriter output = new StringWriter();
        FlowSignalResearch research = research(output);
        set(research, "markerIndicator", new FailingIndicator());

        emitSellSweep(research);

        assertContains(output.toString(), "\"event_type\":\"flow_signal\"");
    }

    private static void emitSellSweep(FlowSignalResearch research) {
        research.onTrade(101.0, 1, new TradeInfo(false, true, false, false));
        research.onTrade(100.0, 1, new TradeInfo(false, true, false, false));
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

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertEquals(Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
        }
    }

    private static final class RecordingIndicator implements Indicator {
        private int icons;
        private double value;
        private BufferedImage image;
        private int yOffset;

        @Override public void addPoint(double value) {}
        @Override public void addIcon(double value, BufferedImage image, int x, int y) {
            icons += 1;
            this.value = value;
            this.image = image;
            this.yOffset = y;
        }
        @Override public void setColor(Color color) {}
        @Override public void setWidth(int width) {}
        @Override public void setLineStyle(LineStyle style) {}
        @Override public void setRenderPriority(int priority) {}
        @Override public void setAxisRules(AxisRules rules) {}
        @Override public void setWidgetRules(WidgetRules rules) {}
    }

    private static final class FailingIndicator implements Indicator {
        @Override public void addPoint(double value) {}
        @Override public void addIcon(double value, BufferedImage image, int x, int y) {
            throw new IllegalStateException("synthetic marker failure");
        }
        @Override public void setColor(Color color) {}
        @Override public void setWidth(int width) {}
        @Override public void setLineStyle(LineStyle style) {}
        @Override public void setRenderPriority(int priority) {}
        @Override public void setAxisRules(AxisRules rules) {}
        @Override public void setWidgetRules(WidgetRules rules) {}
    }
}
