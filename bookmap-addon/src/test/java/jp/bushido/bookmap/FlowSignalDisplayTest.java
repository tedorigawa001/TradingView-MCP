package jp.bushido.bookmap;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;

import velox.api.layer1.data.TradeInfo;
import velox.api.layer1.simplified.AxisRules;
import velox.api.layer1.simplified.Indicator;
import velox.api.layer1.simplified.LineStyle;
import velox.api.layer1.simplified.WidgetRules;

/** Unit tests for the display-only module; they need the Bookmap SDK on the classpath. */
public final class FlowSignalDisplayTest {
    public static void main(String[] args) throws Exception {
        aTradeWithoutAPriceLevelBreaksTheDrawnSweep();
        System.out.println("FlowSignalDisplayTest: PASS");
    }

    /** BACKLOG 102-23: a sell or unknown trade off the price grid between two buys breaks their run. */
    private static void aTradeWithoutAPriceLevelBreaksTheDrawnSweep() throws Exception {
        TradeInfo buy = new TradeInfo(false, false, false, false);
        for (TradeInfo between : new TradeInfo[]{new TradeInfo(false, true, false, false), null}) {
            RecordingIndicator indicator = new RecordingIndicator();
            FlowSignalDisplay display = display(indicator);
            display.onTrade(100.0, 1, buy);
            display.onTrade(101.0, 1, buy);
            display.onTrade(101.5, 1, between);
            display.onTrade(102.0, 1, buy);
            assertEquals(0, indicator.icons);
        }
        // Without it the three buys are a sweep, and its marker is drawn.
        RecordingIndicator indicator = new RecordingIndicator();
        FlowSignalDisplay display = display(indicator);
        display.onTrade(100.0, 1, buy);
        display.onTrade(101.0, 1, buy);
        display.onTrade(102.0, 1, buy);
        assertEquals(1, indicator.icons);
        assertEquals(102.0, indicator.value);
    }

    private static FlowSignalDisplay display(Indicator indicator) throws Exception {
        FlowSignalDisplay display = new FlowSignalDisplay();
        set(display, "latestBookmapTimeNs", 1_000_000_000L);
        set(display, "markerIndicator", indicator);
        set(display, "engine", display.createEngine());
        return display;
    }

    private static void set(Object target, String name, Object value) throws Exception {
        Field field = FlowSignalDisplay.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void assertEquals(Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
        }
    }

    private static final class RecordingIndicator implements Indicator {
        private int icons;
        private double value;

        @Override public void addPoint(double value) {}
        @Override public void addIcon(double value, BufferedImage image, int x, int y) {
            icons += 1;
            this.value = value;
        }
        @Override public void setColor(Color color) {}
        @Override public void setWidth(int width) {}
        @Override public void setLineStyle(LineStyle style) {}
        @Override public void setRenderPriority(int priority) {}
        @Override public void setAxisRules(AxisRules rules) {}
        @Override public void setWidgetRules(WidgetRules rules) {}
    }
}
