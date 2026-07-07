# TradingView-MCP 戦略

TradingView デスクトップアプリに AI(Claude 等)がアクセスし、チャート分析を行える MCP サーバーを作る。

## 1. ゴール

- ユーザーが TradingView で見ているチャート(シンボル・時間足・インジケーター込み)を AI がそのまま分析できる
- AI がシンボル・時間足を切り替えて能動的に調査できる
- OHLCV 等の数値データも取得し、視覚分析と数値分析を組み合わせられる

## 2. 前提(確認済みの事実)

| 項目 | 確認結果 |
|---|---|
| アプリ | `/Applications/TradingView.app` v3.3.0 |
| 実体 | **Electron 製**(Electron 38.2.2)。中身は Web 版 TradingView と同一 |
| デバッグポート | 通常起動ではリスニングポートなし → `--remote-debugging-port` 付きで起動し直す必要あり |
| 公式 API | チャートデータ取得用の公式パブリック API は存在しない |

Electron 製であることが本戦略の核。**Chrome DevTools Protocol (CDP)** でアプリ内部の Web ページ(= TradingView 本体)に直接アクセスできる見込みが高い。

## 3. アクセス手法の比較

### 案A: CDP でデスクトップアプリに接続(本命)

`open -a TradingView --args --remote-debugging-port=9222` で起動し、CDP 経由で操作。

- ✅ ユーザーのログインセッション・有料プラン・保存済みレイアウトをそのまま利用
- ✅ スクリーンショット取得(AI 視覚分析)、ページ内 JS 実行(データ抽出)、UI 操作(シンボル切替)がすべて可能
- ✅ ユーザーが「今見ている画面」を共有できる — デスクトップアプリを対象にする最大の意義
- ⚠️ デバッグフラグ付きでの再起動が必要(通常起動中は接続不可)
- ⚠️ Electron 側でフラグが無効化されている可能性 → **最初に検証(Phase 0)**

### 案B: 非公式 WebSocket API(data.tradingview.com)

Web 版が使う WebSocket プロトコルを直接叩く(tvdatafeed 等の実績あり)。

- ✅ アプリ不要・高速・OHLCV を構造化データで取得
- ⚠️ 非公式ゆえプロトコル変更リスク、ログイン処理を自前実装
- → 案A の CDP 内 JS 実行で同等データが取れるなら不要。データ専用のフォールバック候補

### 案C: OS レベルのスクリーンショット + Vision

- ✅ 実装が最も簡単
- ❌ 操作・数値取得ができず、ウィンドウが隠れていると使えない。単体では不採用(案A に包含される)

### 案D: 公開スキャナー API(scanner.tradingview.com)

- ✅ 認証不要の REST でスクリーニング・テクニカル評価(RSI 等)が取得可能
- → 補助ツールとして後続フェーズで追加

**結論: 案A(CDP)を主軸に、案D を補助、案B を保険とするハイブリッド。**

## 4. アーキテクチャ

```
Claude ⇄ (stdio) ⇄ MCP サーバー (TypeScript) ⇄ (CDP :9222) ⇄ TradingView.app (Electron)
                                             ⇄ (HTTPS)     ⇄ scanner.tradingview.com
```

- 言語: **TypeScript** + `@modelcontextprotocol/sdk`
- CDP クライアント: `chrome-remote-interface`(軽量)または Playwright の `connectOverCDP`
- トランスポート: stdio(Claude Code / Claude Desktop からローカル利用)

## 5. MCP ツール設計(案)

| ツール | 内容 | 実現手段 |
|---|---|---|
| `get_chart_screenshot` | 現在のチャート画像を返す(AI が視覚分析) | CDP `Page.captureScreenshot` |
| `get_chart_context` | 表示中のシンボル・時間足・インジケーター一覧 | CDP JS 実行 |
| `set_symbol` / `set_timeframe` | チャートの切替 | CDP JS / キー入力 |
| `get_ohlcv` | ローソク足データ(数値) | ページ内チャートオブジェクトから抽出 |
| `get_indicator_values` | 表示中インジケーターの現在値 | 同上 |
| `get_watchlist` | ウォッチリストの銘柄と価格 | CDP JS 実行 |
| `scan_market` | スクリーナー(条件でフィルタ) | scanner API |
| `get_technical_rating` | 買い/売り総合評価 | scanner API |

## 6. フェーズ計画

- **Phase 0 — 実現可能性検証(最重要)**: デバッグポート付き起動 → CDP 接続 → スクリーンショット取得まで手動確認。ここが通れば残りは既知技術
- **Phase 1 — 読み取り MVP**: MCP サーバー骨格 + `get_chart_screenshot` + `get_chart_context`。「今見ているチャートを AI に分析させる」体験を最短で成立させる
- **Phase 2 — 操作**: `set_symbol` / `set_timeframe`。AI が能動的に複数銘柄・複数時間足を調査可能に
- **Phase 3 — 数値データ**: `get_ohlcv` / `get_indicator_values`。視覚+数値のハイブリッド分析
- **Phase 4 — 拡張**: ウォッチリスト、スキャナー、アラート連携、分析レポート生成

## 7. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Electron がデバッグフラグを無効化 | 案A 全体が不成立 | Phase 0 で最初に検証。不可なら案B+C に切替 |
| アプリ更新で内部構造(DOM/JS)が変わる | データ抽出ツールが壊れる | スクリーンショット系を主、DOM 依存は薄い抽象化層に隔離 |
| ToS(自動アクセスは規約グレー) | アカウントリスク | 個人利用・自分のセッション・低頻度アクセスに限定。スクレイピング的大量取得はしない |
| デバッグポートのセキュリティ | ローカルの他プロセスから接続可能 | localhost バインドのみ。MCP 利用時のみポート開放 |

## 8. 進捗

- ✅ **Phase 0 完了**(2026-07-07): CDP 接続・スクリーンショット・構造化データ・OHLCV・操作 API をすべて検証済み。結果は [phase0-findings.md](phase0-findings.md)
- ✅ **Phase 1 + 2 完了**(2026-07-07): MCP サーバー実装。ツール: `get_chart_screenshot` / `get_chart_context` / `get_ohlcv` / `set_symbol` / `set_timeframe`(操作系 API が単純だったため Phase 2 も同時に実装)
- ⏭ 次: Phase 3(インジケーター値の取得)、Phase 4(ウォッチリスト・スキャナー)
