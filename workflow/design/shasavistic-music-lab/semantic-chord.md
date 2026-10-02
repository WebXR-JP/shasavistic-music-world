# 静的な和音とベースの意味論型と純粋変換

この文書は、時間変化を含まない静的な和音とベースの意味論型と、解音周波数を与えたときの純粋変換だけを決める。実発音経路への接続、操作表示、音色の作り分け、時間と演奏進行は扱わない。

## 適用範囲

対象は意味論型の保持と解音基準の解決までとし、発音口への接続は対象外とする。接続先の発音口と格子操作の方式は兄弟と既存実装を参照する。発音口への接続の方式は `semantic-chord-playback.md` を参照する。探索用の調波シンセ配下には置かない。

- 親は `workflow/design/shasavistic-music-lab.md` とする
- 実発音経路（`harmonicChord`、`pitchGridSound`）への変換口、操作表示、音色分離、時間と演奏進行は対象外とする
- 和音図の表示基準線（主音線）と線構造プレビューは兄弟 `pitch-grid/chord-diagram.md` を参照する。本項目の解音基準とは別の表示規約であり、混同しない

## 要求元

`requirements/intent/music-semantic-structure.md:193-200` の静的な和音とベースと `requirements/intent/shasavistic-music-world.md:63,68`（`:63` は静的な和音とベースの要求、`:68` は時間再生を対象外とする根拠）を要求元とする。要求を再定義しない。

- 和音とベースの音高は解音を基準として定めること
- 機能根は解音からの相対移動、他の構成音とベースは機能根からの相対移動で表すこと
- 相対移動は相対音高空間の各次元の整数移動量とすること
- ベースは構成音と音高の表し方を共通にしながら発音上の役割として区別すること
- 単音と二音の発音は成立した和声としないこと

## 確定した方式

### 型

置き場所は `shasavistic-music-lab/src/audio/semanticChord.ts` を想定する。公開は当該単位の名前付き書き出しまでとし、ワールド外部公開口へ追加しない。

- `SemanticPitchOffset` は `HarmonicPrimeDimensions` とする。鍵は次元番号ではなく素数とする。次元番号と素数軸の対応は `requirements/reference/relative-pitch-space.md:8-22` と既存対応表（`pitchGrid.ts:18-19,58-93`）を再利用し、新設や複製をしない
- `SemanticPrimaryDimension` は `PitchGridDimension` とする
- `SemanticChord` は全項目読み取り専用とし、次を持つ
  - `primaryDimension`（必須。使用指数だけでは指数ゼロの主要次元や未選択の文脈を判別できないため）
  - `functionalRootOffset`（解音から機能根への移動）
  - `toneOffsets`（機能根から他の構成音への移動。機能根自身は暗黙に含め、ここへ再記載しない）
  - `bass?`（機能根からベースへの移動。単一で省略可。役割の区別は別項目で表す）
- 含めないものは次とする。音色詰め、時間再生、保存読込は別層の責務とする
  - 名称表記、波形、時間、演奏進行、永続化識別子、前もって用意した音色指定
- 実行時の深い凍結は契約に含めない

### 純粋変換

公開関数は `resolveSemanticChord(chord: SemanticChord, resolutionToneFrequencyHz: number): ResolvedSemanticChord` の一つとする。

- 解音周波数は明示的な別引数とし、既定値や外部状態を読まない
- 生成専用の作成口は設けない。公開構造型だけでは妥当性を保証できないため、変換入口で検査する
- 失敗は既存層と同じ `RangeError` とする
- 合成規則は、解音周波数 `F`、機能根 `r`、構成音 `t`、ベース `b` として、機能根 `F·R(r)`、構成音 `F·R(r+t)`、ベース `F·R(r+b)` とする。合成は素数指数の加算で行い、浮動小数点の周波数や有理比を経由して再構成しない
- 処理境界は次とする
  1. 主要次元と全オフセットを検査する（許す鍵は素数2・3・選択した主要次元の素数のみ。未知の鍵、非整数指数、合成時の整数精度逸脱を拒む。相殺後のみの検査で禁止次元を見逃さない）
  2. 解音基準のオフセットへ合成する
  3. 有理比化と約分は `normalizeHarmonicRatio` に委ねる
  4. 周波数計算と同一比率の束ねと低音順は `resolveHarmonicVoices` に委ねる
  5. `functionalRoot`、`chordVoices`、`bass` の全 `ratio` を解音基準に統一する
- 独自の最大公約数処理、素数判定、周波数解決、別順序付け器を実装しない
- `ResolvedSemanticChord` は `functionalRoot`、`chordVoices`、`bass?`、`harmonyEstablished` を持つ

### 意味論判定

- `harmonyEstablished` は、機能根と他の構成音について、素数2の指数を除いた異なる位置が3種以上かで判定する
- ベースは成立種数へ加算しない。単音と二音は変換できるが `harmonyEstablished=false` とする。和声は和声の構成音で定義され（`requirements/intent/music-semantic-structure.md:113`）、ベースは構成音そのものではなく構成音を参照する発音上の役割であるため（同 `:154-157`、`:198`）、ベースを成立種数に数えない。
- 同一音高の構成音は既存解決器で束ねる。オクターブ違いの声付けは保持する。この束ねは成立種数の数え方（素数2の指数を除く）とは別の操作である。
- ベースは構成音と同音でも別の出力に残す。最低音であることや構成音への所属を追加条件にしない
- 探索用の声数上限、格子用の点数上限、音域への折返し、配置は適用しない。別経路の責務とする

## 採用しない案

- 比率列を意味論の正本にすること、素数指数を入力から除外すること。相対移動による音高関係を正本にする要求に合わないため
- 名称表記、波形、時間、演奏進行、発音口接続口を今回の型に含めること。別層の責務と混ざるため

## 未確定の候補

いずれも要求判断が必要であり、人間の判断へ戻す。

- 主要次元の併用例外の採否と条件
- 時間と演奏機能の扱い
- ベースの所属と最低音条件
- 役割からの自動音高導出

解音とベースは要求で確定済みであり、本設計の対象外とする。解音は要求（`requirements/intent/music-semantic-structure.md:200`）と設計正本（`pitch-grid/semantic-input.md`）を参照する。ベースは訪問者が機能根を基準とする位置に指定し、オン点と合わせた同時発音は上限内とする（`requirements/intent/shasavistic-music-world.md:64`）。格子からの組立ては `pitch-grid/semantic-input.md` を参照する。

## 見直し条件

- 未確定事項が確定したとき
- 許す次元や成立判定の前提が変わったとき
- 数値安全性条件で扱えない音程が現れたとき、巨大な有理比で整数精度逸脱が避けられないとき、既存対応表への依存が不適切と判明したとき、演算層や発音経路の変更が必要になったとき（多倍長整数基盤や近似への自動切替は先行実装しない）

## 検証との接続

方針のみを定め、具体値と判定手順は検証側へ置き、この文書に複製しない。新規 `shasavistic-music-lab/src/audio/semanticChord.test.ts` が所有する判定は次とする。

- 機能根を経由して解決されること（解音から直接でないこと）
- 構成音側が零移動でも機能根の移動が消えないこと
- 解音周波数だけを変えると比率と成立を保ったまま全周波数が同じ倍率で変わること
- 選択主要次元の許可と他の主要次元の拒否と相殺する禁止次元の拒否
- オクターブ違いの保持と成立種数への非加算
- ベースの役割保持と同音非吸収と種数非加算
- 同一比率の束ね
- 入力非変更
- 無効入力の拒否

一般の比率演算（約分・指数変換・重複排除・順序・周波数）は既存 `harmonicRatio.test.ts`、探索発音口の配線と上限と寿命は既存 `harmonicChord.test.ts`（今回変更しない）が所有し、新規検査へ複製しない。純粋変換のためのブラウザ採取や診断口は追加しない。

## 参照

- `requirements/intent/music-semantic-structure.md:193-200`（静的な和音とベースの要求の参照元）
- `requirements/intent/shasavistic-music-world.md:63,68`（静的な和音と非目標の要求の参照元）
- `requirements/reference/relative-pitch-space.md`（次元番号と素数軸の対応と移動の定義の参照元）
- `shasavistic-music-lab/src/audio/harmonicRatio.ts`（約分と声解決の参照先）
- `shasavistic-music-lab/src/audio/harmonicChord.ts`（発音口と上限の参照先）
- `shasavistic-music-lab/src/audio/pitchGrid.ts`（次元と素数の対応表の参照先）
- `workflow/design/shasavistic-music-lab.md`（親。分担と境界の参照元）
- `workflow/design/AGENTS.md`、`workflow/AGENTS.md`（設計と検証の運用規則の参照元）
