package jp.bushido.bookmap;

import velox.api.layer1.annotations.Layer1ApiVersion;
import velox.api.layer1.annotations.Layer1ApiVersionValue;
import velox.api.layer1.annotations.Layer1SimpleAttachable;
import velox.api.layer1.annotations.Layer1StrategyName;
import velox.api.layer1.data.InstrumentInfo;
import velox.api.layer1.data.TradeInfo;
import velox.api.layer1.messages.indicators.Layer1ApiUserMessageModifyIndicator.GraphType;
import velox.api.layer1.simplified.Api;
import velox.api.layer1.simplified.BboListener;
import velox.api.layer1.simplified.CustomModule;
import velox.api.layer1.simplified.DepthDataListener;
import velox.api.layer1.simplified.InitialState;
import velox.api.layer1.simplified.Indicator;
import velox.api.layer1.simplified.Parameter;
import velox.api.layer1.simplified.SnapshotEndListener;
import velox.api.layer1.simplified.TimeListener;
import velox.api.layer1.simplified.TradeDataListener;

/**
 * Draws provisional flow signals and keeps nothing.
 *
 * Everything this module observes stays inside Bookmap: it writes no file, opens
 * no socket, and holds no history beyond what the engine needs for its own
 * windows. That is the whole difference from {@link FlowSignalResearch}, which
 * exists to produce an evidence file and is therefore restricted to delayed and
 * Replay data.
 *
 * The separation is also the experiment. Bookmap marks an instrument
 * {@code isApiProtected} and refuses most API modules on it; whether a module
 * that exports nothing is refused too is not something the current evidence can
 * answer, because both existing modules write files. If this one is admitted
 * where they are not, output is the boundary. If it is refused as well, the
 * boundary is the module rather than what it does, and no amount of restraint
 * in the add-on will change it.
 *
 * Deliberately without {@code @UnrestrictedData}. That annotation exists to lift
 * data restrictions, and this repository's own note reserves it for a build that
 * has been through the Developer Agreement and Bookmap's approval. Adding it
 * here would answer a different question - whether the exception works - rather
 * than the one being asked, and would use an exception nobody granted.
 */
@Layer1SimpleAttachable
@Layer1StrategyName("Bushido Flow Signal Display")
@Layer1ApiVersion(Layer1ApiVersionValue.VERSION1)
public final class FlowSignalDisplay implements CustomModule, DepthDataListener,
        TradeDataListener, BboListener, TimeListener, SnapshotEndListener {

    @Parameter(name = "Minimum sweep trades", minimum = 1, maximum = 100, step = 1)
    public Integer minimumSweepTrades = 3;

    @Parameter(name = "Minimum sweep price levels", minimum = 2, maximum = 100, step = 1)
    public Integer minimumSweepPriceLevels = 3;

    @Parameter(name = "Minimum absorption volume", minimum = 1, maximum = 1000000, step = 1)
    public Integer minimumAbsorptionVolume = 100;

    @Parameter(name = "Minimum passive size", minimum = 1, maximum = 1000000, step = 1)
    public Integer minimumPassiveSize = 25;

    @Parameter(name = "Withdrawal ratio", minimum = 0.01, maximum = 0.99, step = 0.01)
    public Double withdrawalRatio = 0.5;

    @Parameter(name = "Withdrawal window milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer withdrawalWindowMilliseconds = 10_000;

    @Parameter(name = "Absorption window milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer absorptionWindowMilliseconds = 10_000;

    @Parameter(name = "Sweep window milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer sweepWindowMilliseconds = 10_000;

    @Parameter(name = "Episode gap milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer episodeGapMilliseconds = 30_000;

    private FlowSignalEngine engine;
    private Indicator markerIndicator;
    private boolean markerFailed;
    private long latestBookmapTimeNs = -1L;

    @Override
    public synchronized void initialize(String alias, InstrumentInfo info, Api api,
            InitialState initialState) {
        engine = createEngine();
        try {
            markerIndicator = api.registerIndicator("Bushido Flow Signals", GraphType.PRIMARY);
        } catch (RuntimeException error) {
            markerFailed = true;
            System.err.println("Bushido Flow Signal Display could not register its indicator: "
                    + error.getMessage());
        }
    }

    FlowSignalEngine createEngine() {
        return new FlowSignalEngine(new FlowSignalEngine.Settings(
                minimumSweepTrades, minimumSweepPriceLevels,
                minimumAbsorptionVolume, minimumPassiveSize, withdrawalRatio,
                withdrawalWindowMilliseconds, absorptionWindowMilliseconds,
                sweepWindowMilliseconds, episodeGapMilliseconds),
                () -> latestBookmapTimeNs);
    }

    @Override
    public synchronized void onTimestamp(long timestampNs) {
        latestBookmapTimeNs = timestampNs;
    }

    @Override
    public synchronized void onSnapshotEnd() {
        if (engine != null) engine.onSnapshotEnd();
    }

    @Override
    public synchronized void onDepth(boolean isBid, int price, int size) {
        if (engine != null && hasBookmapTime()) engine.onDepth(isBid, price, size);
    }

    @Override
    public synchronized void onBbo(int bidPrice, int bidSize, int askPrice, int askSize) {
        if (engine != null && hasBookmapTime()) engine.onBbo(bidSize, askSize);
    }

    @Override
    public synchronized void onTrade(double price, int size, TradeInfo tradeInfo) {
        if (engine == null || !hasBookmapTime()) return;
        // A price between levels is not a level. The research module refuses it
        // rather than rounding, and so does this one.
        if (price != Math.rint(price) || !Double.isFinite(price)) return;
        int priceLevel = (int) Math.rint(price);
        FlowSignalEngine.Direction direction = tradeInfo == null ? null
                : (tradeInfo.isBidAggressor
                        ? FlowSignalEngine.Direction.SELL : FlowSignalEngine.Direction.BUY);
        FlowSignalEngine.Signal signal = engine.onTrade(priceLevel, size, direction);
        if (signal == null || !signal.episode().startsEpisode()) return;
        display(signal);
    }

    private void display(FlowSignalEngine.Signal signal) {
        if (markerIndicator == null || markerFailed) return;
        FlowSignalMarker.Marker marker = FlowSignalMarker.forSignal(signal);
        try {
            markerIndicator.addIcon(signal.priceLevel(), marker.image(),
                    marker.horizontalOffsetPixels(), marker.verticalOffsetPixels());
        } catch (RuntimeException error) {
            markerFailed = true;
            System.err.println("Bushido Flow Signal Display markers disabled: "
                    + error.getMessage());
        }
    }

    private boolean hasBookmapTime() {
        return latestBookmapTimeNs >= 0;
    }

    @Override
    public synchronized void stop() {
        engine = null;
        markerIndicator = null;
    }
}
