package jp.bushido.bookmap;

import java.io.BufferedReader;
import java.io.InputStreamReader;

/** SDK-free, ordered TSV adapter. JSON provenance is validated by replay.mjs. */
public final class FlowSweepReplay {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) throw new IllegalArgumentException("trades levels windowMs episodeGapMs required");
        long[] clock = {0};
        var settings = new FlowSignalEngine.Settings(Integer.parseInt(args[0]), Integer.parseInt(args[1]),
                100, 25, 0.5, 10000, 10000, Integer.parseInt(args[2]), Integer.parseInt(args[3]));
        var engine = new FlowSignalEngine(settings, () -> clock[0]);
        var reader = new BufferedReader(new InputStreamReader(System.in));
        String line;
        long prior = -1;
        int normalized = 0, rejected = 0, eligiblePositive = 0, normalizedPositive = 0;
        while ((line = reader.readLine()) != null) {
            String[] fields = line.split("\\t");
            if (fields.length != 5) throw new IllegalArgumentException("invalid replay row");
            clock[0] = Long.parseLong(fields[1]);
            if (clock[0] < prior) throw new IllegalArgumentException("clock regression");
            prior = clock[0];
            var direction = fields[4].equals("unknown") ? null : FlowSignalEngine.Direction.valueOf(fields[4].toUpperCase(java.util.Locale.ROOT));
            double rawPrice = Double.parseDouble(fields[2]);
            int size = Integer.parseInt(fields[3]);
            if (size < 0) throw new IllegalArgumentException("negative size");
            Integer level = FlowSignalEngine.normalizePriceLevel(rawPrice);
            if (level == null) { rejected++; continue; }
            if (rawPrice != level.doubleValue()) { normalized++; if (size > 0) normalizedPositive++; }
            if (size > 0) eligiblePositive++;
            var signal = engine.onSweepTrade(level, size, direction);
            if (signal != null) System.out.println(fields[0] + "\t" + signal.direction() + "\t"
                    + signal.tradeCount() + "\t" + signal.priceLevels() + "\t" + signal.aggressiveVolume()
                    + "\t" + signal.episode().sequence() + "\t" + signal.episode().signalIndex());
        }
        System.out.println("#normalization\t" + FlowSignalEngine.PRICE_LEVEL_POLICY + "\t"
                + normalized + "\t" + rejected + "\t" + eligiblePositive + "\t" + normalizedPositive);
    }
}
