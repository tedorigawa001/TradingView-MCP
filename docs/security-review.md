# セキュリティレビュー(2026-07-07)

対象: 初期実装一式(`src/cdp.ts`, `src/tradingview.ts`, `src/server.ts`, `src/index.ts`)
方法: 手動コードレビュー + `npm audit` + ユニットテストによる検証
(注: `/security-review` スキルは git リモートが前提のため、リモート設定後は毎回のPRで利用推奨)

## 結果サマリー

| # | 項目 | 深刻度 | 状態 |
|---|---|---|---|
| 1 | CDP デバッグポート開放によるローカル攻撃面 | Medium | 文書化・受容(下記) |
| 2 | `Runtime.evaluate` へのコードインジェクション | High → なし | 対策済み・テストで担保 |
| 3 | CDP ターゲット選定の部分文字列マッチ | Low | 修正済み |
| 4 | 依存パッケージの既知脆弱性 | — | `npm audit`: 0件 |
| 5 | ページ由来データの AI への流入(間接プロンプトインジェクション) | Low | 文書化 |
| 6 | スクリーンショットの情報漏えい | Info | 文書化 |

## 詳細

### 1. CDP デバッグポート(9222)— Medium、受容

`--remote-debugging-port=9222` で起動中は、**同一マシン上の任意のプロセス**が TradingView のログイン済みセッションを完全に操作できる。

緩和要素:
- ポートは localhost バインドのみ(Chrome/Electron のデフォルト)
- Chromium は WebSocket 接続時に Origin ヘッダ付き(=ブラウザ経由)の接続を拒否するため、Web ページからの DNS リバインディング系攻撃は成立しない
- 攻撃には既にローカルでコード実行できていることが前提 → その時点で脅威モデル外

運用ルール:
- **MCP を使う時だけ**デバッグポート付きで起動し、平常時は通常起動する
- 共有マシンでは使用しない

### 2. `Runtime.evaluate` インジェクション — 対策済み

ユーザー/AI 入力がページ内で実行される JS 式に埋め込まれる箇所がインジェクションポイントになり得る。

対策(多層):
- 文字列(`symbol`)は `JSON.stringify` で必ず文字列リテラル化(ES2019+ では JSON は JS の完全部分集合であり、リテラル脱出は不可能)
- `resolution` は `JSON.stringify` に加えて形式ホワイトリスト(`/^[0-9]*[SDWM]?$/i`)
- 数値(`count` / `chartIndex`)は `Number.isFinite` / `Number.isInteger` 検証後にのみ式へ埋め込み
- MCP 層でも zod スキーマで型・範囲を検証(不正入力はハンドラ到達前に -32602 で拒否)
- **任意 JS を実行する MCP ツールは意図的に公開していない**(evaluate は内部 API のみ)

テスト: `test/unit/tradingview.test.mjs` にインジェクションペイロードのテストあり(悪意ある symbol がエスケープされること、不正な resolution/count/chartIndex がページ到達前に拒否されることを検証)。

### 3. CDP ターゲット選定 — 修正済み

旧: `t.url.includes("tradingview.com/chart")` の部分文字列マッチ。`https://evil.example/tradingview.com/chart` のような URL にも一致し得た。

新: URL をパースし `https:` + ホスト名が `tradingview.com`(またはそのサブドメイン)+ パスが `/chart` で始まることを厳密に検証(`src/cdp.ts` の `findChartTarget`)。

### 4. 依存関係 — クリーン

- ランタイム依存は 3 つのみ: `@modelcontextprotocol/sdk` / `ws` / `zod`(いずれも活発にメンテされている)
- `npm audit`: **0 vulnerabilities**(2026-07-07 時点)
- `package-lock.json` をコミットしてバージョンを固定すること
- 定期的な `npm audit` を推奨(CI 導入時に組み込む)

### 5. ページ由来データの AI への流入 — Low

シンボル名・インジケーター名・レイアウト名などページ側の文字列がツール結果として AI に渡る。理論上は悪意ある文字列による間接プロンプトインジェクションの経路だが、データ源はユーザー自身の TradingView セッション(自分で追加したインジケーター等)であり、実質的リスクは低い。将来「公開アイデア/コメント欄」等の第三者コンテンツを取得するツールを追加する場合は再評価すること。

### 6. スクリーンショットの情報漏えい — Info

`get_chart_screenshot` はウォッチリスト・口座関連 UI・レイアウト全体を含む画像を AI(および AI プロバイダ)へ送信する。ユーザーが意図して使う前提のツールだが、画面に見えているものはすべて送られることを README に明記済み。

## 追補: Phase 3(2026-07-07)

`get_indicator_values` / `get_indicator_inputs` 追加に伴うレビュー:

- **Pine スクリプトソースの漏えい防止**: `getInputValues()` に含まれる `text`(保護スクリプトでは暗号化ソース)・`pineId`・`pineVersion`・`pineFeatures` をページ内でフィルタし、ツール出力に含めない。加えて 200 文字超の文字列値は切り詰め。統合テストで漏えいゼロを毎回検証
- **`study_id` のインジェクション対策**: `/^[\w$]{1,64}$/` のホワイトリスト検証(zod 層 + TradingView 層の二重)後に `JSON.stringify` で埋め込み。ユニットテストで担保
- 読み取り専用ツールのみ追加(`setInputValues` 等の変更系 API には触れていない)

## 追補: Phase 4(2026-07-07)

`get_watchlist` / `get_quotes` / `scan_market` 追加に伴うレビュー:

- **外部 HTTP(scanner.tradingview.com)**: ベース URL は固定(https)。市場名は `/^[a-z]{2,24}$/`、フィールド名は `/^[\w.|]{1,64}$/`、ティッカーは `/^[\w!.:&-]{1,48}$/`、演算子はホワイトリストで検証してからリクエストを構築(パストラバーサル・任意ボディ注入不可)。応答は zod スキーマで検証(申し送り対応済み)。タイムアウトは AbortController で強制
- **ウォッチリスト取得**: ページ内 fetch(`credentials: "include"`)で TradingView 自身のオリジンにのみアクセス。取得は読み取り専用 GET。式に外部入力の埋め込みなし(引数ゼロ)
- **第三者コンテンツ**: スキャナー応答の銘柄説明等が AI に渡る(公開マーケットデータであり、間接プロンプトインジェクションのリスクは従来評価どおり Low)
- 変更系(ウォッチリストへの追加・削除、アラート作成)は引き続き非公開

## 将来フェーズへの申し送り

- アラート作成・注文系(`trading`)API には**触れない**か、明示的な確認フローを挟む(現状ツール未公開 = 安全)
- スキャナー API(Phase 4)追加時は外部 HTTP 応答のスキーマ検証を入れる
- CI 導入時: `npm audit` + ユニットテストをゲートに
