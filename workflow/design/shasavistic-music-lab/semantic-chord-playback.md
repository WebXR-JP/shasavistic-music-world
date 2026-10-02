# 意味論型から発音口への下位経路

この文書は、意味論型から既存発音口へ音を届ける下位経路を決める。対象は、純粋な声仕様変換と、専有した発音口を駆動する小さな session とする。格子のオン操作からの組み立て、音域配置は扱わない。

## 適用範囲

対象は、意味論型から既存発音口へ音を届ける下位経路とし、純粋な声仕様変換と、専有した発音口を駆動する小さな session を決める。

- 親は `workflow/design/shasavistic-music-lab.md` とする
- 格子のオン操作から `SemanticChord` を組み立てる上半分、音色分離、時間・メロディー、遠隔同期、ホスト・物理出力は対象外とする
- 音域配置は今回は行わない。`resolveSemanticChord` の解決済み周波数をそのまま鳴らす。下半分単独ではMVPの音域・間隔要求（`requirements/intent/shasavistic-music-world.md:48-49`、220–1760Hz）への適合は未達である。上半分との接続後の到達点は `pitch-grid/semantic-input.md` を参照する（ベースなしで既存配置の `k` を正しく伝達すれば保持しうるが、下半分単独は未達、ベース込みは未確定のためMVP全体では未達。実装・計測前なので達成済みとしない）

## 要求元

`workflow/design/shasavistic-music-lab/semantic-chord.md`（型と解決の正本）と `workflow/design/shasavistic-music-lab/pitch-grid/live-audio.md`（発音口の反映契約）を要求元とする。要求を再定義しない。

- `requirements/intent/music-semantic-structure.md:198,200` のベースの役割と解音の固定
- `requirements/intent/shasavistic-music-world.md:64` のベースと 15 点（確定済み。上限内で扱う）

## 確定した方式

### 経路と所有

呼び出し側が `SemanticChord` と解音周波数を供給し、`resolveSemanticChord`、純粋な声仕様変換、session を経て `PitchGridSound` へ届ける。

- session は発音口を専有する。既存 `pitchGridController` とは別経路とし、同じ発音口へ二重に反映しない。所有は一つにする。格子経路と意味論経路が同時に鳴りうることへの調停は今回の対象外であり、上半分の設計（`pitch-grid/semantic-input.md`）で決める

### 純粋変換

置き場所は `shasavistic-music-lab/src/audio/semanticChordVoices.ts` を想定する。

- 公開は純粋な `toSemanticChordVoiceSpecs(resolved: ResolvedSemanticChord): PitchGridVoiceSpec[]` とする。`PitchGridVoiceSpec` は `pitchGridSound.ts` の型（`{ key, frequency }`）を参照し、再定義しない
- 鍵は役割と正規化済み論理比から作る。機能根は `semantic:root:<分子>/<分母>`、他の構成音は `semantic:tone:<分子>/<分母>`、ベースは `semantic:bass:<分子>/<分母>` とする。鍵は発音口にとって不透明であり、格子の座標鍵は一用法にすぎないため、意味論経路は専有インスタンスで `semantic:` 名前空間を使い、鍵についての発音口側の検査は非空・一意のみを要求し座標形式を要求しない
- 周波数・低音順の添字・乱数・時刻を鍵に含めない。解音周波数だけを変えても鍵を保つ
- 和音側の同一比率は一声にまとめる。機能根と同音の他の構成音は機能根側に残す（他構成音の重複を落とす）。オクターブ違いは別の声として残す。ベースは同音でも独立した鍵・一声とする
- `harmonyEstablished=false` を発音禁止にしない。単音・二音も発音できる
- 比率の正規化は既存 `normalizeHarmonicRatio` を再利用する。独自の約分を作らない
- 純粋変換として、入力オブジェクトを変更しない。純粋変換の検査は比率が正規化可能・周波数が正の有限値・必須要素（機能根など）の欠落がないこと（他の構成音（`chordVoices`）が空の単音を含む）に限り、比率と周波数の対応の正しさは判定しない（基準周波数を持たず単独では判定できないため）。対応の正しさは session が `resolveSemanticChord` 経由で保証する。音声資源・外部状態・時刻を読まない

### session

置き場所は `shasavistic-music-lab/src/audio/semanticChordSound.ts` を想定する。

- 公開は `createSemanticChordSoundSession(options?)` が返す口とし、`reflect(chord: SemanticChord, resolutionToneFrequencyHz: number): Promise<void>`、`stop(): void`、`dispose(): Promise<void>` を持つ
- 専有する `PitchGridSound` を遅延生成する（既定 `createPitchGridSound`、検査では代替物に差し替え可能）。解音周波数は明示引数で受け、既定値や格子基準の読み取りを置かない
- 反映は `resolveSemanticChord`、純粋変換、検査（仕様数が上限を超えていないかの検査）を経て発音口の生成・更新へ進む。同一次元は `setVoices`、次元が変わった反映は `switchDimension` とする（停止と反映の重ね呼びで代用しない）。次元変更の判定のため、直近の主要次元を保持する
- 声数上限は、仕様数が `PITCH_GRID_MAX_VOICES`（15）を超える場合は `RangeError` とし、新しい反映を行わず、既存の声を勝手に止めない。ベースも声数に数える。定数は `PITCH_GRID_MAX_VOICES` を参照し、15 を再定義しない
- 解決・変換・検査を終えてから発音口を生成・更新する。解音不正・上限超過・発音失敗は呼び出し側へ返し、握り潰さない
- 常設診断口を作らない。ピアノ表示のため session に限定した読取り快照・変更通知（`soundingVoices`／`subscribeSounding` の中継）を追加する。共有状態・通知機構は追加しない。`stop()` は発音口の全声停止、`dispose()` は発音口を一度だけ破棄する

## 採用しない案

- `pitchGridController` に意味論入力を継ぎ足す案。責務混在と所有の二重化を招くため
- 音ごとの単純折返しで音域を合わせる案。集合の最短間隔優先を保証せず、別の正本になるため。今回は折返し自体を行わない
- 上限超過の打ち切り・声の奪取・別経路への自動切替。黙って落とすと意味論の欠落を隠すため
- `PITCH_GRID_BASE_FREQUENCY_HZ` を解音の既定に流用する案。解音周波数は上位が明示して渡すため、既定値による暗黙の供給を置かないため
- 既存の配置（`assignPitchGridFrequencies` の動的計画法）を今回抽出・共通化する案。配置が要求された段階で別途行うため（上半分での既存APIへの結果情報追加と直接利用は抽出ではない）
- `harmonicChord` の流用

## 未確定の候補

いずれも要求判断が必要であり、人間の判断へ戻す。

- 明示オクターブ位置を発音時に再配置してよいか、ベースへの音域・最低音条件、同音ベースの配置後の関係（MVP の音域・間隔適合）
- ベースと格子のオン点・最大 15 点との体験上の関係
- 格子のオン操作から `SemanticChord` を組み立てる上半分、遠隔同期、ホスト・物理出力

## 見直し条件

- 配置（音域・間隔）対応が必要になったとき
- 15 和音声に加えてベースを鳴らす必要が生じたとき
- 鍵の変更で尾音の重複や聴感問題が出たとき
- 共有経路で 15 声を保てないとき

## 検証との接続

方針のみを定め、具体値と判定手順は検証側へ置き、この文書に複製しない。新規 `shasavistic-music-lab/src/audio/semanticChordVoices.test.ts` が所有する判定は次とする。

- 役割と鍵の対応、周波数対応、機能根の二重発音回避、同音ベースの独立鍵、オクターブ保持、解音周波数の変更で鍵が変わらないこと、入力非変更、無効入力の拒否

新規 `shasavistic-music-lab/src/audio/semanticChordSound.test.ts` が所有する判定は次とする。

- 解決から実仕様までの接続、検査失敗時に発音口を更新しないこと、通常反映と次元切替の使い分け、停止・破棄、失敗の伝達、上限超過の拒否。代替の `PitchGridSound` で配線を確かめる

既存 `semanticChord.test.ts` は意味論解決の保証を維持し、発音接続検査を混ぜない。既存 `pitchGridSound.test.ts`・`pitchGridController.test.ts` は既存の配線・寿命の保証を維持し、今回変更しない。

純粋変換にブラウザ採取は要しない。新 session を通した実発音の完成を主張する段階で、既存 `pitchGrid.capture.test.ts` の足場を使った Chrome 採取を一つ追加する。別の診断基盤は作らない。UI 上半分・ホスト・物理出力は今回未確認とする。

## 参照

- `workflow/design/shasavistic-music-lab/semantic-chord.md`（型と解決の正本の参照元）
- `workflow/design/shasavistic-music-lab/pitch-grid/live-audio.md`（発音口の反映契約の参照元）
- `workflow/design/shasavistic-music-lab/pitch-grid/pitch-assignment.md`（配置結果の正本の参照先）
- `requirements/intent/music-semantic-structure.md:193-200`（静的な和音とベースの要求の参照元）
- `requirements/intent/shasavistic-music-world.md:48-49,63-64`（`:48-49` は音域・間隔の要求、`:63-64` は静的な和音とベースの要求の参照元）
- `shasavistic-music-lab/src/audio/semanticChord.ts`（型と解決の参照先）
- `shasavistic-music-lab/src/audio/pitchGridSound.ts`（発音口と声仕様・上限の参照先）
- `shasavistic-music-lab/src/audio/pitchGridController.ts`（別経路とする制御器の参照先）
- `shasavistic-music-lab/src/audio/pitchGrid.ts`（次元の対応表の参照先）
- `workflow/design/shasavistic-music-lab.md`（親。分担と境界の参照元）
- `workflow/design/AGENTS.md`、`workflow/AGENTS.md`（設計と検証の運用規則の参照元）
