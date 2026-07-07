# Phase 0 検証結果(2026-07-07)

環境: macOS / TradingView Desktop 3.3.0 (Electron 38.2.2, Chrome 140)

## 結論

**CDP 経由のアクセスは完全に成立する。** さらに、ページ内にチャーティングライブラリの正規 API(`window.TradingViewApi`)が露出しており、DOM 解析なしで構造化データの取得と操作が可能。

## 検証項目と結果

| 項目 | 結果 | 備考 |
|---|---|---|
| `--remote-debugging-port=9222` 付き起動 | ✅ | フラグは無効化されていない。`http://localhost:9222/json` でターゲット一覧取得可 |
| チャートページの特定 | ✅ | `type: "page"` かつ URL が `tradingview.com/chart` のターゲット |
| スクリーンショット (`Page.captureScreenshot`) | ✅ | Retina 解像度でチャート・インジケーター・ウォッチリストまで鮮明 |
| JS 実行 (`Runtime.evaluate`) | ✅ | `returnByValue` + `awaitPromise` で JSON 値を直接取得 |
| シンボル・時間足の取得 | ✅ | `TradingViewApi.activeChart().symbol()` / `.resolution()` |
| インジケーター一覧 | ✅ | `chart.getAllStudies()` → `[{id, name}]` |
| OHLCV 取得 | ✅ | `chart.chartModel().mainSeries().bars()._items`。各要素は `value: [time, O, H, L, C, volume]`(time は unix 秒)。ロード済みの約300本が取得可 |
| `chart.exportData()` | ❌ | "Data export is not supported" — デスクトップビルドでは無効。上記の内部モデル経由で代替 |
| シンボル変更 | ✅ | `chart.setSymbol(symbol, callback)` |
| 時間足変更 | ✅ | `chart.setResolution(resolution, callback)` |

## `window.TradingViewApi` の主な API(将来フェーズ候補)

- `watchlist()` — ウォッチリスト API(Phase 4)⚠️ **Phase 4 で "not implemented" と判明**。REST 経由で代替([phase4-findings.md](phase4-findings.md))
- `alertService` / `showCreateAlertDialog` — アラート連携(Phase 4)
- `searchSymbols` — シンボル検索
- `getStudyInputs` / `getStudyStyles` — インジケーターのパラメータ取得
- `replayApi` — リプレイモード
- `pineEditorApi` — Pine Script エディタ
- `takeScreenshot` / `takeClientScreenshot` — ネイティブスクリーンショット(CDP 版で代替済み)
- `createStudy` / `removeEntity`(chart 側)— インジケーターの追加・削除

## 注意点

- 通常起動中はデバッグポートが開かない。**アプリを終了してからフラグ付きで再起動**が必要:
  `open -a TradingView --args --remote-debugging-port=9222`
- `_items` など `_` 付きは内部実装。アプリ更新で壊れる可能性があるため、抽出ロジックは `src/tradingview.ts` に隔離してある
- OHLCV はチャートにロード済みのバーのみ。より過去のデータはスクロール(`setVisibleRange`)で追加ロードが必要(未実装)
