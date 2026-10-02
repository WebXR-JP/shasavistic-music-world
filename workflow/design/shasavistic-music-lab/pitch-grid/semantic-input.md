# 格子入力から意味論型への上半分

この文書は、格子入力から意味論型を組み立て、下半分へ接続する上半分を決める。格子入力から意味論型への純粋変換、根未指定の扱い、空集合、単一経路への切替、上位接続の責務を所有する。下半分の方式は `semantic-chord-playback.md` を参照する。

## 要求元

`requirements/intent/shasavistic-music-world.md:48-51,56-59,63-64`（中央基準・オン集合・機能根・和音とベース）、`requirements/intent/music-semantic-structure.md` の解音・機能根・ベース（同 `:197,198,200`）、兄弟 `semantic-chord.md`（型と解決の正本）、兄弟 `semantic-chord-playback.md`（下位経路の正本）を要求元とする。要求を再定義しない。

## 適用範囲

- 対象は、格子入力から意味論型への純粋変換、根未指定の扱い、空集合、単一経路への切替、上位接続の責務とする
- 親は `workflow/design/shasavistic-music-lab.md` とする
- 対象外は、遠隔同期の新設・厳密化、音色分離、時間・メロディー、ホスト・物理出力とする。正本は各兄弟に置き、この文書で定めない

## 確定した方式

### 純粋変換

置き場所は `shasavistic-music-lab/src/audio/pitchGridSemanticChord.ts` を想定し、公開は `toPitchGridSemanticChord(input)` とする。

- 入力は検査済みの格子入力（オン点の座標、選択次元、機能根の座標、解音位置、ベース指定、配置済みの各点の指数 `k`）とし、`SemanticChord` を作る
- 座標 `(x, y)` は横指数（素数3）に `x`、縦指数（選択主要次元の素数）に `y`、素数2は配置指数 `k` を写す。選択次元の素数を `p` とし、各点の配置済み指数を `E(q) = { 2: kq, 3: xq, p: yq }`、解音は `E(s) = { 2: 0, 3: 0, p: 0 }` とする。対応表は既存 `PITCH_GRID_HORIZONTAL_PRIME`・`verticalPrimeFor` を再利用し、新設しない。`k` は配置結果の値をそのまま受け取り、配置の抽出・複製・再実行、`log2` 逆算、`soundingCandidatesFor` からの選び直しは行わない。発音口の `{key, frequency}` は変更しない。配置結果契約の正本は `pitch-assignment.md` を参照する
- 解音位置 `s`・機能根 `r`・各点 `q` として、`functionalRootOffset = E(r) − E(s)`、`toneOffsets = E(q) − E(r)`（根自身は除外）、ベース `b` として `bass = E(b) − E(r)` とする。各写像は `{ primeExponents: ... }` で包む。差分は整数指数で求め、周波数や約分済み比率から逆算しない。周波数を指数合成には使わない。配置の欠落・重複・集合外鍵・非整数 `k` は拒む
- 空集合は和音を作らない
- 解音の選択・機能根の推定・ベースの自動導出・音域最適化は行わない
- 上限は二層とする。上限の正本は `pitchGridSound.ts` の `PITCH_GRID_MAX_VOICES` とし、`PITCH_GRID_POINT_COUNT` は格子点数であって上限の正本ではない。上位はオン点＋ベースが上限を超える場合に拒否し（要求 `:64` による上限内扱い）、下位は仕様数が上限を超える場合に最終拒否する。型層は声数を数えない

### 解音

解音は格子中央に固定する。全体音高基準と解音の役割の区別は保つ。解音周波数 `G` は上位から `PITCH_GRID_BASE_FREQUENCY_HZ` を明示して渡す（配置が中央の発音に選んだ周波数を `G` にしない。session の既定値は使わない）。接続と合成の正本はこの文書とし、声管理契約の正本は `pitch-grid/live-audio.md` を参照する。

### 既定の機能根

オン集合が空でない間は常に定まる共有意図をそのまま読む。遷移・由来・読み取り境界・表示の正本は `pitch-grid/remote-sync.md` を参照し、この文書で選び直さない。純粋変換は正規化済み共有意図の根と由来を読むだけとし、自動選択を訪問者指定と偽装しない。

### 配置

格子発音は既存の集合単位配置を維持する。既存の動的計画法が選んだ素数2の指数を整数 `k` で受け取り、意味論型の明示位置として渡す。周波数から `log2` で逆算せず、配置を別実装しない。ベースの素数2の指数 `k` の出所は配置方針の確定待ちとし、確定まではベースの `k` 欠落を拒む仮扱いとする。配置方針確定時に見直す（見直し条件のベース配置による）。ベース配置は未確定として人間の判断へ戻す（明示指数を保持するか共同配置するかの選択、最低音・同音・音域外指定の扱いが決まれば定められる）。

### 経路と所有

単一経路へ切り替える。置き場所は `shasavistic-music-lab/src/audio/pitchGridSemanticController.ts` を想定し、`createPitchGridSemanticSoundReflector` が意図の読み替え・組立て・配置接続・session のライフサイクルを束ねる。反映の受付は `PitchGridIntent` で行い、境界で正規化してから読む。

- 発音口を直接更新せず、session だけが書き込む
- 空集合は `stop()` とする
- 失敗はローカル表示へ届け、意図を巻き戻さない
- 次元判定を session と二重に持たない
- 発音への経路は単一とし、二経路併存・入力条件による自動フォールバックはしない

### 状態所有

共有意図の唯一の所有者は `useInstanceState` とする。選択モードは端末ローカルとする。`SemanticChord`・配置結果・解決周波数は派生値とする。session・音声資源・実発音一覧・失敗状態は端末ローカルとする。機能根は既存の共有項目を使い、独立したローカル所有を作らない。今回は遠隔同期の新設・厳密化・ホスト保証は対象外とし、既存共有経路を迂回しない。

### 表示

ピアノ表示のため、session に限定した読取り快照・変更通知を追加し、`PitchGridSound.soundingVoices`／`subscribeSounding` を中継する。発振器は公開しない。意図から周波数を再計算した表示で代用しない。方式の正本は `pitch-grid/sounding-piano.md` を参照する。

### 競合

新鍵が声継続契約を保てるか（根・配置変更での再発音・尾音重複）、未完了反映中の連続更新で古い完了が新しい判定・表示を上書きしないかを、最小の制御で扱う。汎用キュー・常設診断基盤は先行構築しない。証拠が必要になったら再相談とする。

## 採用しない案

- 直ちに置換すること。接続・検証の到達点が分かれるため。下半分単独は未検証、ベース込みは未確定であり、いずれも実装・計測前なので達成済みとしない。既存配置の `k` を正しく伝達すればベースなしの上半分＋下半分で既存の220–1760Hz・間隔目的を保持しうるが、下半分単独は未達であり、ベース込みは未確定のためMVP全体では未達とする
- 二経路併存、条件フォールバック、根未指定時の代替経路の使用。所有の二重化を招くため
- 周波数からの逆算、配置の別実装。既存配置の正本と二重化するため
- 解音の訪問者指定・和音導出。今回は中央固定のため

## 未確定の候補

いずれも要求判断が必要であり、人間の判断へ戻す。

- ベースの音域・最低音・同音関係と配置
- 16声対応
- 遠隔同期の厳密化
- ホスト・物理出力

## 見直し条件

- 声継続契約を新鍵で保てないとき
- 連続反映を小さな制御で扱えないとき
- ベース配置が既存目的と両立しないとき
- 16声対応が必要になったとき

## 検証との接続

方針のみを定め、具体値と判定手順は検証側へ置き、この文書に複製しない。

- 新規 `shasavistic-music-lab/src/audio/pitchGridSemanticChord.test.ts` が所有する判定は、純粋変換（根と解音の差、各構成音と根の差、根の重複なし、単音・二音の保持、配置指数の伝達、根変更で同じ格子点の解決音高を保つこと、解音再基準化で音高関係を保つこと、入力非変更、不正入力拒否）とする
- 新規 `shasavistic-music-lab/src/audio/pitchGridSemanticController.test.ts` が所有する判定は、統合（他の発音口を生成せず単一 session を使うこと、空集合で無生成と停止、表示が実発音一覧から更新されること、上限拒否で部分反映しないこと、根・配置変更と連続次元変更と再開失敗と停止・破棄の競合、`voiceCount` を容量判定に使わないこと）とする
- 既存検査（`pitchGridSound.test.ts` 等）の保証を維持し、意味論経路の検査は新規へ置く
- 実操作・実信号は既存採取基盤を使い、操作から意図・組立て・session・実音声グラフを通す採取を、実発音の完成を主張する段階で追加する。代替物への呼出し記録だけで接続完了としない

## 参照

- `requirements/intent/shasavistic-music-world.md:48-51,56-59,63-64`（格子・機能根・和音とベースの要求の参照元）
- `requirements/intent/music-semantic-structure.md:193-200`（静的な和音とベースの要求の参照元）
- `workflow/design/shasavistic-music-lab/semantic-chord.md`（型と解決の正本の参照元）
- `workflow/design/shasavistic-music-lab/semantic-chord-playback.md`（下位経路の正本の参照先）
- `workflow/design/shasavistic-music-lab/pitch-grid.md`（格子操作の親の参照元）
- `workflow/design/shasavistic-music-lab/pitch-grid/remote-sync.md`（共有意図の正本の参照先）
- `workflow/design/shasavistic-music-lab/pitch-grid/pitch-assignment.md`（配置の正本の参照先）
- `workflow/design/shasavistic-music-lab/pitch-grid/sounding-piano.md`（ピアノ表示の正本の参照先）
- `shasavistic-music-lab/src/audio/pitchGrid.ts`（対応表の参照先）
- `shasavistic-music-lab/src/audio/pitchGridSound.ts`（発音口と表示一覧の参照先）
- `shasavistic-music-lab/src/audio/semanticChord.ts`（意味論型の参照先）
- `workflow/design/shasavistic-music-lab.md`（親。分担と境界の参照元）
- `workflow/design/AGENTS.md`、`workflow/AGENTS.md`（設計と検証の運用規則の参照元）
