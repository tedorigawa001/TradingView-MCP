package jp.bushido.bookmap;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.function.LongSupplier;

/** Unit tests for display-only flow conditions; run with {@code java -ea}. */
public final class FlowSignalEngineTest {
    public static void main(String[] args) {
        detectsOnlyMonotonicKnownTradeSweep();
        sweepExpiresByElapsedTimeAndRecordsEpisodeMetrics();
        requiresSnapshotAndKnownAggressionForPossibleAbsorption();
        labelsWithdrawalWithoutClaimingSpoofing();
        ignoresZeroSizeCallbacksForWithdrawal();
        withdrawalWindowCountsTradesRatherThanDepthOrBboCallbacks();
        withdrawalExpiresByElapsedTime();
        absorptionRequiresAConcentratedTradeBurst();
        absorptionRearmsAfterThePassiveLevelIsRecreated();
        removesZeroSizeDepthLevels();
        unknownAggressionEndsAnEpisodeInsteadOfJoiningOne();
        System.out.println("FlowSignalEngineTest: PASS");
    }

    private static FlowSignalEngine engine() {
        return new FlowSignalEngine(new FlowSignalEngine.Settings(3, 3, 10, 5, 0.5,
                10_000, 10_000));
    }

    private static void detectsOnlyMonotonicKnownTradeSweep() {
        FlowSignalEngine engine = engine();
        assertNull(engine.onTrade(100, 1, FlowSignalEngine.Direction.BUY));
        assertNull(engine.onTrade(101, 1, FlowSignalEngine.Direction.BUY));
        assertEquals(FlowSignalEngine.SignalKind.TRADE_SWEEP,
                engine.onTrade(102, 1, FlowSignalEngine.Direction.BUY).kind());
        assertNull(engine.onTrade(103, 1, null));
        assertNull(engine.onTrade(102, 1, FlowSignalEngine.Direction.BUY));
    }

    private static void requiresSnapshotAndKnownAggressionForPossibleAbsorption() {
        FlowSignalEngine engine = engine();
        engine.onDepth(false, 100, 10);
        assertNull(engine.onTrade(100, 10, FlowSignalEngine.Direction.BUY));
        engine.onSnapshotEnd();
        assertNull(engine.onTrade(100, 1, null));
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                engine.onTrade(100, 10, FlowSignalEngine.Direction.BUY).kind());
    }

    private static void sweepExpiresByElapsedTimeAndRecordsEpisodeMetrics() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(3, 3, 100, 25, 0.5, 10_000, 10_000, 1_000), clock);
        assertNull(engine.onTrade(100, 2, FlowSignalEngine.Direction.SELL));
        assertNull(engine.onTrade(99, 3, FlowSignalEngine.Direction.SELL));
        clock.advanceMilliseconds(1_001);
        assertNull(engine.onTrade(98, 5, FlowSignalEngine.Direction.SELL));
        assertNull(engine.onTrade(97, 7, FlowSignalEngine.Direction.SELL));
        FlowSignalEngine.Signal signal = engine.onTrade(96, 11, FlowSignalEngine.Direction.SELL);
        assertEquals(FlowSignalEngine.SignalKind.TRADE_SWEEP, signal.kind());
        assertEquals(3, signal.tradeCount());
        assertEquals(3, signal.priceLevels());
        assertEquals(23L, signal.aggressiveVolume());
        assertEquals(0L, signal.durationMilliseconds());
    }

    private static void labelsWithdrawalWithoutClaimingSpoofing() {
        FlowSignalEngine engine = engine();
        engine.onBbo(20, 20);
        engine.onBbo(20, 5);
        FlowSignalEngine.Signal signal = engine.onTrade(101, 1, FlowSignalEngine.Direction.BUY);
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL, signal.kind());
        assertEquals(FlowSignalEngine.Direction.BUY, signal.direction());
        assertEquals(1, signal.tradeCount());
        assertEquals(1L, signal.aggressiveVolume());
    }

    private static void withdrawalWindowCountsTradesRatherThanDepthOrBboCallbacks() {
        FlowSignalEngine engine = engine();
        engine.onBbo(20, 20);
        engine.onBbo(20, 5);
        for (int price = 100; price < 110; price++) {
            engine.onDepth(false, price, 10);
            engine.onBbo(20, 5);
        }
        FlowSignalEngine.Signal signal = engine.onTrade(101, 1, FlowSignalEngine.Direction.BUY);
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL, signal.kind());
    }

    private static void ignoresZeroSizeCallbacksForWithdrawal() {
        FlowSignalEngine engine = engine();
        engine.onBbo(20, 20);
        engine.onBbo(20, 5);
        assertNull(engine.onTrade(101, 0, FlowSignalEngine.Direction.BUY));
        FlowSignalEngine.Signal signal = engine.onTrade(101, 7, FlowSignalEngine.Direction.BUY);
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL, signal.kind());
        assertEquals(7L, signal.aggressiveVolume());
    }

    private static void absorptionRequiresAConcentratedTradeBurst() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(100, 2, 10, 5, 0.5, 10_000, 5_000), clock);
        engine.onDepth(false, 100, 10);
        engine.onSnapshotEnd();
        for (int burst = 0; burst < 3; burst++) {
            assertNull(engine.onTrade(100, 4, FlowSignalEngine.Direction.BUY));
            for (int gap = 0; gap < 5; gap++) {
                assertNull(engine.onTrade(200, 1, FlowSignalEngine.Direction.BUY));
            }
            clock.advanceMilliseconds(5_001);
        }
        assertNull(engine.onTrade(100, 4, FlowSignalEngine.Direction.BUY));
        assertNull(engine.onTrade(100, 4, FlowSignalEngine.Direction.BUY));
        FlowSignalEngine.Signal signal = engine.onTrade(100, 4, FlowSignalEngine.Direction.BUY);
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION, signal.kind());
        assertEquals(3, signal.tradeCount());
        assertEquals(12L, signal.aggressiveVolume());
    }

    private static void absorptionRearmsAfterThePassiveLevelIsRecreated() {
        FlowSignalEngine engine = engine();
        engine.onDepth(false, 100, 10);
        engine.onSnapshotEnd();
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                engine.onTrade(100, 10, FlowSignalEngine.Direction.BUY).kind());
        engine.onDepth(false, 100, 0);
        engine.onDepth(false, 100, 10);
        assertEquals(FlowSignalEngine.SignalKind.POSSIBLE_PASSIVE_ABSORPTION,
                engine.onTrade(100, 10, FlowSignalEngine.Direction.BUY).kind());
    }

    private static void withdrawalExpiresByElapsedTime() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(100, 2, 10, 5, 0.5, 1_000, 1_000), clock);
        engine.onBbo(20, 20);
        engine.onBbo(20, 5);
        clock.advanceMilliseconds(1_001);
        assertNull(engine.onTrade(101, 1, FlowSignalEngine.Direction.BUY));
    }

    private static void removesZeroSizeDepthLevels() {
        FlowSignalEngine engine = engine();
        engine.onDepth(false, 100, 10);
        assertEquals(1, mapSize(engine, "askDepth"));
        engine.onDepth(false, 100, 0);
        assertEquals(0, mapSize(engine, "askDepth"));
    }

    @SuppressWarnings("unchecked")
    private static int mapSize(FlowSignalEngine engine, String fieldName) {
        try {
            Field field = FlowSignalEngine.class.getDeclaredField(fieldName);
            field.setAccessible(true);
            return ((Map<Integer, Integer>) field.get(engine)).size();
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("Unable to inspect " + fieldName, error);
        }
    }

    /**
     * A trade Bookmap could not attribute is not a quiet trade on one side. It
     * ends whatever was in progress, so it can neither complete a sweep nor
     * satisfy an armed withdrawal, and it emits nothing of its own.
     */
    private static void unknownAggressionEndsAnEpisodeInsteadOfJoiningOne() {
        FlowSignalEngine engine = engine();
        assertNull(engine.onTrade(100, 1, FlowSignalEngine.Direction.BUY));
        assertNull(engine.onTrade(101, 1, FlowSignalEngine.Direction.BUY));
        // Two thirds of a sweep, then an unattributed trade at the next level up.
        assertNull(engine.onTrade(102, 1, null));
        // Had the unknown trade been counted, this fourth level would complete it.
        assertNull(engine.onTrade(103, 1, FlowSignalEngine.Direction.BUY));

        FlowSignalEngine armed = engine();
        armed.onBbo(100, 100);
        armed.onBbo(100, 10);
        assertNull(armed.onTrade(200, 1, null));
        // The withdrawal was disarmed by the unknown trade, not merely postponed.
        assertNull(armed.onTrade(200, 1, FlowSignalEngine.Direction.BUY));
    }

    private static void assertNull(Object value) {
        if (value != null) throw new AssertionError("Expected null, got " + value);
    }

    private static void assertEquals(Object expected, Object actual) {
        if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual);
    }

    private static final class TestClock implements LongSupplier {
        private long nanos;

        @Override
        public long getAsLong() {
            return nanos;
        }

        private void advanceMilliseconds(long milliseconds) {
            nanos += milliseconds * 1_000_000L;
        }
    }
}
