package jp.bushido.bookmap;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

import velox.api.layer1.annotations.Layer1ApiVersion;
import velox.api.layer1.annotations.Layer1ApiVersionValue;
import velox.api.layer1.annotations.Layer1SimpleAttachable;
import velox.api.layer1.annotations.Layer1StrategyName;
import velox.api.layer1.data.InstrumentInfo;
import velox.api.layer1.data.TradeInfo;
import velox.api.layer1.simplified.Api;
import velox.api.layer1.simplified.BboListener;
import velox.api.layer1.simplified.CustomModule;
import velox.api.layer1.simplified.DepthDataListener;
import velox.api.layer1.simplified.InitialState;
import velox.api.layer1.simplified.Parameter;
import velox.api.layer1.simplified.SnapshotEndListener;
import velox.api.layer1.simplified.TimeListener;
import velox.api.layer1.simplified.TradeDataListener;

/**
 * A local evidence collector. It has no order-management, network, or trading
 * API calls: Bookmap callbacks are serialized to an append-only JSONL file.
 */
@Layer1SimpleAttachable
@Layer1StrategyName("Bushido Flow Collector")
@Layer1ApiVersion(Layer1ApiVersionValue.VERSION1)
public final class FlowCollector implements CustomModule, DepthDataListener,
        TradeDataListener, BboListener, TimeListener, SnapshotEndListener {

    @Parameter(name = "Output directory")
    public String outputDirectory = "/Volumes/HD/bookmap_data";

    @Parameter(name = "Flush every records", minimum = 1, maximum = 10000, step = 1)
    public Integer flushEveryRecords = 250;

    private BufferedWriter writer;
    private String alias;
    private double tickSize;
    private long latestBookmapTimeNs = -1L;
    private int pendingFlushRecords;
    private boolean writeFailed;

    @Override
    public synchronized void initialize(String alias, InstrumentInfo info, Api api,
            InitialState initialState) {
        this.alias = alias;
        this.tickSize = info.pips;
        try {
            Path directory = Paths.get(outputDirectory).toAbsolutePath().normalize();
            Files.createDirectories(directory);
            Path output = directory.resolve("bookmap-flow-" + safeFilePart(alias)
                    + "-" + Instant.now().toEpochMilli() + ".jsonl");
            writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            write("instrument", "\"alias\":" + jsonString(alias) + ","
                    + "\"symbol\":" + jsonString(info.symbol) + ","
                    + "\"exchange\":" + jsonString(info.exchange) + ","
                    + "\"instrument_type\":" + jsonString(info.type) + ","
                    + "\"full_name\":" + jsonString(info.fullName) + ","
                    + "\"tick_size\":" + jsonNumber(tickSize) + ","
                    + "\"multiplier\":" + jsonNumber(info.multiplier) + ","
                    + "\"size_multiplier\":" + jsonNumber(info.sizeMultiplier) + ","
                    + "\"is_full_depth\":" + info.isFullDepth + ","
                    + "\"depth_listener_representation\":\"price_level_aggregated\","
                    + "\"mbo_captured\":false,"
                    + "\"is_crypto\":" + info.isCrypto + ","
                    + "\"data_delay_raw\":" + info.dataDelay + ","
                    + "\"requested_symbol\":" + jsonString(info.requestedSymbol) + ","
                    + "\"output_file\":" + jsonString(output.toString()));
            flushIfNeeded(true);
        } catch (IOException error) {
            writeFailed = true;
            System.err.println("Bushido Flow Collector could not open output: " + error.getMessage());
        }
    }

    @Override
    public synchronized void onTimestamp(long timestampNs) {
        latestBookmapTimeNs = timestampNs;
        flushIfNeeded(false);
    }

    @Override
    public synchronized void onSnapshotEnd() {
        write("snapshot_end", "\"meaning\":\"bookmap_initial_snapshot_complete\"");
        flushIfNeeded(true);
    }

    @Override
    public synchronized void onTrade(double price, int size, TradeInfo tradeInfo) {
        String aggressor = tradeInfo == null ? "unknown"
                : (tradeInfo.isBidAggressor ? "buy" : "sell");
        write("trade", "\"price_level\":" + jsonNumber(price) + ","
                + "\"price\":" + jsonNumber(normalizedPrice(price)) + ","
                + "\"size\":" + size + ","
                + "\"aggressor\":\"" + aggressor + "\","
                + "\"trade_info_available\":" + (tradeInfo != null) + ","
                + "\"is_otc\":" + (tradeInfo == null ? "null" : tradeInfo.isOtc) + ","
                + "\"is_execution_start\":"
                + (tradeInfo == null ? "null" : tradeInfo.isExecutionStart) + ","
                + "\"is_execution_end\":"
                + (tradeInfo == null ? "null" : tradeInfo.isExecutionEnd));
    }

    @Override
    public synchronized void onDepth(boolean isBid, int price, int size) {
        write("depth", "\"side\":\"" + (isBid ? "bid" : "ask") + "\","
                + "\"price_level\":" + price + ","
                + "\"price\":" + jsonNumber(normalizedPrice(price)) + ","
                + "\"size\":" + size);
    }

    @Override
    public synchronized void onBbo(int bidPrice, int bidSize, int askPrice, int askSize) {
        write("bbo", "\"bid_price_level\":" + bidPrice + ","
                + "\"bid_price\":" + jsonNumber(normalizedPrice(bidPrice)) + ","
                + "\"bid_size\":" + bidSize + ","
                + "\"ask_price_level\":" + askPrice + ","
                + "\"ask_price\":" + jsonNumber(normalizedPrice(askPrice)) + ","
                + "\"ask_size\":" + askSize);
    }

    @Override
    public synchronized void stop() {
        write("collector_stop", "\"reason\":\"bookmap_module_stopped\"");
        flushIfNeeded(true);
        if (writer != null) {
            try {
                writer.close();
            } catch (IOException error) {
                System.err.println("Bushido Flow Collector could not close output: " + error.getMessage());
            } finally {
                writer = null;
            }
        }
    }

    private double normalizedPrice(double priceLevel) {
        return priceLevel * tickSize;
    }

    private void write(String eventType, String fields) {
        if (writer == null || writeFailed) {
            return;
        }
        try {
            writer.write("{\"schema_version\":\"1.1\",\"source\":\"bookmap\","
                    + "\"event_type\":\"" + eventType + "\","
                    + "\"instrument_alias\":" + jsonString(alias) + ","
                    + "\"bookmap_time_ns\":"
                    + (latestBookmapTimeNs >= 0 ? jsonString(Long.toString(latestBookmapTimeNs)) : "null") + ","
                    + "\"received_at\":\"" + receivedAt() + "\"," + fields + "}\n");
            pendingFlushRecords += 1;
            flushIfNeeded(false);
        } catch (IOException error) {
            writeFailed = true;
            System.err.println("Bushido Flow Collector write disabled: " + error.getMessage());
        }
    }

    private void flushIfNeeded(boolean force) {
        if (writer == null || writeFailed || (!force && pendingFlushRecords < flushEveryRecords)) {
            return;
        }
        try {
            writer.flush();
            pendingFlushRecords = 0;
        } catch (IOException error) {
            writeFailed = true;
            System.err.println("Bushido Flow Collector flush disabled: " + error.getMessage());
        }
    }

    private static String safeFilePart(String value) {
        return value == null ? "unknown" : value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static String json(String value) {
        StringBuilder escaped = new StringBuilder();
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
        return escaped.toString();
    }

    private static String jsonString(String value) {
        return value == null ? "null" : "\"" + json(value) + "\"";
    }

    private static String jsonNumber(double value) {
        return Double.isFinite(value) ? Double.toString(value) : "null";
    }

    private static String receivedAt() {
        return Instant.ofEpochMilli(Instant.now().toEpochMilli()).toString();
    }
}
