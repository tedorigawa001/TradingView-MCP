# Phase 4 検証結果: ウォッチリスト・スキャナー(2026-07-07)

## ウォッチリスト

- `TradingViewApi.watchlist()` は Phase 0 で存在を確認していたが、実際は **"not implemented"**(デスクトップビルドでは watchlist API promise が配線されていない)
- 代替: ページ内 `fetch("https://www.tradingview.com/api/v1/symbols_list/custom/", { credentials: "include" })` — アプリのログインセッションでユーザーのカスタムリストが取得できる(HTTP 200 確認)
- 応答: `[{ id, name, type, symbols: [...] }]`。`symbols` 内の `"###Name"` 形式はセクション見出し → `sections` にグループ化して返す

## スキャナー API(scanner.tradingview.com)

認証不要・POST `/{market}/scan`。確認済み:

- **クォート**: `{"symbols":{"tickers":[...]},"columns":[...]}` — close/change/volume/RSI/`Recommend.All`(総合テクニカル評価、-1〜+1)など。`global` 市場でどの取引所のシンボルも引ける
- **スクリーニング**: `{"filter":[{"left":"RSI","operation":"less","right":40}],"columns":[...],"sort":{...},"range":[0,N]}` — 日本市場で実測269件ヒット
- 応答形式: `{ totalCount, data: [{ s: "TSE:9501", d: [列値...] }] }` — 列順は要求 `columns` 順

## 実装上の判断

- スキャナーは CDP 不要のため **Node 側から直接** 呼ぶ(`src/scanner.ts`)。ベース URL 固定、入力はホワイトリスト検証、応答は zod でスキーマ検証、AbortController でタイムアウト
- `get_technical_rating` は独立ツールにせず `get_quotes` のデフォルトカラム `Recommend.All` として提供
- フィールド名は TradingView スクリーナーの内部名(`RSI`, `market_cap_basic`, `Recommend.All` など)。網羅リストは公開されていないため、AI が探索的に使う前提で validation は形式のみ

## 未実装(意図的)

- アラート作成・ウォッチリスト変更などの書き込み系 — 確認フローの設計が必要なため見送り
- 一部市場のフィールド差異(例: crypto の出来高フィールド名)は利用時に探索が必要
