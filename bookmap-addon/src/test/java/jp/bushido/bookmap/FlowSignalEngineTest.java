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
        consecutiveSignalsShareOneEpisodeAndOnlyTheFirstIsDrawn();
        anEpisodeGapAndTheOppositeSideEachStartTheirOwnEpisode();
        anEpisodeUnionsEveryLevelASweepCrossed();
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

    /**
     * A sweep crosses several levels and reports all of them. Folding only its
     * terminal price into the episode counted a three-level sweep as one, so the
     * episode figure contradicted the per-signal figure beside it.
     */
    private static void anEpisodeUnionsEveryLevelASweepCrossed() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(3, 3, 100, 25, 0.5, 10_000, 10_000, 10_000, 30_000), clock);
        engine.onSnapshotEnd();

        FlowSignalEngine.Signal sweep = null;
        for (int index = 0; index < 3; index += 1) {
            clock.advanceMilliseconds(300);
            sweep = engine.onTrade(100 + index, 4, FlowSignalEngine.Direction.BUY);
        }
        assertEquals(3, sweep.priceLevels());
        assertEquals(3, sweep.priceLevelsTouched().size());
        assertEquals(3, sweep.episode().priceLevels());

        // A second sweep over two of the same levels and one new one adds only the new one.
        for (int index = 0; index < 3; index += 1) {
            clock.advanceMilliseconds(300);
            sweep = engine.onTrade(101 + index, 4, FlowSignalEngine.Direction.BUY);
        }
        assertEquals(4, sweep.episode().priceLevels());
    }

    private static void armAskWithdrawal(FlowSignalEngine engine, TestClock clock) {
        engine.onBbo(100, 100);
        clock.advanceMilliseconds(50);
        engine.onBbo(100, 10);
        clock.advanceMilliseconds(1_000);
    }

    /**
     * The chart draws one marker per episode. Continuations land within a few
     * seconds at nearly the same price, so drawing each one stacks badges until
     * none of them can be read.
     */
    private static void consecutiveSignalsShareOneEpisodeAndOnlyTheFirstIsDrawn() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(3, 3, 100, 25, 0.5, 10_000, 10_000, 10_000, 30_000), clock);
        engine.onSnapshotEnd();

        armAskWithdrawal(engine, clock);
        FlowSignalEngine.Signal first = engine.onTrade(700, 3, FlowSignalEngine.Direction.BUY);
        assertEquals(1, first.episode().signalIndex());
        assertEquals(true, first.episode().startsEpisode());

        long sequence = first.episode().sequence();
        FlowSignalEngine.Signal last = null;
        for (int index = 2; index <= 4; index += 1) {
            clock.advanceMilliseconds(4_000);
            armAskWithdrawal(engine, clock);
            last = engine.onTrade(700 + index, 3, FlowSignalEngine.Direction.BUY);
            assertEquals(sequence, last.episode().sequence());
            assertEquals(index, last.episode().signalIndex());
            assertEquals(false, last.episode().startsEpisode());
        }
        // Totals are running, so the last signal of the run carries the whole of it.
        assertEquals(4, last.episode().tradeCount());
        assertEquals(4, last.episode().priceLevels());
        assertEquals(12L, last.episode().aggressiveVolume());
        assertEquals(true, last.episode().durationMilliseconds() > 0);
    }

    private static void anEpisodeGapAndTheOppositeSideEachStartTheirOwnEpisode() {
        TestClock clock = new TestClock();
        FlowSignalEngine engine = new FlowSignalEngine(
                new FlowSignalEngine.Settings(3, 3, 100, 25, 0.5, 10_000, 10_000, 10_000, 30_000), clock);
        engine.onSnapshotEnd();

        armAskWithdrawal(engine, clock);
        long first = engine.onTrade(700, 3, FlowSignalEngine.Direction.BUY).episode().sequence();

        // A quiet stretch longer than the gap ends the run rather than extending it.
        clock.advanceMilliseconds(40_000);
        armAskWithdrawal(engine, clock);
        FlowSignalEngine.Signal afterGap = engine.onTrade(700, 3, FlowSignalEngine.Direction.BUY);
        assertEquals(true, afterGap.episode().sequence() != first);
        assertEquals(1, afterGap.episode().signalIndex());

        // The bid side runs its own episode and does not interrupt the ask side.
        long askRun = afterGap.episode().sequence();
        clock.advanceMilliseconds(2_000);
        engine.onBbo(100, 100);
        clock.advanceMilliseconds(50);
        engine.onBbo(10, 100);
        clock.advanceMilliseconds(1_000);
        FlowSignalEngine.Signal bid = engine.onTrade(700, 3, FlowSignalEngine.Direction.SELL);
        assertEquals(true, bid.episode().sequence() != askRun);
        assertEquals(1, bid.episode().signalIndex());

        clock.advanceMilliseconds(2_000);
        armAskWithdrawal(engine, clock);
        FlowSignalEngine.Signal askAgain = engine.onTrade(700, 3, FlowSignalEngine.Direction.BUY);
        assertEquals(askRun, askAgain.episode().sequence());
        assertEquals(2, askAgain.episode().signalIndex());
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
