# Phase 3 検証結果: インジケーター値の取得(2026-07-07)

## 結論

スタディ(インジケーター)のプロット値と入力パラメータは、内部モデルと `getStudyById` API の組み合わせで完全に取得できる。

## データの所在

### プロット値

- `chart.chartModel().dataSources()` にスタディがデータソースとして存在(`id()` が `getAllStudies()` の id と一致)
- `source.data()._items` — メインシリーズと同じ PlotList 構造。各要素は `value: [time, plot_0, plot_1, ...]`(value[i+1] が `metaInfo().plots[i]` に対応)
- プロットの表示名は `metaInfo().styles[plotId].title`(例: "CHoCH Sell", "BOS Buy")。無題プロットは plot id をそのまま使う
- プロット型 `metaInfo().plots[].type`: `line` / `ohlc_open` などの数値系のほか、`*_colorer`(色の数値)や `alertcondition`(フラグ)というノイズ系がある → **デフォルトで除外**(`include_all_plots: true` で全取得)

### 入力パラメータ

- `chart.getStudyById(id)` → `IStudyApi`(`getInputsInfo()` / `getInputValues()` / `getStyleValues()` / `isVisible()` / `hasError()` / `title()` など)
- `getInputsInfo()`: 定義(name, localizedName, type, defval, min/max/step, tooltip)
- `getInputValues()`: 現在値 `[{id, value}]` — 両者を id でマージして名前付きパラメータにする

## セキュリティ上の重要事項

`getInputValues()` には Pine スクリプト内部入力が含まれる:

- **`text`** — スクリプトソース(保護スクリプトでは暗号化 blob、数KB)。**漏えい防止のため必ず除外**
- `pineId` / `pineVersion` / `pineFeatures` — スクリプト識別子。同じく除外
- さらに 200 文字超の文字列値は切り詰め(防御の2層目)

除外は `src/tradingview.ts` の `HIDDEN` セットで実装し、統合テスト(`test/smoke.mjs`)で漏えいがないことを毎回検証する。

## 制約

- `TradingViewApi.getStudyInputs()`(トップレベル)は "not implemented" — 使えない。`chart.getStudyById()` 経由が正
- プロットを持たない描画専用スタディ(例: Bushido Elliott Wave)は `data().size() === 0`。ラベル・ライン等のグラフィックスは別構造(`graphics()`)であり未対応(必要になったら将来フェーズで)
- 値はチャートにロード済みのバー範囲のみ
