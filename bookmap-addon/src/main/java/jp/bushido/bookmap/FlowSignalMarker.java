package jp.bushido.bookmap;

import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;

/** SDK-free presentation model for provisional flow-signal chart markers. */
public final class FlowSignalMarker {
    private static final Color BUY_BACKGROUND = new Color(0x13, 0x8A, 0x4B);
    private static final Color SELL_BACKGROUND = new Color(0xD1, 0x43, 0x43);
    private static final Color ABSORPTION_BACKGROUND = new Color(0x5F, 0x6B, 0x78);
    private static final Color WITHDRAWAL_BACKGROUND = new Color(0x8A, 0x6D, 0x1D);
    private static final Color FOREGROUND = Color.WHITE;
    private static final int WIDTH = 132;
    private static final int HEIGHT = 38;
    private static final int HORIZONTAL_OFFSET = -(WIDTH / 2);
    private static final int BUY_SWEEP_OFFSET = 8;
    private static final int SELL_SWEEP_OFFSET = -(HEIGHT + 8);
    private static final int ABSORPTION_OFFSET = -(HEIGHT * 2 + 12);
    private static final int WITHDRAWAL_OFFSET = -(HEIGHT * 3 + 16);

    public record Marker(String primaryLabel, String secondaryLabel, Color background,
            int horizontalOffsetPixels, int verticalOffsetPixels, BufferedImage image) {}

    private FlowSignalMarker() {}

    public static Marker forSignal(FlowSignalEngine.Signal signal) {
        Presentation presentation = switch (signal.kind()) {
            case TRADE_SWEEP -> sweep(signal.direction());
            case POSSIBLE_PASSIVE_ABSORPTION -> absorption(signal.direction());
            case POSSIBLE_LIQUIDITY_WITHDRAWAL -> withdrawal(signal.direction());
        };
        return new Marker(presentation.primaryLabel(), presentation.secondaryLabel(),
                presentation.background(), HORIZONTAL_OFFSET, presentation.verticalOffsetPixels(),
                render(presentation.primaryLabel(), presentation.secondaryLabel(),
                        presentation.background()));
    }

    private static Presentation sweep(FlowSignalEngine.Direction direction) {
        boolean buy = direction == FlowSignalEngine.Direction.BUY;
        return new Presentation(buy ? "BUY SWEEP" : "SELL SWEEP", "OBSERVED AGGRESSION",
                buy ? BUY_BACKGROUND : SELL_BACKGROUND,
                buy ? BUY_SWEEP_OFFSET : SELL_SWEEP_OFFSET);
    }

    private static Presentation absorption(FlowSignalEngine.Direction direction) {
        return new Presentation(direction == FlowSignalEngine.Direction.BUY
                ? "BUY ABSORBED" : "SELL ABSORBED", "POSSIBLE ABSORPTION",
                ABSORPTION_BACKGROUND, ABSORPTION_OFFSET);
    }

    private static Presentation withdrawal(FlowSignalEngine.Direction direction) {
        return new Presentation(direction == FlowSignalEngine.Direction.BUY
                ? "ASK WITHDRAWAL" : "BID WITHDRAWAL", "POSSIBLE",
                WITHDRAWAL_BACKGROUND, WITHDRAWAL_OFFSET);
    }

    private static BufferedImage render(String primaryLabel, String secondaryLabel,
            Color background) {
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                    RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setColor(new Color(0, 0, 0, 110));
            graphics.fillRoundRect(1, 1, WIDTH - 1, HEIGHT - 1, 7, 7);
            graphics.setColor(background);
            graphics.fillRoundRect(0, 0, WIDTH - 2, HEIGHT - 2, 7, 7);
            graphics.setColor(FOREGROUND);
            drawCentered(graphics, primaryLabel, new Font(Font.SANS_SERIF, Font.BOLD, 13), 15);
            drawCentered(graphics, secondaryLabel, new Font(Font.SANS_SERIF, Font.PLAIN, 9), 29);
        } finally {
            graphics.dispose();
        }
        return image;
    }

    private static void drawCentered(Graphics2D graphics, String text, Font font, int baseline) {
        graphics.setFont(font);
        FontMetrics metrics = graphics.getFontMetrics();
        graphics.drawString(text, Math.max(3, (WIDTH - metrics.stringWidth(text)) / 2), baseline);
    }

    private record Presentation(String primaryLabel, String secondaryLabel, Color background,
            int verticalOffsetPixels) {}
}
