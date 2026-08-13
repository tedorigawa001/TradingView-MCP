package jp.bushido.bookmap;

import java.awt.Color;

/** Unit tests for the SDK-free chart marker presentation contract. */
public final class FlowSignalMarkerTest {
    public static void main(String[] args) {
        rendersSweepAsObservedAggressorDirection();
        rendersAbsorptionAsNeutralObservedFact();
        rendersWithdrawalAsNeutralPossibleFact();
        System.out.println("FlowSignalMarkerTest: PASS");
    }

    private static void rendersSweepAsObservedAggressorDirection() {
        FlowSignalMarker.Marker buy = FlowSignalMarker.forSignal(signal(
                FlowSignalEngine.SignalKind.TRADE_SWEEP, FlowSignalEngine.Direction.BUY));
        FlowSignalMarker.Marker sell = FlowSignalMarker.forSignal(signal(
                FlowSignalEngine.SignalKind.TRADE_SWEEP, FlowSignalEngine.Direction.SELL));

        assertEquals("BUY SWEEP", buy.primaryLabel());
        assertEquals("OBSERVED AGGRESSION", buy.secondaryLabel());
        assertEquals(new Color(0x13, 0x8A, 0x4B), buy.background());
        assertTrue(buy.verticalOffsetPixels() > 0, "BUY must render below its price");
        assertEquals("SELL SWEEP", sell.primaryLabel());
        assertEquals("OBSERVED AGGRESSION", sell.secondaryLabel());
        assertEquals(new Color(0xD1, 0x43, 0x43), sell.background());
        assertTrue(sell.verticalOffsetPixels() < 0, "SELL must render above its price");
    }

    private static void rendersAbsorptionAsNeutralObservedFact() {
        FlowSignalMarker.Marker buy = markerFor(
                FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                FlowSignalEngine.Direction.BUY);
        FlowSignalMarker.Marker sell = markerFor(
                FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                FlowSignalEngine.Direction.SELL);
        assertEquals("BUY ABSORBED", buy.primaryLabel());
        assertEquals("POSSIBLE ABSORPTION", buy.secondaryLabel());
        assertEquals("SELL ABSORBED", sell.primaryLabel());
        assertEquals("POSSIBLE ABSORPTION", sell.secondaryLabel());
        assertEquals(new Color(0x5F, 0x6B, 0x78), buy.background());
        assertEquals(buy.background(), sell.background());
        assertEquals(buy.verticalOffsetPixels(), sell.verticalOffsetPixels());
        assertEquals(-88, buy.verticalOffsetPixels());
    }

    private static void rendersWithdrawalAsNeutralPossibleFact() {
        FlowSignalMarker.Marker buy = markerFor(
                FlowSignalEngine.SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL,
                FlowSignalEngine.Direction.BUY);
        FlowSignalMarker.Marker sell = markerFor(
                FlowSignalEngine.SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL,
                FlowSignalEngine.Direction.SELL);
        assertEquals("ASK WITHDRAWAL", buy.primaryLabel());
        assertEquals("POSSIBLE", buy.secondaryLabel());
        assertEquals("BID WITHDRAWAL", sell.primaryLabel());
        assertEquals("POSSIBLE", sell.secondaryLabel());
        assertEquals(new Color(0x8A, 0x6D, 0x1D), buy.background());
        assertEquals(buy.background(), sell.background());
        assertEquals(buy.verticalOffsetPixels(), sell.verticalOffsetPixels());
        assertEquals(-130, buy.verticalOffsetPixels());
        assertTrue(buy.verticalOffsetPixels() != markerFor(
                FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                FlowSignalEngine.Direction.BUY).verticalOffsetPixels(),
                "neutral mechanisms must use separate display lanes");
    }

    private static FlowSignalMarker.Marker markerFor(FlowSignalEngine.SignalKind kind,
            FlowSignalEngine.Direction direction) {
        return FlowSignalMarker.forSignal(signal(kind, direction));
    }

    private static FlowSignalEngine.Signal signal(FlowSignalEngine.SignalKind kind,
            FlowSignalEngine.Direction direction) {
        return new FlowSignalEngine.Signal(kind, direction, 100, 1, 1, 0, 1, 1, 1);
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertEquals(Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
        }
    }
}
