package jp.bushido.bookmap;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * Pure callback-order signal logic for delayed-data and Replay validation.
 *
 * This class has no Bookmap rendering, file, network, or order-management
 * dependency. A future display-only module may consume its signals, but must
 * keep them inside Bookmap when used with approved real-time data.
 */
public final class FlowSignalEngine {

    public enum Direction { BUY, SELL }

    public enum SignalKind {
        TRADE_SWEEP,
        POSSIBLE_PASSIVE_ABSORPTION,
        POSSIBLE_LIQUIDITY_WITHDRAWAL
    }

    public record Signal(SignalKind kind, Direction direction, int priceLevel,
            long sequence, long episodeStartedAtNanos, long durationMilliseconds,
            int tradeCount, int priceLevels, long aggressiveVolume, Episode episode) {
        /**
         * A signal not yet placed in a run. It stands as an episode of one rather
         * than carrying a null, so nothing downstream has to test for absence.
         */
        public Signal(SignalKind kind, Direction direction, int priceLevel, long sequence,
                long episodeStartedAtNanos, long durationMilliseconds, int tradeCount,
                int priceLevels, long aggressiveVolume) {
            this(kind, direction, priceLevel, sequence, episodeStartedAtNanos,
                    durationMilliseconds, tradeCount, priceLevels, aggressiveVolume,
                    new Episode(0L, 1, episodeStartedAtNanos, durationMilliseconds,
                            tradeCount, priceLevels, aggressiveVolume));
        }

        public Signal {
            if (episode == null) throw new IllegalArgumentException("signal requires an episode");
        }
    }

    /**
     * A run of same-kind, same-direction signals separated by no more than the
     * configured gap. Totals are running: they describe the episode up to and
     * including the signal carrying them, so the highest signalIndex for a given
     * sequence holds the final figures.
     *
     * An episode is kept per kind and direction, so a sweep between two ask
     * withdrawals does not split the withdrawal run. Only the first signal of an
     * episode is meant to be drawn; the rest are recorded and would otherwise
     * stack on top of one another at nearly the same price and time.
     */
    public record Episode(long sequence, int signalIndex, long startedAtNanos,
            long durationMilliseconds, int tradeCount, int priceLevels,
            long aggressiveVolume) {
        public boolean startsEpisode() {
            return signalIndex == 1;
        }
    }

    private static final int DEFAULT_ABSORPTION_WINDOW_MILLISECONDS = 10_000;
    private static final int DEFAULT_EPISODE_GAP_MILLISECONDS = 30_000;

    public record Settings(int minimumSweepTrades, int minimumSweepPriceLevels,
            int minimumAbsorptionVolume, int minimumPassiveSize,
            double withdrawalRatio, int withdrawalWindowMilliseconds,
            int absorptionWindowMilliseconds, int sweepWindowMilliseconds,
            int episodeGapMilliseconds) {
        public Settings(int minimumSweepTrades, int minimumSweepPriceLevels,
                int minimumAbsorptionVolume, int minimumPassiveSize,
                double withdrawalRatio, int withdrawalWindowMilliseconds) {
            this(minimumSweepTrades, minimumSweepPriceLevels,
                    minimumAbsorptionVolume, minimumPassiveSize,
                    withdrawalRatio, withdrawalWindowMilliseconds,
                    DEFAULT_ABSORPTION_WINDOW_MILLISECONDS,
                    DEFAULT_ABSORPTION_WINDOW_MILLISECONDS,
                    DEFAULT_EPISODE_GAP_MILLISECONDS);
        }

        public Settings(int minimumSweepTrades, int minimumSweepPriceLevels,
                int minimumAbsorptionVolume, int minimumPassiveSize,
                double withdrawalRatio, int withdrawalWindowMilliseconds,
                int absorptionWindowMilliseconds) {
            this(minimumSweepTrades, minimumSweepPriceLevels,
                    minimumAbsorptionVolume, minimumPassiveSize,
                    withdrawalRatio, withdrawalWindowMilliseconds,
                    absorptionWindowMilliseconds, DEFAULT_ABSORPTION_WINDOW_MILLISECONDS,
                    DEFAULT_EPISODE_GAP_MILLISECONDS);
        }

        public Settings(int minimumSweepTrades, int minimumSweepPriceLevels,
                int minimumAbsorptionVolume, int minimumPassiveSize,
                double withdrawalRatio, int withdrawalWindowMilliseconds,
                int absorptionWindowMilliseconds, int sweepWindowMilliseconds) {
            this(minimumSweepTrades, minimumSweepPriceLevels,
                    minimumAbsorptionVolume, minimumPassiveSize,
                    withdrawalRatio, withdrawalWindowMilliseconds,
                    absorptionWindowMilliseconds, sweepWindowMilliseconds,
                    DEFAULT_EPISODE_GAP_MILLISECONDS);
        }

        public Settings {
            if (minimumSweepTrades < 1 || minimumSweepPriceLevels < 2
                    || minimumAbsorptionVolume < 1 || minimumPassiveSize < 1
                    || !(withdrawalRatio > 0 && withdrawalRatio < 1)
                    || withdrawalWindowMilliseconds < 1 || absorptionWindowMilliseconds < 1
                    || sweepWindowMilliseconds < 1 || episodeGapMilliseconds < 1) {
                throw new IllegalArgumentException("invalid flow signal settings");
            }
        }
    }

    private static final Settings DEFAULTS = new Settings(3, 3, 100, 25, 0.5,
            10_000, DEFAULT_ABSORPTION_WINDOW_MILLISECONDS,
            DEFAULT_ABSORPTION_WINDOW_MILLISECONDS, DEFAULT_EPISODE_GAP_MILLISECONDS);

    private final Settings settings;
    private final LongSupplier monotonicNanos;
    private final Map<Integer, Integer> bidDepth = new HashMap<>();
    private final Map<Integer, Integer> askDepth = new HashMap<>();
    private final Map<AbsorptionKey, AbsorptionState> absorptionStates = new HashMap<>();
    private final Map<EpisodeKey, EpisodeState> episodes = new HashMap<>();
    private long episodeSequence;
    private long sequence;
    private boolean snapshotComplete;
    private Direction sweepDirection;
    private int sweepLastPrice;
    private int sweepTrades;
    private long sweepStartedAtNanos;
    private long sweepAggressiveVolume;
    private Set<Integer> sweepLevels = new HashSet<>();
    private int priorBidSize = -1;
    private int priorAskSize = -1;
    private Direction withdrawalDirection;
    private long withdrawalExpiresAt;
    private long withdrawalArmedAtNanos;

    public FlowSignalEngine() {
        this(DEFAULTS);
    }

    public FlowSignalEngine(Settings settings) {
        this(settings, System::nanoTime);
    }

    FlowSignalEngine(Settings settings, LongSupplier monotonicNanos) {
        this.settings = settings;
        this.monotonicNanos = monotonicNanos;
    }

    public void onSnapshotEnd() {
        snapshotComplete = true;
    }

    public void onDepth(boolean isBid, int priceLevel, int size) {
        sequence += 1;
        if (size < 0) throw new IllegalArgumentException("depth size must be non-negative");
        Map<Integer, Integer> depth = isBid ? bidDepth : askDepth;
        int previousSize = depth.getOrDefault(priceLevel, 0);
        if (size == 0) {
            depth.remove(priceLevel);
        } else {
            depth.put(priceLevel, size);
        }

        // A disappearance or replenishment is observable evidence of a new
        // passive-liquidity episode at this level, so it may re-arm absorption.
        AbsorptionKey key = new AbsorptionKey(priceLevel,
                isBid ? Direction.SELL : Direction.BUY);
        if (size == 0 || previousSize == 0 || size > previousSize) {
            absorptionStates.remove(key);
        }
    }

    /**
     * BBO-only withdrawal screen. A reduced ask with subsequent buy aggression
     * is a possible upward liquidity withdrawal; the symmetric case is sell.
     * It deliberately makes no spoofing or intent claim.
     */
    public void onBbo(int bidSize, int askSize) {
        sequence += 1;
        long nowNanos = monotonicNanos.getAsLong();
        if (bidSize < 0 || askSize < 0) throw new IllegalArgumentException("BBO size must be non-negative");
        if (priorAskSize >= settings.minimumPassiveSize
                && askSize <= priorAskSize * settings.withdrawalRatio) {
            withdrawalDirection = Direction.BUY;
            withdrawalArmedAtNanos = nowNanos;
            withdrawalExpiresAt = nowNanos + windowNanos(settings.withdrawalWindowMilliseconds);
        } else if (priorBidSize >= settings.minimumPassiveSize
                && bidSize <= priorBidSize * settings.withdrawalRatio) {
            withdrawalDirection = Direction.SELL;
            withdrawalArmedAtNanos = nowNanos;
            withdrawalExpiresAt = nowNanos + windowNanos(settings.withdrawalWindowMilliseconds);
        }
        priorBidSize = bidSize;
        priorAskSize = askSize;
    }

    /**
     * @param direction null means Bookmap did not provide a reliable aggressor.
     *                  Unknown data resets direction-dependent conditions rather than
     *                  being assigned to either side.
     */
    public Signal onTrade(int priceLevel, int size, Direction direction) {
        sequence += 1;
        long nowNanos = monotonicNanos.getAsLong();
        if (size < 0) throw new IllegalArgumentException("trade size must be non-negative");
        // Bookmap can emit an execution-chain boundary callback with zero new
        // quantity. It carries metadata, not an aggressive trade to score.
        if (size == 0) return null;
        if (direction == null) {
            resetSweep();
            withdrawalDirection = null;
            return null;
        }
        Signal withdrawal = maybeWithdrawal(priceLevel, size, direction, nowNanos);
        Signal sweep = updateSweep(priceLevel, size, direction, nowNanos);
        Signal absorption = maybeAbsorption(priceLevel, size, direction, nowNanos);
        // Exactly one display marker per callback keeps the first detectable
        // mechanism visible; priority is an implementation display choice, not
        // a ranking of economic importance.
        Signal signal = withdrawal != null ? withdrawal : sweep != null ? sweep : absorption;
        return signal == null ? null : withEpisode(signal, nowNanos);
    }

    private Signal withEpisode(Signal signal, long nowNanos) {
        EpisodeKey key = new EpisodeKey(signal.kind(), signal.direction());
        EpisodeState state = episodes.get(key);
        if (state == null || nowNanos - state.lastAtNanos()
                > windowNanos(settings.episodeGapMilliseconds)) {
            episodeSequence += 1;
            state = new EpisodeState(episodeSequence, 0, nowNanos, nowNanos, 0, 0L, new HashSet<>());
        }
        Set<Integer> levels = new HashSet<>(state.priceLevels());
        levels.add(signal.priceLevel());
        state = new EpisodeState(state.sequence(), state.signalIndex() + 1,
                state.startedAtNanos(), nowNanos,
                state.tradeCount() + signal.tradeCount(),
                state.aggressiveVolume() + signal.aggressiveVolume(), levels);
        episodes.put(key, state);
        Episode episode = new Episode(state.sequence(), state.signalIndex(),
                state.startedAtNanos(),
                (nowNanos - state.startedAtNanos()) / 1_000_000L,
                state.tradeCount(), levels.size(), state.aggressiveVolume());
        return new Signal(signal.kind(), signal.direction(), signal.priceLevel(),
                signal.sequence(), signal.episodeStartedAtNanos(),
                signal.durationMilliseconds(), signal.tradeCount(),
                signal.priceLevels(), signal.aggressiveVolume(), episode);
    }

    private Signal maybeWithdrawal(int priceLevel, int size, Direction direction, long nowNanos) {
        if (withdrawalDirection == null || nowNanos > withdrawalExpiresAt) {
            withdrawalDirection = null;
            return null;
        }
        if (withdrawalDirection != direction) return null;
        Direction emitted = withdrawalDirection;
        withdrawalDirection = null;
        return new Signal(SignalKind.POSSIBLE_LIQUIDITY_WITHDRAWAL, emitted,
                priceLevel, sequence, withdrawalArmedAtNanos,
                durationMilliseconds(withdrawalArmedAtNanos, nowNanos), 1, 1, size);
    }

    private Signal updateSweep(int priceLevel, int size, Direction direction, long nowNanos) {
        boolean continues = sweepDirection == direction
                && ((direction == Direction.BUY && priceLevel >= sweepLastPrice)
                || (direction == Direction.SELL && priceLevel <= sweepLastPrice))
                && nowNanos - sweepStartedAtNanos < windowNanos(settings.sweepWindowMilliseconds);
        if (!continues) {
            sweepDirection = direction;
            sweepLastPrice = priceLevel;
            sweepTrades = 1;
            sweepStartedAtNanos = nowNanos;
            sweepAggressiveVolume = size;
            sweepLevels = new HashSet<>();
            sweepLevels.add(priceLevel);
            return null;
        }
        sweepTrades += 1;
        sweepAggressiveVolume += size;
        sweepLevels.add(priceLevel);
        sweepLastPrice = priceLevel;
        if (sweepTrades < settings.minimumSweepTrades
                || sweepLevels.size() < settings.minimumSweepPriceLevels) return null;
        Signal signal = new Signal(SignalKind.TRADE_SWEEP, direction, priceLevel, sequence,
                sweepStartedAtNanos, durationMilliseconds(sweepStartedAtNanos, nowNanos),
                sweepTrades, sweepLevels.size(), sweepAggressiveVolume);
        resetSweep();
        return signal;
    }

    private Signal maybeAbsorption(int priceLevel, int size, Direction direction, long nowNanos) {
        if (!snapshotComplete) return null;
        // A buy aggressor consumes the ask; a sell aggressor consumes the bid.
        int passiveSize = (direction == Direction.BUY ? askDepth : bidDepth)
                .getOrDefault(priceLevel, 0);
        AbsorptionKey key = new AbsorptionKey(priceLevel, direction);
        if (passiveSize < settings.minimumPassiveSize) {
            absorptionStates.remove(key);
            return null;
        }
        AbsorptionState state = absorptionStates.get(key);
        if (state == null || nowNanos - state.firstObservedAtNanos()
                >= windowNanos(settings.absorptionWindowMilliseconds)) {
            state = new AbsorptionState(nowNanos, size, 1, false);
        } else {
            state = new AbsorptionState(state.firstObservedAtNanos(),
                    state.aggressiveVolume() + size, state.tradeCount() + 1, state.emitted());
        }
        absorptionStates.put(key, state);
        if (state.emitted() || state.aggressiveVolume() < settings.minimumAbsorptionVolume) return null;
        absorptionStates.put(key, new AbsorptionState(state.firstObservedAtNanos(),
                state.aggressiveVolume(), state.tradeCount(), true));
        return new Signal(SignalKind.POSSIBLE_PASSIVE_ABSORPTION, direction,
                priceLevel, sequence, state.firstObservedAtNanos(),
                durationMilliseconds(state.firstObservedAtNanos(), nowNanos), state.tradeCount(), 1,
                state.aggressiveVolume());
    }

    private void resetSweep() {
        sweepDirection = null;
        sweepLastPrice = 0;
        sweepTrades = 0;
        sweepStartedAtNanos = 0;
        sweepAggressiveVolume = 0;
        sweepLevels = new HashSet<>();
    }

    private record EpisodeKey(SignalKind kind, Direction direction) {}

    private record EpisodeState(long sequence, int signalIndex, long startedAtNanos,
            long lastAtNanos, int tradeCount, long aggressiveVolume,
            Set<Integer> priceLevels) {}

    private record AbsorptionKey(int priceLevel, Direction direction) {}

    private static long windowNanos(int milliseconds) {
        return milliseconds * 1_000_000L;
    }

    private static long durationMilliseconds(long startedAtNanos, long nowNanos) {
        return Math.max(0, nowNanos - startedAtNanos) / 1_000_000L;
    }

    private record AbsorptionState(long firstObservedAtNanos, long aggressiveVolume,
            int tradeCount, boolean emitted) {}
}
