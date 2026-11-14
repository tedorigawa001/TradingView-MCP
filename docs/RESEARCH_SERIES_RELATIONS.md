# 系列の別名・派生関係と拡張履歴照合 (106-5)

`record_research_series_relations` は、確認付きで系列定義・別名・派生の期間対応・関連・撤回を専用台帳へ追記する。`check_research_series_history` は、それらを明示的に使い、利用歴または試行履歴を調べる。チャート・市場データ・外部資料・モデル・検定・バックテストは実行しない。

既存の記録・照会・preflight・再送経路は変更せず、関係台帳も読み込まない。拡張照会が実行許可や未使用データの証明を与えることはない。

## 記録の契約

記録入力は `{ records: [...], confirm: true }`。1回1〜20件。全件を入力検査・参照検査・関係検査・容量検査してから追記する。記録順は意味を持つ。参照先の系列定義は先に登録する。同一entry_id・正規化後に同じ入力は元の行を返し、変更した入力の再送は拒否する。配列の順序は保持する。再送時は既存のdurability処理で同期を確認する。

| kind | 内容 |
|---|---|
| `series` | 版を固定した系列定義。`entry_id`, `series_id`, `data_version`, `identity`, `role`, `from`, `to`, `evidence_sha256`。rootのみ`root_id`必須、derivedには指定不可 |
| `alias` | `entry_id`, `left`, `right`, `from`, `to`, `evidence_sha256`。左右は系列定義のentry_id。双方向、同じrole・identityが必要 |
| `derivation` | `entry_id`, `child`, `recipe_sha256`, `mapping_schema`, `windows`, `evidence_sha256`。childはderived系列の定義ID |
| `related` | `entry_id`, `left`, `right`, `from`, `to`, `reason`, `evidence_sha256`。同一化しない未解決の関連情報 |
| `revoke` | `entry_id`, `target`, `reason`。activeな系列定義または関係のentry_idを撤回する。撤回自体の撤回は不可。必要なら新しいentry_idで再登録 |

`identity` は厳格なオブジェクト:

```json
{
  "provider": "synthetic-provider",
  "feed": "explicit-feed-and-region",
  "instrument": "EURUSD",
  "price_basis": "mid",
  "unit": "USD",
  "timestamp_semantics": "bar_open_utc",
  "formation_sha256": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
}
```

formation_sha256は、セッション、タイムゾーン・DST、集約起点、端数、欠損、調整・改訂方針などを含めた系列形成規則を識別する。フィード名や価格の類似だけで別名としない。同じroot_idを付けた定義はidentityが一致しなければ拒否する。異なるroot_id間の別名も、identityが一致した範囲でのみ利用する。data_versionは各版のハッシュのまま保持し、系列の対応から値の一致を推定しない。

identityとreasonの文字列は前後の空白を除き1〜240文字。識別子は既存台帳と同じ英数字・`_.:-`の1〜120文字。hashは`sha256:`と小文字hex64文字。未知の項目、疎配列、不正型は拒否する。すべての区間はcanonical UTCの`[from,to)`、from < to。seriesの区間はその定義について申告する対応可能範囲、aliasはその両定義の範囲内で指定する。

系列のroleがrootとは、この照合における終端の原データ系列だという申告。root_idの一致、formation/evidenceのハッシュ、自由記述は出所の認証や真偽の独立確認ではない。台帳は手動の申告根拠を固定する機能であり、対応する文書・データ本文を取得して検証しない。

## 派生の期間対応

初期のmapping_schemaは`declared_support_windows_v1`だけを受け付ける。61分足や日足の形成を推測せず、研究側で確認した対応表を登録する。例は説明用であり実際の登録ではない:

```json
{
  "entry_id": "mapping-61m-v1",
  "kind": "derivation",
  "child": "definition-61m-v1",
  "recipe_sha256": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "mapping_schema": "declared_support_windows_v1",
  "windows": [{
    "from": "2024-01-02T00:00:00.000Z",
    "to": "2024-01-03T00:00:00.000Z",
    "supports": [{
      "parent": "definition-m1-v1",
      "from": "2024-01-01T22:00:00.000Z",
      "to": "2024-01-03T01:00:00.000Z"
    }]
  }],
  "evidence_sha256": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
}
```

1定義につきactiveな派生は1件、最大32窓、1窓最大8入力。窓同士の重複は拒否し、隙間は未解決として残す。子窓は子の定義範囲内、親区間は親の定義範囲内で指定する。recipe_sha256は子のformation_sha256と一致させる。適用期間を無視して別名成分をまとめた場合も含め、派生循環は保守的に拒否する。

子区間が窓の一部だけでも、親側には申告したsupportsの全区間を採用する。これは申告した依存範囲の保守的な照合であり、各バーの実読取りを観測した証拠ではない。窓を細かく分けると過大な範囲を抑えられる。複数入力はすべて必要とする。lookback・推定期間・結果判定期間は対応表に含め、照合器はさらに加算しない。旧記録の区間の意味や依存範囲を確認できない場合は、対応表を作らず未解決を維持する。

## 照合

```json
{
  "target": "usage",
  "mode": "shared_source",
  "series": [{
    "series_id": "measurement-61m",
    "data_version": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }],
  "from": "2024-01-02T00:00:00.000Z",
  "to": "2024-01-03T00:00:00.000Z"
}
```

targetは`usage`または`trials`。modeは必須で`exact` / `aliases` / `shared_source`。seriesは1〜20個の異なる系列ID・版の組。rules_versionは省略時も明示時も`research_related_history_v1`だけを受け付け、ほかの版へ切り替えない。未知の項目は拒否する。試行数の旧照会には対象版の必須項目を追加しない。

- exactは現行と同様、系列IDと元の記録区間で照合し、全研究・全データ版を含む。関係台帳を生成・読取りしない。
- aliasesは系列定義の版を固定し、各別名の適用区間をたどる。派生はたどらない。
- shared_sourceは照会側と各保存記録側の両方を親区間に変換する。各辺をその段階の時刻定義で切り取り、終端root_idと区間の交差を比較する。系列名・共通root_idだけで期間の重複とはしない。
- 完全一致で見つかった記録は拡張モードでも必ず保持する。shared_sourceは適用期間内で確認できた別名一致も保持し、元データの対応が不足していてもその件数・集計値を失わない。保存済み各版を照合対象から除外せず、定義のない版は未解決とする。試行セットのseries_idsは各IDについて調べる。
- aliasからたどれる別定義の派生規則も利用できる。複数経路から同じ記録へ到達してもaccess_id / trial_set_idで1回だけ数える。実際に繰り返したアクセスは別記録のまま。

結果は`research_related_history_v1`。has_known_overlapとresolution_completeを別々に返す。状態はknown_overlap、no_known_overlap_in_snapshot、inconclusive。未解決の一部があっても既知の一致を隠さず、申告依存範囲に基づく集計値を返す。不明な系列定義・区間・入力、relatedの存在は未解決となる。完全解決でも登録済み情報の範囲内の判断であり、未記録・外部の利用は証明しない。

shared_sourceで元区間から一致を得られず、別名で一致を確認できた記録は、match_basisをaliasesとしてその交差区間と経路を返す。元区間の不足はresolution_complete:falseとunresolvedに残し、別名の一致を元データ対応の証明にはしない。同じsnapshot・区間・系列についてaliasesからshared_sourceへ広げても既知の該当集合・報告数・netを減らさない。元区間から追加の一致を得た場合も、同じ記録を二重計上しない。両方の解決は同一の固定した関係台帳と同一の探索・状態・サポート上限を共有し、上限エラーを別名一致へのフォールバックで隠さない。

別名の追加照合は、元区間の比較で一致せず、照会側・記録側の両方が不完全な系列の組に限る。片方の解決が完全なら、その系列を含む別名一致は元区間比較でも見つかるため、別名だけの再解決を省く。複数系列では完全性を各系列ごとに扱い、完全な系列が一部に存在するだけでほかの不完全な組まで省略しない。省略は照合の重複を減らす処理であり、未解決理由の収集・resolution_complete・既知の件数やnetを変更しない。

related10件・片側だけ完全・不一致の合成記録で、計数ステップを次のとおり確認した。元実装はf59ce9e、全不一致で別名を再確認する版はf995737。計測は一時コピーのみで行い、公開応答や台帳の形式は維持する。経過時間や本番データでの性能保証ではない。

| 記録数 | 元実装 | 全不一致で再確認 | 完全性に基づく省略後 |
|---|---:|---:|---:|
| 600 | 9,013 | 17,426 | 9,013 |
| 800 | 12,013 | 上限エラー | 12,013 |
| 1,200 | 18,013 | 上限エラー | 18,013 |

matchesは最大100行で、元の記録とexact/aliases/shared_sourceの根拠、最大5個の交差区間・経路を示す。各経路の表示は32要素までで、切り詰めを明示する。集計は表示を切り詰める前の全該当記録を使う。未解決理由は総数と最大100件を返す。上限エラー時は集計結果を返さず、ゼロ・完全解決へフォールバックしない。

## スナップショットと時点

拡張照会は対象台帳→関係台帳の順にロックを取得する。両方を保持して検証済みprefixを固定し、登録時刻を含む固定内容だけを持ち帰って計算する。関係登録は関係台帳だけをロックし、逆順の取得はしない。照合中に追加・撤回されても固定内容は変更しない。

結果のsnapshotsはtargetとregistryの組で、それぞれnamespace・sequence_end・prefix_sha256を持つ。ハッシュは改行を含む保存済みUTF-8のprefix全体に対するSHA-256。同じ入力・規則版・snapshotで集計を再現できる。結果のsnapshotsを次の照会入力へそのまま渡せる。exactではtargetだけを指定する。namespace不一致、記録範囲の欠落、ハッシュ不一致は停止する。後続部分も現在の台帳のネイティブな検証を通る必要があり、後続破損を無視して古いprefixだけを読む復旧機能ではない。

checked_atは今回の照合時刻。関係のrecorded_atはサーバーによる登録・撤回時刻。from/toというデータ上の適用期間と区別する。現在の関係を使った過去期間の再評価は、当時その関係を記録・認識していた証拠ではない。指定snapshotの再照会でもchecked_atは新しい時刻になり得る。

## 試行数と互換性

該当する試行セット集合を一意化した後で、既存と同じ計算を行う。報告数は各configuration_countの合計。集合内で初めて評価された数は、各セットのconfiguration_countからreuses合計を引いて合算する。集合外の参照元ごとに再利用数の最大値を合算し、それを足したものがnet。初回10設定＋その10設定の再評価が両方該当すれば報告20/net10。部分期間の一致でもセット全体を数え、按分しない。

旧reusesの共通の完全一致系列ID・記録順・試行時刻・参照元の初回設定数上限などの検査は変更しない。別名から参照を自動生成せず、手動の参照を別名だけで許可することもしない。netは独立な試行数ではなく、申告に基づく下限。

旧記録のID・data_version・本文・ハッシュ・連番・再送結果を変更しない。既存のperiod/trialチェックも従来どおりで、新しい照会とは別物。関係の訂正はrevokeと新entry_idの登録で行い、旧行は残す。撤回した系列定義への関係は、同じ系列ID・版の新定義へ自動再接続しない。

## 保存と上限

既定は`~/.tradingview-mcp/research-series-relations.jsonl`。`TRADINGVIEW_MCP_SERIES_RELATIONS_PATH`で変更できる。新窓口を使うまでストアは生成されず、旧窓口からは新ファイルへアクセスしない。複数プロセスでは同じ絶対パスを指定する。相対パスは各プロセスのcwd基準で、環境変数の`~`は展開しない。旧readerはこの新しいnamespaceを読めないため、既存台帳へ合流させない。新窓口は既知の台帳・宣言の保存先とのパス/実ファイルの衝突を拒否する。

| 上限 | 値 |
|---|---:|
| 関係台帳 / 1行 | 8 MiB / 16 KiB |
| 関係台帳の総記録 | 8,192 |
| active系列定義 / 関係 | 512 / 1,024 |
| 照会対象の利用歴または試行記録 | 4,096（現在の台帳全体） |
| 探索・比較ステップ | 20,000 |
| 状態 / 生成する区間サポート | 各8,192 |
| 内部経路・依存スタックの要素 | 64 |
| 新窓口の各ロック待ち | 2秒（キュー待ちを含む） |

待ち上限はファイルシステムI/Oや処理全体の実時間を保証しない。ロック取得には既存エンジンの再試行があるが、処理本体を自動再実行しない。照会でもディレクトリと一時ロックファイルの作成・削除を伴い得る。型・所有者・通常ファイル・symlink・framing・連番・時計・同期・追記の安全性には既存エンジンを使う。破損・容量超過・読取り失敗は停止する。

## 範囲と未確認事項

forward宣言の別名解決・排他判定、旧preflightへの統合、原データの取得・照合、各形成規則の実計算は対象外。execution_allowed・unused_proven・candidateEligibleは常にfalse。監視への採用不可条件と既存STOPを維持する。

検証は一時ディレクトリの合成記録とインメモリMCPのみ。v1の保存済み行・定義ハッシュ・改行を含むprefixのハッシュを独立計算したfixtureで固定する。不正なUTF-8は置換文字へ変えてハッシュせず拒否する。本番の関係登録、実際の出所・期間対応の正しさ、複数クライアントへの稼働版反映は未確認。コミット・実チャート操作・DOT起動・外部モデル実行・実データのバックテストは未実施。
