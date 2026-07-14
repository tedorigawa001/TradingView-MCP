# 為替・金 環境認識の設計方針

## 1. 目的

TradingView-MCP で取得できるチャート、テクニカル、経済イベントを統合し、USDJPY、EURUSD、GBPUSD、XAUUSD の環境認識を再現可能な手順で生成する。

本設計の目的は、相場の方向を断定することではない。次の情報を分離して提示し、エントリー候補の質と検証可能性を高めることである。

- 上位足を含む方向性
- トレンド、レンジ、高ボラティリティなどの相場レジーム
- ドル要因と銘柄固有要因の整合性
- エントリー可能性と無効化条件
- 経済イベントおよび執行条件による取引不適格状態
- 判断根拠、データ時刻、信頼度、不確実性

## 2. 設計原則

### 2.1 予測と売買判断を分離する

方向予測が正しくても、直近の抵抗帯までの距離が短い、損切り幅が大きい、重要指標が迫っている、といった場合は取引適格性が低い。システムは最低でも次を別々に評価する。

1. `direction`: 上昇、下落、中立
2. `regime`: トレンド、レンジ、高ボラティリティ、イベント、判定不能
3. `setup_quality`: エントリー余地、無効化点、期待損益比を含む品質
4. `trade_permission`: 取引候補、待機、見送り

### 2.2 指標は役割ごとに扱う

単純な多数決は行わず、各データを次の責務へ割り当てる。

| 役割 | 主なデータ |
|---|---|
| 方向 | 日足・4時間足の市場構造、EMA20、SMA50、SMA200 |
| 勢い | ADX、RSI、価格変化率 |
| 執行タイミング | 5分・15分・30分の構造、BOS、CHoCH、VWAP 回帰 |
| 無効化 | 反対方向の構造ブレイク、主要 S/R、直近スイング |
| 利確候補 | 次の流動性、S/R、Donchian、VWAP、ATR 到達幅 |
| 取引抑止 | 重要イベント、異常スプレッド、低流動性、データ欠損 |

### 2.3 相場レジームを方向判定より先に決める

同じシグナルでも、トレンドとレンジでは意味が異なる。方向スコアを計算する前にレジームを分類し、利用する条件と閾値を切り替える。

- `trend`: ADX、移動平均線の配列、市場構造が同方向
- `range`: ADX が低く、移動平均線が密集し、構造ブレイクが継続しない
- `high_volatility`: ATR が過去分布の上位帯、またはイベント後の急拡大
- `event`: 高重要度イベント前後の停止時間帯
- `unknown`: 必須データの欠損、時刻不整合、判定条件の競合

ADX など単一指標だけで確定せず、最低2種類の独立した根拠を要求する。

### 2.4 ライブ観測と過去の検証結果を混同しない

- ライブ判断には取得時刻付きの価格、テクニカル、金利、経済イベントを使う。
- バックテスト結果は過去の統計的根拠としてのみ使い、現在方向の根拠にはしない。
- 最適化期間内の上位パラメータを本番採用済みとは扱わない。
- 出力する根拠は `current_observation`、`historical_evidence`、`inference`、`unresolved` に分類する。

## 3. 対象銘柄と補助市場

### 3.1 主要対象

- `OANDA:USDJPY`
- `OANDA:EURUSD`
- `OANDA:GBPUSD`
- `OANDA:XAUUSD`

### 3.2 補助市場

ドル主導か銘柄固有かを判定するため、取得可能性を確認したうえで次を利用する。

- DXY または同等のドル指数
- 米国2年・10年国債利回り
- 日本10年国債利回り
- 米国実質金利
- 必要に応じて EUR、GBP、JPY の通貨指数

補助市場が取得できない場合は黙って省略せず、信頼度を下げて `unresolved` に理由を記録する。

## 4. 時間足の責務

| 時間足 | 主な責務 |
|---|---|
| 日足 | 大局方向、長期移動平均線、主要レジーム |
| 4時間足 | 実務上の方向、主要構造、重要 S/R |
| 1時間足 | 当日の推進・調整、セッション間の接続 |
| 30分足 | セットアップ形成の確認 |
| 15分足 | バイアスと短期構造 |
| 5分足 | エントリー候補のタイミング |

上位足と下位足が不一致の場合は、下位足シグナルを上位足の転換と即断しない。`pullback`、`countertrend`、`transition` のいずれかとして明示する。

Bushido Scalp v1 を評価する場合は、通常の環境認識とは別バージョンとして扱い、M1 入力、3分執行、15分バイアス、セッション VWAP という既存仕様を維持する。

## 5. データ取得パイプライン

### 5.1 基本フロー

1. `get_chart_context` で表示銘柄、時間足、インジケーター、アクティブチャートを確認する。
2. `get_mtf_overview` で対象銘柄を一括取得する。
3. `get_key_levels` で表示チャートの主要 S/R と出所を取得する。
4. 必要な場合のみ `get_indicator_values`、`get_indicator_graphics`、`get_indicator_tables` で詳細を補う。
5. `get_economic_events` で対象通貨のイベントを取得する。
6. 補助市場、スプレッド、金利、ニュースを新鮮な情報源から補完する。
7. 取得時刻、データ源、欠損、形成中バーの有無を保存する。

### 5.2 データ品質ゲート

次のいずれかに該当した場合は、通常の判定を返さず `unknown` または `wait` とする。

- シンボルまたは時間足が依頼内容と一致しない
- レイアウト名と実チャートだけを取り違えている
- 必須時間足のデータが欠損している
- データ源ごとの価格差が許容範囲を超える
- 形成中バーを確定足として扱っている
- インジケーターがエラー、非表示、再計算中である
- タイムゾーンまたはイベント時刻を確定できない
- スプレッドや執行コストを取得できず、短期戦略の期待値を評価できない

## 6. 判定モデル

### 6.1 スコアの構成

初期実装では説明可能なルールベースを採用し、機械学習モデルは十分な検証データが整うまで導入しない。

`direction_score` は `-100` から `+100`、`confidence` は `0` から `100` とする。方向スコアと信頼度を混同しない。

| コンポーネント | 初期重み | 例 |
|---|---:|---|
| 上位足方向 | 30 | 日足・4時間足の構造と移動平均線 |
| 中位足整合 | 20 | 1時間・30分の方向一致 |
| ドル・金利整合 | 20 | DXY、米金利、金との相互確認 |
| 勢い | 10 | ADX、RSI、変化率 |
| 位置 | 10 | S/R、VWAP、Donchian、ATR 距離 |
| セッション | 5 | 対象銘柄に適した時間帯 |
| イベント・データ品質 | 5 | 通常時のみ加点。危険時はゲートで抑止 |

重みは仮説であり、固定された正解ではない。ウォークフォワードとアブレーションで有効性を確認し、銘柄・戦略バージョン別に管理する。

### 6.2 ドル整合性

4銘柄を独立に判定するだけでなく、ドル方向の共通因子を評価する。

- USDJPY 上昇、EURUSD 下落、GBPUSD 下落、XAUUSD 下落、DXY 上昇が揃う場合はドル高の整合性が高い。
- 一部だけが逆行する場合は、その銘柄固有要因またはレジーム転換を疑う。
- 相関は固定値とせず、ローリング期間で確認する。
- 相関の崩れをエラー扱いせず、銘柄固有要因の検出材料として使う。

### 6.3 イベントゲート

初期値として、高重要度イベントの前後は新規セットアップを抑止する。停止時間はイベント種別、銘柄、時間足別に設定し、検証結果なしに一律の本番値へ固定しない。

- 発表前: 方向スコアを維持しても `trade_permission=wait`
- 発表直後: スプレッドと ATR が正常化するまで待機
- 発表後: 予想差、実績差、初動、戻りを別々に記録
- 中銀発言: 終了時刻が不確実なため、固定時刻だけで解除しない

## 7. 出力契約

環境認識の出力は銘柄ごとに次を含める。

```json
{
  "symbol": "OANDA:USDJPY",
  "as_of": "ISO-8601",
  "decision": "long_bias | short_bias | neutral | wait",
  "confidence": 0,
  "regime": "trend | range | high_volatility | event | unknown",
  "evidence": [],
  "entry_condition": [],
  "invalidation": [],
  "stop_basis": [],
  "targets": [],
  "risk_reward": null,
  "event_risk": [],
  "alternate_scenario": [],
  "data_quality": {
    "status": "ok | partial | blocked",
    "missing": [],
    "forming_bar_used": false
  }
}
```

価格水準は根拠となるインジケーターまたは市場構造を併記する。信頼度の数値だけを返さず、加点・減点の理由を人が追跡できるようにする。

## 8. 検証方針

### 8.1 評価単位

方向の的中率だけでは評価しない。最低限、次を銘柄、時間足、セッション、レジーム、イベント状態別に集計する。

- 方向精度
- 確率または信頼度のキャリブレーション
- Brier score または log loss
- エントリー後の最大順行幅・最大逆行幅
- コスト控除後の期待値、Profit Factor、最大ドローダウン
- 見送り判断を含むカバレッジ
- レジーム遷移時の誤判定率

### 8.2 必須検証

- 時系列を守ったウォークフォワード
- 最適化に使わない最終ホールドアウト
- 現実的な往復スプレッド、スリッページ、手数料
- パラメータ近傍の安定性
- 特徴量を1つずつ外すアブレーション
- リペイント、未来参照、確定足前取得の検査
- 銘柄間相関を利用する場合の同時刻整合性検査
- 十分なサンプル数とレジーム別の偏り確認

Bushido Scalp v1 の既存ハードニング結果は、2020年から2025年を対象にしたインサンプルの候補選定であり、そのまま本番適格性の証明には使わない。仕様上の2 pips比較と実装上の2 ticksにも差があるため、コスト単位を確定して再検証する。

## 9. 実装フェーズ

### Phase A: 説明可能な環境スコア

- 既存の `get_mtf_overview`、`get_key_levels`、`get_economic_events` を統合する。
- 4銘柄の方向、レジーム、主要レベル、イベント危険度を共通形式で返す。
- データ品質ゲートと取得時刻を実装する。
- 判定結果と根拠を JSON で保存できる形にする。

### Phase B: ドル・金利・執行条件

- DXY、国債利回り、実質金利の取得可否とティッカーを確定する。
- ローリング相関とドル整合性を追加する。
- スプレッド、ATR パーセンタイル、セッション状態を追加する。
- イベント前後の抑止時間を銘柄別に検証する。

### Phase C: 履歴評価と校正

- 判定時点の入力と将来リターンを再現可能な形式で記録する。
- ウォークフォワード、ホールドアウト、コストストレスを実施する。
- 重みと閾値を銘柄・レジーム別に校正する。
- アブレーションにより不要な特徴量を削除する。

### Phase D: PDCA 運用

- 予測、判断、結果、失敗理由を一つの検証単位として保存する。
- 変更ごとに戦略バージョンを付け、過去結果を上書きしない。
- 改善判定は単一期間の成績ではなく、複数期間・複数レジームの安定性で行う。
- ライブ運用候補への昇格は、未使用期間、コストストレス、十分な取引数を満たした後に判断する。

## 10. 非目標と安全境界

- 本機能は注文の発注、変更、決済を行わない。
- 認証情報、口座情報、注文 API キーを取得・保存しない。
- 数値スコアを利益保証や確定予測として表示しない。
- データ欠損時に推測値で補完して正常判定を返さない。
- バックテスト結果だけから現在の相場方向を推定しない。
- ユーザーの明示的な承認なしに外部共有、アップロード、公開リンク作成を行わない。

## 11. 暫定仕様と残る未決事項

この節の数値は、実装を開始するための初期仮説である。`provisional` としてバージョン管理し、ウォークフォワード、アブレーション、コストストレスの結果なしに本番確定値へ昇格させない。

### 11.1 補助市場の標準ティッカーとデータ源

2026-07-13 に TradingView の `get_quotes` で取得可否を確認した結果を初期構成とする。

| 用途 | 標準ティッカーまたは系列 | データ源 | 状態 |
|---|---|---|---|
| ドル指数 | `TVC:DXY` | TradingView scanner | 取得確認済み |
| 米国2年国債利回り | `TVC:US02Y` | TradingView scanner | 取得確認済み |
| 米国10年国債利回り | `TVC:US10Y` | TradingView scanner | 取得確認済み |
| 日本10年国債利回り | `TVC:JP10Y` | TradingView scanner | 取得確認済み |
| ドイツ10年国債利回り | `TVC:DE10Y` | TradingView scanner | 取得確認済み |
| 英国10年国債利回り | `TVC:GB10Y` | TradingView scanner | 取得確認済み |
| 米国10年実質金利 | `US_TREASURY_PAR_REAL_CMT_10Y`（DFII10相当） | 米国財務省 Daily Treasury Par Real Yield Curve Rates | 公式XMLで取得実装済み |

銘柄別の初期参照セットは次とする。

- USDJPY: DXY、米国2年、米国10年、日本10年、米日10年金利差
- EURUSD: DXY、米国2年、米国10年、ドイツ10年、米独10年金利差
- GBPUSD: DXY、米国2年、米国10年、英国10年、米英10年金利差
- XAUUSD: DXY、米国10年、米国10年実質金利

`US_TREASURY_PAR_REAL_CMT_10Y` は日次の遅いマクロ要因として扱い、短期エントリーのトリガーには使わない。主経路はキー不要の [米国財務省 Daily Treasury Par Real Yield Curve Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?page=0&type=daily_treasury_real_yield_curve) とし、公式 [Treasury XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) の `TC_10YEAR` を取得する。FRED `DFII10` は同等系列の参照名としてのみ扱い、実行時フォールバックには使わない。

入力値は百分率で `-25 <= value <= 25` の十分広い健全性境界を適用する。範囲外、未来日、最新日欠損、不正な日時形式は補完せず `unavailable` とし、分析入力から遮断する。

財務省XMLの観測日とfeedの`updated`は実際の初回公表時刻を証明しない。MCPが値を初めて受信して追記専用履歴へ永続化できた時刻を`first_seen_at`として記録し、`available_at=first_seen_at`、`available_at_basis=local_first_seen`、`point_in_time_status=observed_first_seen`とする。これは公式公表時刻ではなく、このインストールが利用可能性を確認できた保守的な下限である。永続化前、保存失敗、または`as_of < first_seen_at`では`point_in_time_status=blocked`を維持し、バックテストへ混入させない。`publication_time_unavailable`も残す。鮮度は休日を推定せず、観測日の翌日からの平日経過数を保守的に数え、2平日超で`stale`とする。

年次XMLから取得した有効行は、最新行だけでなく同一取得時刻で全件照合する。1月中は当年と前年の年次XMLを照合し、前年末の遅い改訂を追跡する。それより古い年の後発改訂まで完全に監視するものではない。初回導入時の過去行も公表日へ遡及せず、そのインストールで実際に受信した時刻を`first_seen_at`とする。同一観測日の値遷移は、過去と同じ値へ戻る場合も新しい`sequence`の改訂版として追記し、旧版を上書きしない。履歴照会は`as_of`以前にfirst-seen済みの版だけを対象に、観測日、first-seen、sequenceの順で最新の版を選ぶ。

履歴は既定で`~/.tradingview-mcp/real-yield-first-seen.jsonl`へ保存し、`TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH`で変更できる。ディレクトリ`0700`、ファイル`0600`、`O_NOFOLLOW`、descriptor検証、fsync、プロセス内直列化、ロックファイルによるプロセス間排他を要求する。途中行を含む破損JSONL、時計後退、所有者不一致、ロック失敗は黙って復旧せず履歴利用を`blocked`にする。

現行 `get_quotes` は要求したティッカーに該当データがなくても、その銘柄を結果から黙って除外する。環境認識で利用する前に、要求集合と応答集合を照合し、欠落を `partial` またはエラーとして返す必要がある。

### 11.2 鮮度 SLA と価格差

通常の市場時間における初期 SLA を次とする。

| データ | 最大経過時間 | 超過時の扱い |
|---|---:|---|
| FX・XAU の bid / ask | 5秒 | 短期セットアップを `blocked` |
| DXY | 15秒 | ドル整合性を `partial` |
| 国債利回り | 60秒 | 金利整合性を `partial` |
| 米財務省10年実質金利 | 2営業日 | XAUUSD のマクロ信頼度を減点 |
| 経済カレンダー | 15分 | イベントゲートを `blocked` |

チャート、scanner、補助データ間の価格差は、固定 pips ではなく次で判定する。

```text
allowed_difference = max(2 * current_spread, 0.05 * ATR(14))
```

`get_quotes` では `bid` と `ask` を取得できるが、`spread` 列は `null` だったため `ask - bid` で算出する。ただし同一応答内でも `close` が bid / ask 範囲外になる例があり、フィールドの更新時刻が完全には同期していない可能性がある。短期戦略で SLA を適用するには、MCP 応答へ少なくとも次を追加する。

- MCP が取得を完了した `observed_at`
- データ源が提供する場合の `source_updated_at`
- リクエスト所要時間 `latency_ms`
- `requested_symbols`、`returned_symbols`、`missing_symbols`

ソース更新時刻を取得できない場合、`observed_at` は受信時刻であって市場データの生成時刻ではないことを明示し、品質を `partial` とする。

### 11.3 ATR パーセンタイル

ボラティリティ比較には価格水準の影響を抑えるため、`ATR(14) / close` を使う。時間足ごとに別系列として計算し、形成中バーを除外する。

| 区分 | 初期閾値 |
|---|---:|
| 基準期間 | 直近60取引日 |
| 低ボラティリティ | 20パーセンタイル以下 |
| 通常 | 20超、80未満 |
| 高ボラティリティ | 80以上 |
| 極端 | 95以上 |

サンプル不足時は異なる時間足の値で補完せず `unknown` とする。閾値は銘柄、時間足、セッション別にウォークフォワードで再校正する。

### 11.4 イベント停止時間

初期イベントゲートは次とする。方向スコア自体は保持しても、新規エントリー可否を `wait` に変更する。

| イベント | 発表前 | 発表後の最低待機時間 |
|---|---:|---:|
| FOMC、政策金利、CPI、雇用統計 | 60分 | 30分 |
| PPI、GDP、小売売上高 | 30分 | 15分 |
| その他の中重要度指標 | 15分 | 10分 |
| 中銀要人発言 | 開始30分前 | 終了確認後15分 |

発表後は時間経過だけで解除せず、次をすべて満たすことを要求する。

- 現在スプレッドが同銘柄・同セッションのローリング中央値の1.5倍以下
- 5分ATRがイベント前基準の2倍以下
- 発表後に最低2本の5分確定足が形成済み
- 続報または質疑応答中ではない

イベントの影響通貨と対象銘柄を対応付ける。特に米国の高重要度イベントは4対象銘柄すべてへ適用し、XAUUSD では実質金利と DXY の急変も解除判定に使う。

### 11.5 最低期待損益比

全銘柄・全レジームに共通の固定 R 値だけでは判定しない。推定勝率 `p` と往復コスト `cost_r` から、損益分岐に必要な平均利益を計算する。

```text
required_reward_r = (1 - p + cost_r) / p
```

初期ゲートは次とする。

- 通常のトレンドセットアップ: コスト控除後の到達可能な利益が `1.5R` 以上
- Bushido Scalp v1: 既存仕様の初期 TP `1.3R` を維持し、別バージョンとして期待値を再検証
- 次の反対側 S/R までに必要 R を確保できない: `trade_permission=skip`
- 勝率が未校正またはサンプル不足: R 値だけで取引候補へ昇格させない

Bushido Scalp v1 の `1.3R` は設計意図であり、既存の最適化結果だけでは将来の期待値を保証しない。平均勝ち、平均負け、早期決済、コストを含む実測分布で評価する。

### 11.6 信頼度の校正と表示

ルールベースの初期点数は確率ではないため、検証前は `confidence` ではなく `evidence_score` として返す。

```json
{
  "evidence_score": 72,
  "calibrated_probability": null,
  "calibration_status": "not_calibrated",
  "sample_count": 0,
  "confidence_interval": null
}
```

ウォークフォワードのアウトオブサンプル予測を蓄積後、スコア帯ごとの実現率を計測し、isotonic regression または Platt scaling のうち検証成績が安定する方法で校正する。評価には Brier score、log loss、reliability diagram を使う。

確率を表示する条件は次とする。

- 同一の銘柄、予測時間幅、判定バージョンで集計している
- レジーム別の偏りを確認している
- `sample_count` と信頼区間を併記する
- 校正に使った期間と最終評価期間が分離されている

### 11.7 標準コストモデル

コストの正規形は、pips や ticks ではなく価格単位・片道とする。pips と ticks は表示用の派生値として保持する。

```json
{
  "symbol": "OANDA:EURUSD",
  "spread_price": 0.00015,
  "slippage_price_per_side": 0.00002,
  "commission_price_per_side": 0,
  "source": "observed | modeled",
  "session": "London",
  "percentile": "P50",
  "observed_at": "ISO-8601"
}
```

コスト検証は最低3シナリオで実施する。

- Base: 同銘柄・同セッションの観測スプレッド P50
- Stress: P90 スプレッドとスリッページ
- Severe: P95 スプレッド、イベント近傍、保守的スリッページ

履歴データに bid / ask がなく、OHLC が bid、ask、mid のどれか確認できない場合は、ゼロコストとせず外部モデルを加算する。ブローカーや口座種別を確認できない手数料を暗黙にゼロとしない。

既存仕様の `2 pips` とハードニング実装の `2 ticks` は別シナリオとして保持する。後者は EURUSD の `tick_size=0.00001` では片道 `0.00002`、一般的な pip 表現で0.2 pipに相当するため、同じ試験名を使わない。

### 11.8 M1 タイムゾーンとセッション変換

**状態: 未解決。短期戦略の最終評価をブロックする。**

現在の EURUSD / GBPAUD M1 CSV はタイムゾーンを含まない日時文字列で、ローダーも naive `datetime` として解釈する。ファイル内容だけでは UTC、JST、ブローカーサーバー時刻のいずれかを確定できない。

解決には次の証拠を優先順に確認する。

1. データ配布元、エクスポート設定、生成ログのタイムゾーン表記
2. 既知の市場休場・再開時刻との一致
3. CPI、雇用統計、政策金利など既知イベント直後の1分足との照合
4. 夏時間切替週における流動性パターンの1時間移動

確定後は入力時刻へ IANA タイムゾーンを付与して UTC に正規化し、セッション判定時だけJSTへ変換する。固定 `+9` などの補正をデータ自体へ上書きしない。由来を確定できないデータでセッション別最適化を本番根拠に使わない。

### 11.9 最終ホールドアウトと昇格基準

**状態: 未解決。新しい将来データの蓄積が必要。**

EURUSD の既存ファイルは2025年末までで、2020年から2025年はすでにパラメータ探索に使われている。GBPAUD には2026年2月までのデータがあるが、約2か月だけでは最終ホールドアウトとして不十分である。

初期方針は次とする。

- 現在のルール、パラメータ、コストモデルをバージョン付きで凍結する。
- 2026年以降の未観測データを最低6か月、できれば12か月蓄積する。
- 蓄積期間中に結果を見てルールを変更した場合、変更日以降を新バージョンの評価開始点とする。
- 2020年から2025年の再分割はウォークフォワード検証には使えるが、完全未使用ホールドアウトとは呼ばない。
- 別ブローカーの独立データは頑健性確認に使えるが、価格形成とコスト差を明示する。

ライブ候補への昇格には、最低限次を要求する。

- 完全未使用期間でコスト控除後期待値が正
- Base と Stress の両方で許容基準を満たす
- Profit Factor、最大ドローダウン、年・月別安定性を確認
- パラメータ近傍で成績が急落しない
- 銘柄・レジーム別に十分なサンプル数がある
- データ欠損、時刻由来、リペイント、未来参照の監査が完了

昇格基準の具体的な Profit Factor、最大ドローダウン、最低取引数は、口座資金とポジションサイズのモデルが確定するまで数値固定しない。

### 11.10 決定状況

| 項目 | 状態 | 次のアクション |
|---|---|---|
| 補助市場ティッカー | 実装済み | 財務省実質金利のfirst-seen履歴化・as-of照会まで実装済み |
| 鮮度・価格差 | 暫定決定 | source timestamp の取得可否を調査 |
| ATR 基準 | 暫定決定 | 銘柄・時間足別ウォークフォワード |
| イベント停止時間 | 暫定決定 | イベント前後の実測で校正 |
| 最低期待損益比 | 暫定決定 | 勝率校正とコストRを接続 |
| 信頼度 | 方針決定 | OOS 予測を蓄積して確率校正 |
| コストモデル | 方針決定 | セッション別 spread 分布を収集 |
| M1 タイムゾーン | 未解決 | 配布元情報と既知イベントで監査 |
| 最終ホールドアウト | 未解決 | 凍結後の2026年データを蓄積 |

## 12. 機関投資家活動の代理指標

### 12.1 基本認識

現物FXは OTC の分散市場であり、単一ブローカー、単一取引所、単一チャートから市場全体の注文フローを直接観測できない。そのため、本設計では「大口を検知した」「機関投資家が買っている」と断定しない。

観測対象の名称は `institutional_activity_proxies` とし、複数市場に現れた機関投資家活動の代理証拠を統合する。各証拠は次のいずれかへ分類する。

- `direct_positioning_proxy`: 規制報告や取引所建玉など、集計されたポジション代理情報
- `market_participation_proxy`: 先物出来高、建玉変化、流動性などの参加活発度
- `risk_pricing_proxy`: オプション IV、リスクリバーサル、期間構造などの保険需要
- `macro_repricing_proxy`: 金利差、OIS、実質金利、DXY などのマクロ再評価
- `price_behavior_proxy`: VWAP、価格受容、流動性スイープ、市場構造などの価格結果

BIS の FX 調査は市場全体を多数の銀行・ディーラーから集計しており、単一フィードが世界の現物FX出来高を代表しないことを前提にする。[BIS Triennial Central Bank Survey](https://www.bis.org/statistics/rpfx25_fx.htm)

### 12.2 証拠の優先順位

| 優先 | 証拠 | 頻度・公開遅延 | 用途 | 限界 |
|---|---|---|---|---|
| A | CME 通貨・金先物の価格と出来高 | リアルタイムまたは遅延配信 | 数分から数時間の参加増加、ブレイク確認 | 現物FX・ロンドン金市場全体ではない |
| A | 米国と相手国の2年金利・OIS変化 | リアルタイムから数分 | 金融政策期待の再評価 | 安全需要、需給、発言にも反応する |
| A | セッション VWAP、価格受容、市場構造 | 各確定バー | 執行位置、継続・拒否の確認 | 参加者を特定できない |
| A | オプション ATM IV、25 delta RR、期間構造 | リアルタイムから前日終値 | イベントリスクと方向別保険需要 | ヘッジ需要は方向予測と一致しない場合がある |
| B | 先物・オプション建玉 | 当日速報、翌営業日確報 | 新規参加、巻き戻し、混雑度 | OI 増加だけではロング・ショートを区別できない |
| B | CFTC COT / TFF | 火曜時点を通常金曜公表 | 数日から数週間のポジショニング・混雑レジーム | 短期トリガーには遅すぎる |
| B | 流動性スイープ後の再受容 | 各確定バー | 短期セットアップ | 単なるボラティリティでも同形状になる |
| C | LBMA 金取引・清算統計 | T+1、有料、週次または月次 | XAUUSD の中期市場活動 | 清算量は方向別フローではない |
| C | 中央銀行介入・外貨準備 | 発表ベース | 介入・構造レジーム | 公表が遅く短期予測には不向き |

CFTC COT は各火曜日の建玉を通常金曜日に公表する週次データであり、短期エントリーへ直接加点しない。[CFTC COT overview](https://www.cftc.gov/MarketReports/CommitmentsofTraders/AbouttheCOTReports/index.htm)

CME の出来高・建玉は、日次速報と翌営業日の確報が異なる可能性がある。バックテストとライブ判断では、速報・確報の区別と `available_at` を保存する。[CME Volume and Open Interest](https://www.cmegroup.com/market-data/volume-open-interest.html)

### 12.3 銘柄別の参照市場

| 対象 | 先物・オプション代理 | ポジショニング | マクロ代理 |
|---|---|---|---|
| EURUSD | CME Euro FX (`6E`) | CFTC TFF | 米欧2年金利差、DXY |
| GBPUSD | CME British Pound (`6B`) | CFTC TFF | 米英2年金利差、DXY |
| USDJPY | CME Japanese Yen (`6J`) | CFTC TFF | 米日2年金利差、DXY |
| XAUUSD | COMEX Gold (`GC`) | CFTC Disaggregated COT | 米実質金利、米10年、DXY、LBMA |

`6J` は USDJPY と価格表現の方向が逆になるため、比較用リターンの符号を明示的に変換する。すべての先物・オプションには次を必須メタデータとする。

- `venue`
- `instrument`
- `contract_month`
- `expiry`
- `roll_state`
- `spot_price`
- `futures_price`
- `basis`
- `observed_at`
- `source_at`
- `available_at`
- `publication_status: preliminary | final`

現物と先物の価格差には短期金利差と満期までの期間が含まれるため、basis と限月ロールを補正せずに先物変化を現物フローへ読み替えない。[CME FX futures pricing and basis](https://www.cmegroup.com/education/courses/introduction-to-fx/importance-of-fx-futures-pricing-and-basis)

### 12.4 正規化と判定規則

COT、出来高、OI は生の枚数だけで比較しない。

- COT: `net_position / total_open_interest`
- COT: 前週差と過去3年パーセンタイル
- 出来高: 同契約・同セッションのローリング Z score
- OI: 前日差、前週差、価格変化との4象限
- オプション: ATM IV、25 delta RR、期間構造、満期、ストライク別 OI
- 金利: 水準より1時間差、1日差、イベント前後差を優先

#### COT正規化の実装規則（2026-07-14）

`get_positioning_context` は分類ごとに `net_position / total_open_interest`、直前レポートからの生net差と正規化比率差、過去3暦年パーセンタイルを返す。TFFとDisaggregatedの分類間、および同一レポート内の分類間を混合しない。

- 公開入力の履歴件数は互換性のため1〜52週とし、内部では同一CFTC契約コードの最大250行をウォームアップとして取得する。
- パーセンタイルの参照集合は現在レポートを除く `[t - 3暦年, t)` の有効値のみとする。未来値は含めない。
- 順位は `100 * (count(x < x_t) + 0.5 * count(x = x_t)) / N` のmid-rankとする。
- 有効参照が150件未満、3年窓の開始付近へ到達しない、またはOIが0以下の場合、パーセンタイルや比率を推測せず `null` とする。
- 直前レポート間隔が6〜8日以外の場合は `previous_report_status=irregular_gap` とし、週次補間しない。
- 同一契約・同一report dateが複数返った場合は任意の行を採用せずエラーにする。
- USDJPYでは6J（Japanese Yen futures）と対象価格の方向が逆になるため、生の`net_open_interest_ratio`を保持したうえで、派生値へ`target_direction_multiplier=-1`を適用する。3年パーセンタイルも変換後の`target_oriented_net_open_interest_ratio`を母集団とする。
- GBPJPYとGBPAUDのBritish Pound COTはGBP側だけの代理情報であるため、`proxy_scope=base_currency_single_leg`を付け、クロス全体のポジショニングと解釈しない。
- CFTC応答から実公表時刻を取得できないため `available_at=null` を維持し、`point_in_time_status=blocked` とする。report dateから金曜公表時刻を推定して過去検証へ使用しない。

価格と OI の4象限は参加状態の仮説としてのみ使う。

| 価格 | OI | 仮説 | 断定禁止事項 |
|---|---|---|---|
| 上昇 | 増加 | 新規参加を伴う上昇 | 新規ロングだけとは限らない |
| 上昇 | 減少 | ショートカバーの可能性 | 買い手不在とは限らない |
| 下落 | 増加 | 新規参加を伴う下落 | 新規ショートだけとは限らない |
| 下落 | 減少 | ロング清算の可能性 | 売り手不在とは限らない |

証拠強度を上げるには、価格、先物参加、オプション、金利、ポジショニングのうち最低3系統が同方向または整合的であることを要求する。ただし同じドル因子を表す DXY、EURUSD、米金利差などを独立証拠として二重加点しない。

欠損データを中立値やゼロで補完せず、`unavailable` として依存する評価項目を `partial` または `blocked` にする。COT、OI、LBMA、財務省実質金利は観測対象日ではなく公表日時以後にのみバックテストで利用する。

### 12.5 表現上の禁止事項

次の表現または推論を禁止する。

- 長いヒゲを「大口のストップ狩り」と断定する
- VWAP 反発を「機関投資家の買い支え」と断定する
- 出来高急増を「大口買い」と断定する
- OI 増加を「新規ロング」と断定する
- オプション OI の多いストライクを「必ず止まる壁」と扱う
- COT を現在進行中の現物FXフローとして扱う
- Dealer ポジションを Dealer 自身の相場観と解釈する
- TradingView の現物FX tick volumeを市場全体の実出来高と呼ぶ
- Order Block、FVG、流動性スイープだけで参加者を特定する

出力では「大口が買っている」ではなく、次の形式を使う。

> 先物出来高、金利差変化、オプションスキュー、価格受容が上方向で整合し、機関投資家活動を示唆する代理証拠が強い。ただし現物FX全体の注文フローを直接観測したものではない。

### 12.6 出力契約

```json
{
  "institutional_activity_proxies": {
    "status": "ok | partial | unavailable",
    "evidence_score": 0,
    "direction": "up | down | mixed | unknown",
    "direct_positioning_proxy": [],
    "market_participation_proxy": [],
    "risk_pricing_proxy": [],
    "macro_repricing_proxy": [],
    "price_behavior_proxy": [],
    "independent_evidence_groups": 0,
    "limitations": [],
    "missing_sources": []
  }
}
```

この `evidence_score` も校正前の証拠点数であり、機関投資家が売買した確率ではない。

## 13. MCP 事前実装要件

### 13.1 責務境界

MCP サーバーへ取得、判断、保存、評価のすべてを集約しない。

| レイヤー | 責務 | 副作用 |
|---|---|---|
| MCP data adapter | 許可されたデータの取得、スキーマ検証、単位正規化 | 読み取りのみ |
| Snapshot coordinator | 取得ウィンドウ、欠落、鮮度、source skew の品質判定 | なし |
| Analysis engine | リターン、金利差、相関、ATR順位などの決定論的特徴量 | なし |
| Decision policy | 方向、レジーム、`wait`、証拠スコア | なし、バージョン必須 |
| Evaluation pipeline | 将来ラベル、ウォークフォワード、校正、監査ログ | ローカル追記専用 |
| Presentation | 人間向け説明と根拠表示 | なし |

MCP はデータ取得と再現可能な汎用特徴量までを提供する。売買方向や信頼度は、バージョン付きの Decision policy へ分離する。スナップショット保存はMCPの公開ツールにせず、ローカルの評価パイプラインが追記専用で行う。

### 13.2 実装優先順位

| 優先度 | 機能 | 配置 | 実装前に必要な理由 |
|---|---|---|---|
| P0 | データ利用許諾ゲート | 運用・設定 | 許諾のない非表示利用を防ぐ |
| P0 | `get_market_snapshot` | MCP | 同一取得ウィンドウと品質状態を保証する |
| P0 | quotes 欠落・bid/ask・spread正規化 | scanner adapter | 短期判断のfail-closedに必要 |
| P0 | 共通時刻・出所メタデータ | 全adapter | 鮮度とpoint-in-time再現性に必要 |
| P1 | `get_aligned_history` | MCP | 複数市場を確定足で整列する |
| P1 | `get_positioning_context` | MCP | COT、先物出来高・OIを遅延付きで取得する |
| P1 | indicator audit manifest | evaluation pipeline | リペイント指標をスコアから除外する |
| P1 | `compute_market_features` | Analysis engine | 相関・金利差・ATR順位を純粋計算する |
| P1 | append-only snapshot log | evaluation pipeline | OOS検証と再読込差分に必要 |
| P2 | オプション IV・RR・期間構造 | licensed adapter | データライセンスと費用を確認後に追加 |
| P2 | LBMA金データ | licensed adapter | XAUUSDの中期補完。方向フローではない |

### 13.3 `get_market_snapshot`

#### 入力

```json
{
  "targets": ["OANDA:USDJPY", "OANDA:EURUSD"],
  "auxiliary_profile": "fx_macro_v1",
  "timeframes": ["5", "15", "30", "60", "240", "1D"],
  "required_quote_fields": ["close", "bid", "ask"],
  "include_events": true,
  "strict": true
}
```

`auxiliary_profile` はバージョン付きレジストリとし、対象銘柄ごとの標準ティッカー、単位、代替データ源、鮮度上限をコード化する。任意ティッカーの自由入力と標準プロファイルを区別する。

#### 出力

```json
{
  "schema_version": "1.0",
  "snapshot_id": "uuid",
  "status": "ok | partial | blocked",
  "request_started_at": "ISO-8601",
  "request_completed_at": "ISO-8601",
  "latency_ms": 0,
  "max_source_skew_ms": null,
  "requested_symbols": [],
  "returned_symbols": [],
  "missing_symbols": [],
  "symbols": [],
  "events": [],
  "sources": [],
  "quality_issues": []
}
```

完全な同一時点取得は保証せず、`request_started_at` から `request_completed_at` までを同一取得ウィンドウと定義する。各データ点には次を持たせる。

- `observed_at`: MCP が受信した時刻
- `source_at`: データ源が示す市場データ時刻。取得不能なら `null`
- `available_at`: その値を利用可能と判定できる最早時刻。公式公表時刻でない場合は`available_at_basis`を必須にする
- `available_at_basis: publication | local_first_seen | unavailable`
- `timestamp_basis: source | received | bar_open | publication`
- `latency_class: realtime | delayed | end_of_day | weekly`
- `unit`
- `venue`
- `provisional`

`observed_at` を `source_at` の代用にしない。source timestampがないデータは短期SLAを証明できないため、その依存項目を `partial` とする。

#### 品質状態

- `ok`: 必須対象、必須項目、時刻、鮮度、スプレッドがすべて合格
- `partial`: 補助データ欠損またはsource timestamp不明だが、限定的な環境説明は可能
- `blocked`: 必須対象、bid/ask、確定足、イベントゲートのいずれかを検証できない

短期判断を `blocked` にする条件は次とする。

- 必須シンボルが欠落
- 重複シンボル、未知の余剰行、非有限値
- bid または ask が欠損
- `ask < bid`、ゼロ、負値、異常スプレッド
- pip size または tick size が未確定
- 必須時間足が欠損
- 形成中バーが履歴特徴量へ混入
- source skew が設定上限を超過
- イベント情報の鮮度を確認できない

### 13.4 quote 正規化

現行 `get_quotes` は要求集合と応答集合を照合せず、一部ティッカーの欠落を成功扱いする。一方、`get_mtf_overview` は欠落を検知している。環境認識用スナップショットでは必ず集合を照合する。

```json
{
  "symbol": "OANDA:EURUSD",
  "bid": 1.16842,
  "ask": 1.16857,
  "mid": 1.168495,
  "spread_price": 0.00015,
  "spread_pips": 1.5,
  "pip_size": 0.0001,
  "tick_size": 0.00001,
  "spread_status": "observed"
}
```

scannerの `spread` 列が `null` の場合は `ask - bid` から計算し、`spread_status=derived_from_bid_ask` とする。`close` はbid/askと非同期更新の可能性があるため、midの代用にしない。

### 13.5 `get_aligned_history`

複数銘柄、補助市場、先物の確定足を共通UTC時間軸へ整列する。返却値には次を必須とする。

- `alignment_policy`
- `timeframe`
- `window_start`、`window_end`
- `observations`
- `missing_ratio`
- `max_source_skew_ms`
- `forming_bars_excluded`
- `contract_rolls`
- `basis_adjustment`

異なる時間足からの補完、未来方向の forward fill、形成中バーの混入を禁止する。サンプル不足、時刻ずれ、欠損率超過では fail-closed とする。

### 13.6 `get_positioning_context`

COT、CME出来高・OI、利用可能なオプション情報を、公開遅延と代理性を含めて返す。

```json
{
  "symbol": "OANDA:EURUSD",
  "as_of": "ISO-8601",
  "status": "ok | partial | unavailable",
  "futures": [],
  "options": [],
  "cot": [],
  "limitations": [],
  "missing_sources": []
}
```

FX の COT は TFF 分類、金は Disaggregated 分類を使用する。Dealer、Asset Manager、Leveraged Funds、Producer、Swap Dealer、Managed Moneyを混合しない。DealerのヘッジをDealer自身の方向予測へ読み替えない。

### 13.7 インジケーター監査

形成中バーの除外だけではリペイント対策として不十分である。Pine では `request.security()`、pivot、`varip`、`timenow`、`calc_on_every_tick`、履歴開始位置などで履歴値とリアルタイム値が変化し得る。[TradingView repainting documentation](https://www.tradingview.com/pine-script-docs/v5/concepts/repainting/)

インジケーターごとに監査マニフェストを作り、未監査のものは証拠スコア対象外とする。

```json
{
  "pine_id": "USER;...",
  "version": 1,
  "audited_at": "ISO-8601",
  "uses_request_security": false,
  "uses_pivots": false,
  "uses_varip": false,
  "uses_timenow": false,
  "calc_on_every_tick": false,
  "restart_diff_checked": true,
  "status": "approved | restricted | rejected"
}
```

リアルタイム取得値を追記専用ログへ保存し、チャート再読込後の同一バー値との差分を自動検査する。

### 13.8 予測タスク識別子

「方向精度」を評価する前に、何を予測するかを固定する。

```text
symbol x decision_timeframe x forecast_horizon x label_definition x cost_model x policy_version
```

価格が利確・損切りの両方へ到達した場合、同一バー内の順序を確定できない場合、イベントでギャップした場合のラベル規則を事前定義する。予測期間が重なる場合は、ウォークフォワードの訓練・校正・評価間に purge / embargo を設ける。

### 13.9 Definition of Ready

環境認識機能の実装開始条件を次とする。

- TradingViewおよび各データ源の利用許諾を確認済み
- MCP、Analysis engine、Evaluation pipelineの責務境界が確定
- `inputSchema`、`outputSchema`、`schema_version`が確定
- `ok | partial | blocked` の判定表が確定
- timeout、retry、rate limit、部分成功のエラー契約が確定
- 最大銘柄数、時間足数、列数、呼出予算が確定
- チャート操作の同時実行制御と復元保証が確定
- データ保存先、保持期間、機密情報除外が確定
- 予測タスク識別子とラベル規則が確定
- P0受入テストが作成済み

MCPツールは `inputSchema` だけでなく、可能な限り `outputSchema` と structured result を提供し、ツール実行エラーと正常な `partial` を区別する。[MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

### 13.10 P0 受入テスト

- 10銘柄要求・9銘柄応答で欠落銘柄を列挙し、必須なら `blocked`
- API行順が変わっても要求順を維持
- bid / ask欠損、逆転、非有限値、異常スプレッドを拒否
- source timestamp不明時に短期SLAを `ok` にしない
- MTFの一部時間足が `null` の場合に依存項目を `partial` または `blocked`
- scanner成功・calendar失敗時の状態を必須度に応じて区別
- 取得ウィンドウまたはsource skew超過を拒否
- 形成中バーを履歴計算から除外
- COT、財務省実質金利、OIを `available_at` より前のバックテストへ混入させない
- 先物ロールと6Jの方向変換を検証
- インジケーター再読込後の値差分を検出
- schema version、重複 snapshot id、追記専用性を検証
- 相関計算の時刻ずれ、欠損率、サンプル不足を拒否

### 13.11 評価スナップショットのポイント・イン・タイム固定

評価CLIはスナップショット保存時に、ローカルの実質金利first-seen履歴を照会して`evaluation_context.real_yield_10y`へ証拠を固定する。通常の評価時点は取得ウィンドウ終端の`request_completed_at`とし、canonical ISO-8601 UTC形式だけを受理する。明示的な`--as-of`は、時刻を持たないインポート済みスナップショットの補完、または取得完了時刻より前への保守的な切り戻しに限る。`request_completed_at`より後の指定は先読みとなるため拒否する。

固定されるコンテキストは次の形とする。

```json
{
  "evaluation_context": {
    "as_of": "2026-07-01T12:00:00.000Z",
    "as_of_basis": "request_completed_at | explicit_override",
    "real_yield_10y": {
      "status": "partial | unavailable",
      "value": 2.1,
      "first_seen_at": "2026-07-01T10:00:00.000Z",
      "history_sequence": 42,
      "point_in_time_status": "observed_first_seen | blocked"
    }
  }
}
```

照会は`first_seen_at <= as_of`の版だけを対象とし、現在の財務省XMLを再取得しない。対象時点までに保存済みの版がなければ`value=null`、`point_in_time_status=blocked`を証拠として残し、ゼロ、最新値、観測日ベースの推定値で補完しない。履歴の破損、所有者・権限不一致、ロック失敗など履歴の完全性を証明できない場合は評価ログへのスナップショット追記そのものを中止する。入力済みの`evaluation_context.real_yield_10y`も上書きせず、予約領域の衝突として拒否する。同じ`snapshot_id`のsnapshotレコードは、評価ログのプロセス間ロック下で重複検査して2件目を拒否し、異なる`--as-of`の証拠を同一IDへ併存させない。

この固定はバックテスト再現性のためのマクロ文脈であり、米国10年実質金利を5分・15分・30分足の直接エントリートリガーへ昇格させない。特にXAUUSDでは鮮度超過や`blocked`をマクロ証拠の欠落として扱い、価格、DXY、名目金利など独立した短期証拠を代替せず、評価時に欠測群として分離する。

## 14. データ利用許諾と本番ゲート

TradingView の現行利用規約は、プラットフォームの市場データをdisplay-only用途に限定し、アルゴリズム判断を含むnon-display利用や、それを可能にする第三者ツールを禁止している。個人利用、注文を出さないこと、ローカル実行だけでは、この制限が自動的に解消されるとは限らない。[TradingView Terms of Use](https://www.tradingview.com/policies/)

したがって、TradingView由来のデータ抽出・加工を環境スコアや機械判断へ使う本番実装は、TradingViewおよび関連データプロバイダーの書面許諾または適切なデータライセンスを確認するまで `blocked` とする。

許諾を確認できない場合は、次の構成へ切り替える。

- TradingView: 人間が直接見るチャート表示と、許可されたアトリビューション付きスナップショット
- ライブ価格・bid/ask: ブローカーの正式API
- 金利・実質金利: 中央銀行、財務省、FRED等の公式API
- COT: CFTC公式データ
- 先物・オプション: CME等のライセンス済みフィード
- 分析・評価: 上記データ源から独立したローカルエンジン

この節は法的助言ではなく、設計上の利用許諾リスクをfail-closedで扱うための運用ゲートである。規約、契約、データライセンスが変更された場合は再確認し、確認日と適用範囲を記録する。
