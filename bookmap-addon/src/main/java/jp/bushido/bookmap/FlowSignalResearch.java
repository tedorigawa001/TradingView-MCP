package jp.bushido.bookmap;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

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
 * Delayed/Replay-only recorder for provisional flow-signal occurrences.
 *
 * It intentionally has external file output and must never be installed on a
 * BookmapData real-time instrument.
 */
@Layer1SimpleAttachable
@Layer1StrategyName("Bushido Flow Signal Research (Delayed/Replay)")
@Layer1ApiVersion(Layer1ApiVersionValue.VERSION1)
public final class FlowSignalResearch implements CustomModule, DepthDataListener,
        TradeDataListener, BboListener, TimeListener, SnapshotEndListener {

    private static final DateTimeFormatter RECEIPT_TIME_FORMAT = DateTimeFormatter
            .ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    @Parameter(name = "Output directory")
    public String outputDirectory = "/Volumes/HD/bookmap_data";

    @Parameter(name = "Minimum sweep trades", minimum = 1, maximum = 10000, step = 1)
    public Integer minimumSweepTrades = 3;

    @Parameter(name = "Minimum sweep price levels", minimum = 2, maximum = 10000, step = 1)
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

    @Parameter(name = "Episode gap milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer episodeGapMilliseconds = 30_000;

    @Parameter(name = "Sweep window milliseconds", minimum = 1, maximum = 600000, step = 1)
    public Integer sweepWindowMilliseconds = 10_000;

    @Parameter(name = "Show chart markers")
    public Boolean showChartMarkers = true;

    private BufferedWriter writer;
    private String alias;
    private double tickSize;
    private long latestBookmapTimeNs = -1L;
    private FlowSignalEngine engine;
    private Indicator markerIndicator;
    private boolean writeFailed;
    private boolean markerFailed;

    @Override
    public synchronized void initialize(String alias, InstrumentInfo info, Api api,
            InitialState initialState) {
        this.alias = alias;
        this.tickSize = info.pips;
        engine = createEngine();
        try {
            Path directory = Paths.get(outputDirectory).toAbsolutePath().normalize();
            Files.createDirectories(directory);
            Path output = directory.resolve("bookmap-flow-signals-" + safeFilePart(alias)
                    + "-" + Instant.now().toEpochMilli() + ".jsonl");
            writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            write("instrument", "\"alias\":" + jsonString(alias) + ","
                    + "\"symbol\":" + jsonString(info.symbol) + ","
                    + "\"exchange\":" + jsonString(info.exchange) + ","
                    + "\"data_delay_raw\":" + info.dataDelay + ","
                    + "\"mode\":\"delayed_or_replay_only\","
                    + "\"aggressor_mapping\":\"bid_aggressor_is_sell\","
                    + "\"output_file\":" + jsonString(output.toString()));
        } catch (IOException | RuntimeException error) {
            writeFailed = true;
            System.err.println("Bushido Flow Signal Research could not initialize: "
                    + error.getMessage());
        }
        if (Boolean.TRUE.equals(showChartMarkers)) {
            try {
                markerIndicator = api.registerIndicator("Bushido Flow Signals", GraphType.PRIMARY);
                markerIndicator.setRenderPriority(100);
            } catch (RuntimeException error) {
                markerFailed = true;
                System.err.println("Bushido Flow Signal Research chart markers disabled: "
                        + error.getMessage());
            }
        }
    }

    @Override
    public synchronized void onTimestamp(long timestampNs) {
        latestBookmapTimeNs = timestampNs;
    }

    @Override
    public synchronized void onSnapshotEnd() {
        if (engine != null) engine.onSnapshotEnd();
        write("snapshot_end", "\"meaning\":\"bookmap_initial_snapshot_complete\"");
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
        Integer priceLevel = exactPriceLevel(price);
        if (priceLevel == null) return;
        // Bookmap defines bid aggressor as a sell market order hitting the bid.
        FlowSignalEngine.Direction direction = tradeInfo == null ? null
                : (tradeInfo.isBidAggressor
                        ? FlowSignalEngine.Direction.SELL : FlowSignalEngine.Direction.BUY);
        FlowSignalEngine.Signal signal = engine.onTrade(priceLevel, size, direction);
        if (signal == null) return;
        // One marker per episode. Continuations are recorded but not drawn: they
        // land at nearly the same price and time and would stack unreadably, which
        // is what prompted this aggregation.
        // Whether a marker actually reached the chart, not whether one was wanted.
        // Markers can be switched off, the indicator can be absent, and addIcon can
        // throw; recording the intent would have logged all three as drawn.
        boolean markerDrawn = signal.episode().startsEpisode() && display(signal);
        write("flow_signal", "\"kind\":" + jsonString(signal.kind().name()) + ","
                + "\"direction\":" + jsonString(signal.direction().name()) + ","
                + "\"price_level\":" + signal.priceLevel() + ","
                + "\"price\":" + jsonNumber(signal.priceLevel() * tickSize) + ","
                + "\"callback_sequence\":" + signal.sequence() + ","
                + "\"episode_start_bookmap_time_ns\":"
                + jsonString(Long.toString(signal.episodeStartedAtNanos())) + ","
                + "\"duration_ms\":" + signal.durationMilliseconds() + ","
                + "\"trade_count\":" + signal.tradeCount() + ","
                + "\"price_levels\":" + signal.priceLevels() + ","
                + "\"episode_sequence\":" + signal.episode().sequence() + ","
                + "\"episode_signal_index\":" + signal.episode().signalIndex() + ","
                + "\"episode_duration_ms\":" + signal.episode().durationMilliseconds() + ","
                + "\"episode_trade_count\":" + signal.episode().tradeCount() + ","
                + "\"episode_price_levels\":" + signal.episode().priceLevels() + ","
                + "\"episode_aggressive_volume\":" + signal.episode().aggressiveVolume() + ","
                + "\"chart_marker_drawn\":" + markerDrawn + ","
                + "\"aggressive_volume\":" + signal.aggressiveVolume());
    }

    private boolean display(FlowSignalEngine.Signal signal) {
        if (markerIndicator == null || markerFailed || !Boolean.TRUE.equals(showChartMarkers)) return false;
        FlowSignalMarker.Marker marker = FlowSignalMarker.forSignal(signal);
        try {
            // PRIMARY indicator values use Bookmap integer price levels, not decimal prices.
            markerIndicator.addIcon(signal.priceLevel(), marker.image(),
                    marker.horizontalOffsetPixels(), marker.verticalOffsetPixels());
            return true;
        } catch (RuntimeException error) {
            markerFailed = true;
            System.err.println("Bushido Flow Signal Research chart markers disabled: "
                    + error.getMessage());
            return false;
        }
    }

    @Override
    public synchronized void stop() {
        write("signal_research_stop", "\"reason\":\"bookmap_module_stopped\"");
        if (writer != null) {
            try {
                writer.close();
            } catch (IOException error) {
                System.err.println("Bushido Flow Signal Research could not close output: "
                        + error.getMessage());
            } finally {
                writer = null;
            }
        }
    }

    private void write(String eventType, String fields) {
        if (writer == null || writeFailed) return;
        try {
            writer.write("{\"schema_version\":\"1.2\",\"source\":\"bookmap_flow_signal_research\","
                    + "\"event_type\":" + jsonString(eventType) + ","
                    + "\"instrument_alias\":" + jsonString(alias) + ","
                    + "\"bookmap_time_ns\":"
                    + (latestBookmapTimeNs >= 0 ? jsonString(Long.toString(latestBookmapTimeNs)) : "null")
                    + ",\"received_at\":" + jsonString(RECEIPT_TIME_FORMAT.format(Instant.now()))
                    + "," + fields + "}\n");
            writer.flush();
        } catch (IOException error) {
            writeFailed = true;
            System.err.println("Bushido Flow Signal Research write disabled: "
                    + error.getMessage());
        }
    }

    private FlowSignalEngine createEngine() {
        return new FlowSignalEngine(new FlowSignalEngine.Settings(
                minimumSweepTrades, minimumSweepPriceLevels,
                minimumAbsorptionVolume, minimumPassiveSize, withdrawalRatio,
                withdrawalWindowMilliseconds, absorptionWindowMilliseconds,
                sweepWindowMilliseconds, episodeGapMilliseconds),
                () -> latestBookmapTimeNs);
    }

    private boolean hasBookmapTime() {
        return latestBookmapTimeNs >= 0;
    }

    private static Integer exactPriceLevel(double price) {
        if (!Double.isFinite(price) || price < Integer.MIN_VALUE || price > Integer.MAX_VALUE
                || price != Math.rint(price)) return null;
        return (int) price;
    }

    private static String safeFilePart(String value) {
        return value == null ? "unknown" : value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static String jsonString(String value) {
        if (value == null) return "null";
        StringBuilder escaped = new StringBuilder("\"");
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '\\': escaped.append("\\\\"); break;
                case '"': escaped.append("\\\""); break;
                case '\b': escaped.append("\\b"); break;
                case '\f': escaped.append("\\f"); break;
                case '\n': escaped.append("\\n"); break;
                case '\r': escaped.append("\\r"); break;
                case '\t': escaped.append("\\t"); break;
                default:
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
            }
        }
        return escaped.append('"').toString();
    }

    private static String jsonNumber(double value) {
        return Double.isFinite(value) ? Double.toString(value) : "null";
    }
}
