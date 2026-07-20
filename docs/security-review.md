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
- `npm audit --audit-level=high`: **0 vulnerabilities**(2026-07-20、Node 24.18.0)
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
- 当時は変更系(ウォッチリストへの追加・削除、アラート作成)を非公開とした。アラート作成は2026-07-20に#26の限定confirm経路だけを追加した

## 追補: Phase 5(2026-07-08)

`get_indicator_graphics` / `load_more_history` / `list_alerts` 追加に伴うレビュー:

- **`list_alerts`**: ページ内 fetch(`credentials: "include"`)で pricealerts.tradingview.com への読み取り専用 GET のみ。作成・変更・削除エンドポイントは呼ばない(ユニットテストで read-only を検証)。message は 300 文字に切り詰め
- **`get_indicator_graphics`**: 読み取り専用。`study_id` は既存のホワイトリスト検証+JSON 埋め込み、`limit_per_kind` は 1〜500 の整数検証。ラベルテキストはユーザー自身のインジケーター由来(第三者コンテンツではない)
- **`load_more_history`**: ページ状態を変更する唯一の新ツールだが、ユーザーが左スクロールした場合と同一の挙動(データロードのみ、ビュー位置・レイアウトは不変)。count は 1〜5000 の整数検証。ポーリングは最長15秒で必ず終了

## 追補: バックログ #5/#6(2026-07-08)

`get_key_levels` / `get_economic_events` 追加に伴うレビュー:

- **`get_key_levels`**: 既存の読み取り専用操作(OHLCV・インジケーター値・graphics)の Node 側合成のみで、新しいページアクセス・式テンプレートは追加していない。`range_percent` は (0, 50]、`limit` は 1〜200 の検証。`is_price_study: false` のスタディ(RSI 等のオシレーター)を除外するのは正確性と安全性を兼ねる: オシレーター値を価格レベルとして AI に誤提示しない
- **`get_economic_events`(新規外部エンドポイント)**: economic-calendar.tradingview.com への Node 側 GET。**認証・Cookie は一切送信しない**(必要なのは固定の Origin ヘッダーのみ)。ベース URL は固定(https)。国コードは `/^[A-Z]{2}$/`、日付は ISO 8601 解析+期間 92 日上限、`limit` 1〜200 を検証してから URLSearchParams でクエリ構築(注入不可)。応答は zod でトップレベル形状を検証し、フィールドは型ガード付きで個別マッピング — 長文の `comment` 等の未知フィールドは出力に含めない。イベントタイトル等の第三者コンテンツが AI に渡る点は公開経済データであり、間接プロンプトインジェクションのリスクは従来評価どおり Low

## 追補: バックログ #9(2026-07-08)

`get_indicator_tables` 追加に伴うレビュー:

- 読み取り専用。`study_id` は既存のホワイトリスト検証(`/^[\w$]{1,64}$/`)+ JSON 埋め込み、`chart_index` は非負整数検証で、式への注入経路なし
- セルテキスト・ツールチップは 200 文字で切り詰め、グリッドは 2000 セル上限(巨大テーブルによるペイロード肥大を防止)
- 内容はユーザー自身が表示しているインジケーターの描画物であり、第三者コンテンツではない(リスク評価は get_indicator_graphics と同等)

## 追補: バックログ #10(2026-07-08)

`list_pine_scripts` / `get_pine_source` 追加に伴うレビュー:

- **自作スクリプト限定**: `get_pine_source` は `pineId` を `/^USER;[\w]{8,64}$/` で検証し、`PUB;`(公開/保護/招待制スクリプト)はネットワーク到達前に拒否。一覧も `filter=saved`(自分のワークスペース)のみ。**他者のスクリプトソースを引き出す経路はない**。チャート側の隠し入力 `text`(コンパイル済みIL)のフィルタも従来どおり維持
- **読み取り専用**: pine-facade への GET のみ。保存・削除・公開系エンドポイントは呼ばない(ユニットテストで `/save|/delete|method:` 不在を検証)
- **注入対策**: pineId はホワイトリスト検証後に JSON 埋め込み+ページ内で encodeURIComponent
- **留意点**: ユーザー自身のソースコード全文(知的財産)が AI のコンテキストに送信される。ツール説明に用途(レビュー・改善提案)を明記済み。ソースの外部送信は MCP クライアント(AI エージェント)のポリシーに従う

## 追補: バックログ #8(2026-07-08)

`get_strategy_report` / `run_backtest` 追加に伴うレビュー:

- **`run_backtest` はチャート状態を一時変更する**(ストラテジーを追加→レポート取得→削除)。set_symbol と同じ「操作系・自己復元」クラス。レポートの成否に関わらずデフォルトで削除を実行し、削除失敗は WARNING として結果に明記。`keep_on_chart: true` は明示オプトイン
- **自作スクリプト限定**: `pine_id` は #10 と同じ `USER;` ゲート(zod + TradingView 層の二重)。適用前に `isTVScriptStrategy` を検証し、strategy 以外は追加せず拒否
- **誤情報防止**: レポートの WatchedValue はストラテジー削除後も残留するため、(1) `activeStrategy` が null ならレポートを返さない、(2) `run_backtest` はレポートの帰属(description 一致)を確認してから受理 — 別ストラテジーの成績を返すより タイムアウト失敗を選ぶ
- **注文系には触れない**: replayApi に buy/sell 等が存在するが公開していない。バックテストは Pine エンジンのシミュレーションであり、実口座・実注文とは無関係
- 統合テストで「実行後にチャートのスタディ構成が実行前と一致」を毎回検証

## 追補: バックログ #11(2026-07-08)— 方針変更: 初の書き込み系ツール

`save_pine_script` / `add_pine_to_chart` 追加に伴うレビュー。「書き込み系は非公開」の方針を、**Pine スクリプトの保存に限り**確認フロー付きで解除した:

- **confirm フロー**: `confirm: true` なしでは一切書き込まず、ドライラン(対象・現行バージョン・サイズ比較)を返す。ツール説明で「ドライランをユーザーに提示し承認を得てから confirm する」ことを AI に指示
- **非破壊の不変条件**:
  - 新規作成は `saveNew` を overwrite オプションなしで呼ぶ。同名スクリプトは事前検知して拒否(サーバーの汎用エラーに頼らない)
  - 既存スクリプトへは新バージョン追記のみ(`saveNext`)。**全旧バージョンが `get_pine_source(pine_id, version)` で取得可能**なことを統合テストで検証 — 復元手段が常にある
  - **当時は削除 API を非公開**とした。2026-07-15に、所有Pine ID・対象チャート・confirmを必須とする限定版`remove_owned_study`だけを#16で公開
- **正直な結果報告**: pine-facade はコンパイル失敗でもバージョンを保存する。結果に `compileOk` / 行番号付き `compileErrors` / `revertHint` を含め、保存後にソースを取得し直して一致検証(`verified`)。改行は CRLF 正規化差を吸収
- **対象は自作スクリプトのみ**: `USER;` ゲート(zod + TradingView 層の二重)。他者スクリプトへの書き込み経路はない
- **`add_pine_to_chart` 自体は追加のみ**: 削除を暗黙に行わない。削除は#16の所有確認・confirm付き専用ツールへ分離し、追加されたスタディはユーザーがUIからも外せる
- 引き続き非公開: 注文系、既存アラートの変更・再開・削除、Webhook、ウォッチリスト変更、Pineライブラリのスクリプト削除、リプレイの buy/sell。新規アラート作成は2026-07-20に#26の限定confirm経路だけを追加した

## 追補: バックログ #12(2026-07-09)

`set_indicator_input` 追加に伴うレビュー:

- **Pine ソース/ライブラリへの永続化はない書き込み**: `chart.getStudyById(studyId).setInputValues()` は pine-facade には一切触れない(保存済みスクリプトは無傷)。ただし**チャート上のスタディインスタンスの入力値はライブ状態として残り**、復元するまで変更されたまま。ユーザーが手動で Settings ダイアログを開いて値を変えるのと等価な操作であり、TradingView 側のレイアウト自動保存の対象にもなり得る点は明記した上で、`save_pine_script` のような confirm フローは不要と判断(`set_symbol`/`set_timeframe` と同じ分類 — こちらもチャートのライブ状態を変更し自動保存対象になり得るが confirm 不要としている前例に倣う)
- **入力対象の限定**: 書き込み先は `study_id` で指定した既存スタディの入力のみ。Pine内部入力(`text`/`pineId`/`pineVersion`/`pineFeatures`/`__profile`)は `get_indicator_inputs` 同様に書き込み拒否
- **注入対策**: `study_id`・入力`id` は共に `/^[\w$]{1,64}$/` ホワイトリスト検証(zod + TradingView層の二重)後に JSON埋め込み。value は number/string/boolean のみ許可(オブジェクト・配列は拒否)
- **未知IDの拒否**: ページ内で対象スタディの現行入力一覧と照合し、存在しないIDへの書き込みは明確なエラーで拒否してから `setInputValues` を呼ぶ
- `set_indicator_input`自体は既存スタディの削除・置換を行わない。削除は#16の所有確認・confirm付き専用ツールへ分離

## 追補: バックログ #15(2026-07-15)

`get_analysis_overlay_template` / `apply_analysis_overlay` 追加に伴うレビュー:

- **固定テンプレート**: MCPが返すPineソースは静的定数で、分析文や外部データをソースコードへ連結しない。分析値は保存済みスタディの型付き入力としてのみ渡すため、Pineコード注入経路を作らない
- **誤適用のfail-closed検証**: 書き込み前に`chart_index`、完全な銘柄名、時間足を現在のチャートと照合する。さらにスタディ名は完全一致、14個の入力ID・表示名は固定契約に一致しなければ、既存の別インジケーターを変更せず拒否する
- **confirmフロー**: `confirm: true`がない呼び出しはチャート状態と入力契約の確認およびプレビューだけを行う。明示確認後に限り、専用オーバーレイの入力を一括更新する
- **時点と方向の検証**: `analyzed_at`の未来時刻、逆転したエントリー帯、方向と矛盾するStop・Invalidation・Target、非正値を拒否する。`expires_at`経過後は削除や現在判断への見せかけをせず、Pine側で`EXPIRED`として灰色表示する
- **書き込み後の検証**: 全入力を読み戻して期待値との一致を返し、再計算がsettleした場合だけ描画プリミティブ数も取得する。20秒デッドラインで`settled:false`の場合は`verified:false`とwarningを返し、staleになり得る描画検証をスキップする。描画読取りだけが失敗した場合も、入力更新成功と検証不能を区別してwarningを返す
- **時刻単位の実機確認**: Pineの`input.time`契約に合わせUnix epochミリ秒を渡す。USDJPY 4H実機で`1784115245774`の入力読み戻し一致と、同日の分析開始位置からボックスが描画されることをスクリーンショット確認済み
- **権限境界**: Pineライブラリの削除・注文・アラート作成には接続しない。Study削除は#16の所有確認・confirm付き経路に限定する。TradingViewレイアウトの自動保存により入力値が残る可能性は`set_indicator_input`と同じ

## 追補: バックログ #16(2026-07-15)

`ensure_analysis_overlay` / `remove_owned_study`追加に伴うレビュー:

- **所有確認**: 削除可能なのは`USER;`形式の自作Pineだけ。公開ツール層で`list_pine_scripts.usedBy`のchart/study対応を確認し、TradingView層でもStudyのhidden `pineId`が要求値と完全一致しなければ`removeEntity`を呼ばない
- **confirmフロー**: 削除、追加、更新、旧版入れ替えは`confirm:true`なしではプレビューのみ。すでに現行版が1つだけ存在する場合は書き込みなしで同じ`study_id`を返す
- **監査済みソース限定**: ensureはPineライブラリのlatestソースを取得し、改行正規化後に固定テンプレートと完全一致しなければ拒否する。名前だけ一致する別スクリプトを自動更新しない
- **版識別**: Studyのhidden `pineVersion`を読み取り専用で`list_pine_scripts.usedBy.version`へ公開し、ライブラリlatestと配置版を比較する
- **版番号の分離**: `ANALYSIS_OVERLAY_VERSION`は固定テンプレートの論理版であり、TradingViewが保存ごとに付与するPineライブラリ版とは独立する。symbol/timeframe/snapshot ID/strategy versionの4入力追加により論理版を`2.0`とする
- **トランザクション順序**: 旧版を先に削除しない。latest追加→18入力移行→settle→全入力読み戻し→配置版確認の順で検証し、成功後だけ旧版を削除する。旧14入力版はプレビューで文脈拘束が必要なことを明示し、confirm後だけ現在の検証済みsymbol/timeframeを追加する。途中失敗時は新規Studyを削除して旧版を保持する
- **既存latest優先**: latestとoutdatedが同時配置済みならlatestを保持し、outdatedだけを削除する。このcleanupではoutdated側の入力を移行しないため、confirm前のプレビューへ明示警告を返す
- **曖昧性拒否**: 同一チャートにlatestが複数、旧版が複数、または全体で3個以上ある場合は、自動的に残す個体を選ばず拒否する

## 追補: バックログ #17(2026-07-15)

`get_analysis_overlay_status`追加に伴うレビュー:

- **読み取り専用**: チャート、Pineライブラリ、入力、アラート、注文を変更しない。対象チャートのコンテキスト、保存済みPine、配置版ソース、18入力、最新OHLCV、描画プリミティブだけを取得する。入力に拘束されたsymbol/timeframeが現在チャートと違う場合は`stale_context`として価格判定を停止する
- **信頼境界**: `USER;` Pine ID、完全一致するスクリプト名・種別、対象チャート上の単一配置、配置版番号、配置版ソースと固定テンプレートの完全一致を順に確認する。未配置は`not_installed`、複数配置は`ambiguous`、初期入力は`unconfigured`、ソース不一致や入力破損は`blocked`として分析値を信頼しない。初期入力と入力破損ではOHLCV・描画を取得しない
- **現在値判定の限界**: 最新バー終値と各水準の現在位置だけを返し、形成中バーかどうかも併記する。現在価格が水準以上・以下でも、過去に接触した事実、接触順序、約定、損益を推定しない
- **描画整合性**: 分析入力から期待されるlabel・line・box数と実際のプリミティブ数を比較する。これは表示要素の欠落検知であり、座標や画面上の視認性を保証するものではない
- **曖昧性の拒否**: 同一Pineが対象チャートへ複数配置されている場合、自動選択せず`study_id`候補を返して停止する

## 追補: バックログ #18(2026-07-15)

`evaluate_analysis_overlay_outcome`追加に伴うレビュー:

- **読み取り専用・同一信頼境界**: #17と同じ所有Pine、単一配置、配置版、固定ソース、18入力、未設定・文脈不一致検知を通過した分析だけを評価する。注文、アラート、評価ログを変更せず、評価時間足指定時の一時切替だけを復元付きで行う
- **先読み防止**: 分析時刻を含む足は、時刻以前のHigh/Lowが混在するため丸ごと除外する。形成中足も除外し、期限が足の途中にある場合は終了時刻が期限内に収まる足だけを対象にする
- **OHLCの限界**: 同一足内のEntry/Confirmation、Confirmation/Invalidation、Entry/Terminal、Target/Stopの順序は復元しない。直前終値から始値でTerminalを飛び越えたギャップも約定扱いせず`ambiguous`にする
- **水準の意味論**: Entry後、Confirmation前のInvalidation接触は分析シナリオの取消として扱う。有効化後の二値first-hitだけをTarget 1対Stopで判定する。Target順とStop/Invalidation相対順は入力契約で検証し、手動編集による矛盾は`blocked`にする
- **月足**: `D`/`W`の数字省略は1単位として受理するが、`M`は暦月長が可変なため30日近似せず`not_evaluable`にする
- **履歴完全性**: 取得した最古の確定足が分析開始以前を覆わない場合、または期限内に評価可能な確定足が0本の場合、Entryなしと誤判定せず`incomplete`にする。自動履歴ロードは行わず、利用者が`load_more_history`または短い時間足を準備して再評価する
- **非約定評価**: 結果は確定OHLC上のfirst-hit証拠であり、注文成立、約定価格、部分利確、スリッページ、実現損益を表さない

## 追補: バックログ #19(2026-07-16)

`evaluate_analysis_overlay_outcome.evaluation_timeframe`追加に伴うレビュー:

- **条件付きチャート操作**: パラメータ未指定時は従来どおり読み取り専用。指定時だけ、検証済みの対象`chart_index`を証拠用時間足へ一時変更し、OHLCV取得後に元の時間足へ復元する。symbolやPine入力は変更しない
- **誤チャート防止**: `setResolution`をチャート番号対応にし、非アクティブ面を指定した評価でもactive chartへ誤適用しない。切替前・切替後・復元後に`chart_index`、symbol、timeframeを照合する
- **証拠の鮮度**: 切替後に旧時間足のバーが残る場合を考慮し、OHLCVのsymbol・resolution一致と1本以上のバーを必須とする。不一致は評価せず`evaluation_evidence_unavailable`でfail closedする
- **復元失敗**: 証拠取得または評価の成否にかかわらず復元を試みる。証拠が評価可能でも復元に失敗した場合は結果を消さず、`chartState.restored: false`、`currentTimeframe`、`restoreError`、`chart_timeframe_restore_failed`を返す
- **競合制御と残余リスク**: 同一MCPプロセス内の主要チャート読み取り、時間足・銘柄変更、バックテスト、Pine追加、入力変更、分析オーバーレイ管理を直列化する。TradingView UIからの手動操作や別MCPプロセスによる変更までは排他できないため、各段階の状態照合は引き続き必須

## 追補: バックログ #20(2026-07-16)

分析ジャーナル追加に伴うレビュー:

- **ローカル専用・権限境界**: 保存先は既定`~/.tradingview-mcp/analysis-journal.jsonl`で、チャート・Pineライブラリ・注文・アラートへ書き戻さない。保存ディレクトリ0700、ファイル0600、現ユーザー所有、通常ファイル、サイズ上限を検証し、`O_NOFOLLOW`、fsync、プロセス内直列化、所有トークン付きプロセス間ロックを使う。破損JSONL、連番欠落、シンボリックリンクは黙って補正せずfail closedする。ロックは60秒超かつ所有PID不在の場合だけdescriptor/inode/mtime再照合後に回収し、生存PIDまたは確認不能なら奪取しない。タイムアウト時は手動復旧可能な`.lock`パスをエラーへ含める
- **識別子の分離**: 業務キー`analysisId`へUUID形式を強制せず、イベント識別には別の`event_id` UUIDを使う。分析定義はsymbol・時間足・分析時刻・全水準・confidence・noteを固定順序JSONからSHA-256化し、同じIDを異なる定義へ再利用できない。衝突は`analysis_id_definition_conflict`として構造化し、ストレージ再試行ではなく新しい`analysis_id`での再適用を案内する
- **書き込み条件**: `apply_analysis_overlay(confirm:true)`でsymbol/timeframeを含む18入力の読み戻しが全一致した場合だけ定義を自動追記する。任意のsnapshot IDとstrategy versionも定義hashへ拘束する。再計算タイムアウト時も入力一致が確認できれば、描画検証不能のwarningと区別して分析定義を記録する。事後評価は従来の読み取り専用既定を維持し、`record:true`の明示時だけ追記する
- **部分失敗**: チャート反映後のジャーナル失敗を反映失敗に見せず、ロールバックもしない。`applied:true`または評価結果を維持し、`journal.recorded:false`、秘匿情報を除いたエラー、冪等な再試行方法を返す
- **状態遷移と衝突**: 各評価に証拠として確認した最終足時刻`evidenceThrough`を保存する。参照・集計時は`complete`を後発の`ongoing`で逆戻りさせず、同じ証拠・時間足・ラベルの再記録は冪等にする。異なる`complete`ラベルは時間足差やデータ差の調査対象であり、自動的に最新版へ上書きせず拒否する
- **較正の母集団**: 確信度をシナリオ成功確率として扱い、`target_before_stop=1`、`stop_before_target=0`だけでBrier scoreと確信度帯別実現率を算出する。同一足順序不明、ギャップ、履歴不足、未発動、無効化、neutral等を勝敗へ丸めず、理由別除外数を返す。少数標本では値を表示しても統計的信頼性を保証しない
- **残余リスク**: JSONLは暗号化しないため、OSアカウントや端末自体が侵害された場合の秘匿性は提供しない。`note`には取引分析以外の機微情報を入れない。ログは追記専用で自動ローテーションを行わず、64MiB上限到達時は明示エラーになる

## 追補: バックログ #22(2026-07-20)

`validate_trade_plan`追加に伴うレビュー:

- **純粋な事前検証**: 入力された分析定義、現在価格、観測時刻、往復コスト、イベントだけをNode内で決定論的に評価する。CDP、TradingView、Pine、アラート、注文、分析ジャーナル、外部HTTPへアクセスせず、副作用を持たない
- **fail closed**: 方向矛盾、期限切れ、未来または期限超過の市場証拠、観測時点でConfirmation/Invalidation/Stopへ到達済み、重要イベント停止時間、コスト控除後RR不足を個別のerrorコードで`blocked`にする。分析契約違反を生のMCPエラーへせず、修正候補付きの構造化結果として返す
- **推測の禁止**: `current_price`は呼び出し側が明示した観測値だけを使用し、過去の水準接触、約定、執行可能性を推定しない。Entryを過ぎConfirmation前の状態は`warning`であり、到達履歴の証明ではない。イベント配列も渡された範囲だけを評価し、カレンダー完全性を保証しない
- **単位境界**: `estimated_round_trip_cost_price`は銘柄価格単位であり、`compute_round_trip_cost.total_price_per_unit`と接続できる。口座通貨の総額やpipsを暗黙変換せず、Target 1のnet RRは往復コストを報酬から控除しリスクへ加算して算出する

## 追補: バックログ #23(2026-07-20)

`get_trade_decision_context`追加に伴うレビュー:

- **読み取り専用統合**: 既存のTradingView chart context/OHLC/キーレベル、公開scanner・経済カレンダー、CFTC COT、米財務省実質金利の読み取りだけを束ねる。symbol、時間足、インジケーター入力、Pine、アラート、注文、ジャーナルを変更せず、口座情報や認証情報も受け取らない
- **文脈拘束**: `chart_index`のsymbolと`expected_timeframe`を取得前に照合し、不一致時はOHLCとキーレベルを読まない。取得後もOHLCとキーレベルのsymbol/timeframeを再照合し、staleまたは別チャート由来の証拠を破棄する
- **部分失敗の保持**: 各ソースを`required/status/source/observed_at/source_at/freshness/data`で包み、失敗をゼロ値や別ソースで補完しない。chart contextや必須ソースの失敗は他の取得済み証拠とUUID `snapshot_id`を保持した構造化`blocked`として返し、任意COT・実質金利・キーレベルの失敗は`partial`に留める
- **判断境界**: `decision_status`はデータ完全性・イベント停止・執行証拠だけのゲートで、`directional_recommendation`は常に`null`。`trade_ready`を売買推奨として扱わない。重要イベント時間帯は`wait`、必須証拠破損は`blocked`とする
- **執行鮮度**: 開いているチャートのquoteは`lp_time`、`current_session`、`hub_rt_loaded`、`trade_loaded`、bid/askを同時に読み、source時刻SLA・streaming・active session・realtime loadedをすべて満たす場合だけreadyとする。`lp_time`はlast-price時刻でありbid/ask個別のexchange timestampではないため、単独では鮮度証明に使わない。チャート未配置時のscanner fallbackには市場側timestampとsession calendarがないため受信時刻をsource timeへ置換せず、リクエスト後のbid/ask変化を観測した場合だけローカルなlivenessを検証済みとする。静止、遅延、stale、欠落、crossed quoteはreadyにしない。`get_trade_decision_context`はこの条件と他の必須ゲートを満たした場合だけ`trade_ready`へ進む。チャート終値をbid/askや約定可能価格へ代用せず、readyも約定・流動性・exchange sequencingの保証とはしない

## 追補: バックログ #25(2026-07-20)

`compute_position_size`追加に伴うレビュー:

- **純粋計算・権限境界**: 呼び出し側が明示した口座通貨、評価額、リスク、価格、コスト、数量制約、換算証拠だけをNode内で計算する。ブローカー口座、認証情報、TradingView、CDP、外部HTTP、注文、チャート、ジャーナルへ接続せず、入力と結果を永続化しない
- **リスク上限**: EntryからStopまでの値幅と往復コストをquantity当たり損失へ含め、最大数量適用後も`quantity_step`単位で下方向へ丸める。浮動小数点誤差で推定損失が予算を超えた場合はさらに1 step減らし、12桁を超えるstepや安全整数範囲外の正確な丸めは推定せず拒否する
- **通貨換算のfail closed**: instrument registryのquote通貨と口座通貨が異なる場合、`quote_to_account_rate`を「quote通貨1単位あたりの口座通貨」と固定し、conversion symbol、ISO観測時刻、最大鮮度をすべて要求する。欠落、stale、未来時刻、非正値、未知quote通貨では数量をnullにする。同一通貨の場合だけ換算率1を内部設定する
- **ブローカー仕様を推測しない**: 戻り値はinstrument unitでありlotではない。最小/最大数量、数量刻み、contract multiplierはブローカー、商品、口座種別、地域で異なるため自動推定せず入力必須または明示optionalとする。MCPのXAUUSD metadataはquote通貨とtickを識別するだけで、取引可能数量や契約仕様を保証しない
- **非執行性**: 結果はStop価格での単純な損失見積りであり、ギャップ、滑り、流動性、追証、証拠金、価格改善、税、swap、約定可能性を保証しない。往復コストとcontract multiplierの正確性は呼び出し側の証拠品質に依存する

## 追補: バックログ #26(2026-07-20)

`create_analysis_alerts`追加に伴うレビュー:

- **限定された書き込み**: `confirm:true`がない呼び出しはpreviewのみ。確認後も固定テンプレートと完全一致する所有Pine、対象チャート上の単一配置、18入力、`analysisId`、symbol/timeframe、未来の分析期限をすべて照合した場合だけ、Confirmation、Invalidation、Target 1の不足アラートを作成する
- **非破壊・冪等**: 所有名は`BUSHIDO-MCP:<analysisIdのSHA-256先頭16桁>:<kind>`に固定する。同名アラートが完全一致すれば再利用し、定義違い、停止済み、重複なら上書き・再開・削除せず停止する。Confirmationだけが欠け、InvalidationまたはTarget 1が既存の場合も、到達済み省略と手動削除を区別できないため後付け作成しない。他のユーザーアラートは名前照合以外の管理対象にしない
- **通信境界**: ログイン済みTradingViewページ内から固定HTTPS originの`create_alert`へPOSTし、`list_alerts`で読み戻す。symbol、resolution、operator、正値level、未来expiration、所有名、300文字以内messageをNode側で検証してからJSON化する。公開APIではなくアプリ内部契約への依存なので、HTTP・応答shape・読み戻しの不一致は成功にせず停止する
- **通知・執行境界**: mobile pushとpopupだけを既定有効とし、soundは任意。email、SMS、Webhookは常に無効で、注文・ブローカー・Pine strategyには接続しない。既存アラートのmodify/restart/delete endpointは実装しない
- **時間と履歴の限界**: expirationは分析期限へ拘束する。作成時点の最新終値がInvalidationまたはTarget 1のTerminal側なら拒否し、Confirmation側ならそのアラートを省略するが、作成前の接触やOHLC内の到達順序を証明しない
- **部分失敗と監査**: 1件ずつ作成し、最初の未検証エラーで停止後、全対象を再取得して`complete/partial`を返す。タイムアウトしたPOSTが実際には到達している可能性があるため自動削除・即時再試行を行わない。完全一致集合だけを既存分析定義hashへ拘束してジャーナルへ追記し、記録失敗でもTradingView上の有効アラートは巻き戻さない

## 追補: バックログ #27(2026-07-20)

`evaluate_due_analyses`追加に伴うレビュー:

- **確認境界**: `confirm:true`なしではチャートを変更せず、候補と推定変更だけを返す。確認後は指定した一つの`chart_index`だけを使い、symbol/timeframe変更、任意の履歴追加、OHLCV取得、評価記録を既存のプロセス内直列キューで実行する
- **対象の信頼境界**: 破損・改ざん検証済みのローカルジャーナル定義を評価ソースとし、配置中Pineや現在のオーバーレイ入力へ依存しない。neutralと既存終端評価を除き、期限到来未評価、非終端再評価、明示指定された有効未評価だけを選ぶ。最大500定義の走査上限と切り詰めを返し、未走査対象がないと推定しない
- **チャート分離**: `setSymbol`と`setResolution`の内部APIを`chart_index`対応にし、対象ペイン以外を変更しない。各切替後にchart context、取得後にOHLCVのsymbol/timeframe/バー有無を再照合し、別symbolやstale resolutionの証拠を評価しない
- **復元規則**: 各分析の成功・失敗にかかわらず元symbol/timeframeへの復元と読み戻しを行う。個別の切替・履歴・評価・journal失敗は次の分析へ進むが、復元不能ではチャート前提が失われるため残件を即時中止する。TradingView UIや別プロセスの同時操作は排他できないため、段階ごとの再照合を省略しない
- **履歴の副作用**: `load_more_bars`既定値は0。明示値がある時だけTradingViewの履歴を追加ロードする。追加済み履歴はアンロードできず元のメモリ状態へ戻せないため、dry-runでpersistent history loadとして表示する。履歴不足、形成中足、同一足順序、ギャップ、暦月は既存評価と同じfail-closed契約を維持する
- **ジャーナル整合性**: 評価は保存済み`definition_hash`へ直接拘束し、別定義への記録を拒否する。同じstatus/outcome/evidence timeframe/evidenceThroughは冪等で、再試行時に重複イベントを増やさない。評価結果が得られた後のjournal失敗はチャート評価を消さず、項目単位のエラーとして保持する

## 追補: バックログ #28(2026-07-20)

`get_analysis_performance`と評価経路指標追加に伴うレビュー:

- **読み取り境界**: 集計ツールは検証済みローカル分析ジャーナルだけを読み、TradingView、CDP、外部HTTP、Pine、アラート、注文、ブローカー口座へ接続しない。ライブ分析だけを対象とし、Strategy Tester・walk-forward・その他バックテストを同じ母集団へ混在させない
- **経路指標の保存**: 評価時にOHLC原本ではなく、Entry帯midpoint、midpoint-to-Stopのstructural risk、MFE/MAE、gross R、経過時間だけをoutcome resultへ保存する。既存64KiBイベント上限、追記専用、definition hash拘束、0600権限を維持する。同一意味・同一証拠の旧イベントにmetricsがない場合だけ一度の拡充追記を許し、metrics付きイベントが存在すれば再度の追記は冪等に抑止する
- **足内不確実性**: activation足とterminal足のHigh/Lowはイベント前後を区別できないためMFE/MAEから除き、terminal水準だけを一点追加する。activation後・terminal前の確定足だけを使うため保守的だが、真の足内excursionを完全には測定しない。曖昧足やギャップを推定でterminalへ変換しない
- **非約定R**: Entry midpointは分析形状の基準であって約定価格ではない。gross Rは価格距離比、net Rは明示された銘柄別往復価格コストをstructural riskで割って控除した参考値であり、金額、lot、口座収益率、実現損益ではない。コスト欠落はゼロ扱いせずnet母集団から除く
- **データ品質**: 最新評価、二値勝敗、実現R、excursion、各時間指標を別母集団として件数を返す。旧レコード、未評価、非二値、未activation、コスト欠落を個別に数え、ゼロ埋めしない。経路指標は`methodologyVersion: "1.0"`だけを採用し、将来の算出法変更を同じ平均へ混在させない。重複symbolのコスト前提は順序依存にせず拒否する
- **集計上限**: 1回に検証済み最新500定義を読み、全件数・走査件数・切り詰めを返す。上限外の履歴を含む完全統計だと主張しない。OSアカウント侵害時のジャーナル改ざん・秘匿性は#20と同じ残余リスクを持つ

## 追補: バックログ #29(2026-07-20)

`set_symbol`/`set_timeframe`のチャート指定一般化に伴うレビュー:

- **明示的な対象ペイン**: 両ツールは任意の`chart_index`を受け取り、省略時だけ現在のactive chartを使う。非負整数かつchart contextに存在するindexを要求し、対象不明のままactive chartへ推測適用しない
- **不変スナップショットと段階検証**: 操作前のsymbol/timeframe/studiesをコピーして保持し、APIが参照オブジェクトを更新しても復元先を失わない。symbol変更後と最終状態で対象ペインを読み戻し、要求値と一致しなければ成功にしない。低レベルAPIの入力検証、JSON文字列化、バー0本拒否も維持する
- **ロールバック**: symbol変更後のtimeframe失敗など部分適用でも、対象ペインだけを元のsymbol/timeframeへ戻して再検証する。復元も失敗した場合は最初の操作エラーを上書きせず、操作原因と復元原因の両方を返す
- **共通トランザクション**: #27の分析ごとの一時切替も同じ変更・復元処理を使う。バッチ開始時の元状態を各候補の直前に再確認し、途中の外部変更を暗黙の新基準として受け入れない。復元不能時は残件を停止する
- **競合と残余リスク**: 公開操作と主要なチャート依存処理は既存のプロセス内`SerialOperationQueue`で直列化する。TradingView UIの手動操作や別MCPプロセスまでは排他できないため、段階ごとの読み戻しで不一致を検出してfail closedする。外部操作が読み戻し後に発生する競合窓そのものは残る

## 追補: バックログ #8 Bar Replay(2026-07-20)

- **限定公開**: 公開する内部APIは状態取得、`selectDate`、`doStep`、`stopReplay`だけ。実機で存在を確認した`buy`、`sell`、`closePosition`、Replay Tradingの損益/position、autoplay、random/first date、replay resolution変更は公開しない
- **開始境界**: `start_chart_replay`はdry-runを既定とし、`confirm:true`、過去のISO日時、active chartの期待symbol/timeframe完全一致、Replay利用可能、既存sessionなしをページ内で再検証してから開始する。日時とsymbolはNode側検証後にJSON文字列化し、開始後20秒以内のstarted/current time読み戻しを要求する。`selectDate`失敗またはタイムアウト時は部分的に開いたsession/toolbarを`stopReplay`で閉じ、cleanupも失敗した場合は元原因とcleanup原因を併記する
- **ステップ境界**: `step_chart_replay`は開始済み・ready・autoplay停止中だけ1〜100本を進める。各`doStep`後にcurrent timeが変わったことを確認し、進まない場合はreached endとして停止する。無期限autoplayやバックグラウンド継続を作らない
- **終了境界**: `stop_chart_replay`もdry-run/confirmを使い、`stopReplay`後にstartedとtoolbarの両方がfalseになるまで読み戻す。終了はチャートをリアルタイム表示へ戻すが、TradingViewが保存する過去のreplay session履歴自体の削除は保証しない
- **リアルタイムとの混在防止**: TradingView公式は、リプレイ中もserver-side alerts、orders、trading panelとquote listをリアルタイム側としている。`get_trade_decision_context`はreplay状態を必須証拠にし、toolbarまたはsession稼働中はOHLC/キーレベルを読まず`decision_status: blocked`にする。チャート証拠取得後にも状態を再確認し、途中でreplayが開始された場合や再確認不能時は取得済み証拠を破棄する。執行quoteを過去時点へ巻き戻したと解釈しない
- **競合と残余リスク**: 4ツールは既存のプロセス内`SerialOperationQueue`で他の主要チャート操作と直列化する。UIや別プロセスの同時操作は排他できず、開始前・開始後・各step・終了後のreadbackで検出する。TradingView内部の非公開API変更は明示エラーとなり、自動でUIクリックへフォールバックしない

## 将来フェーズへの申し送り

- 注文系(`trading`)APIとReplay Tradingは非公開を維持する。アラートは#26の新規作成だけを明示確認付きで公開し、変更・再開・削除・Webhookは公開しない
- ~~スキャナー API(Phase 4)追加時は外部 HTTP 応答のスキーマ検証を入れる~~ → Phase 4 で対応済み(zod 検証)
- CIは#30で導入済み。NodeのLTS/EOL移行時にmatrixと`engines`を更新し、固定済みActions SHAも依存更新として定期レビューする
