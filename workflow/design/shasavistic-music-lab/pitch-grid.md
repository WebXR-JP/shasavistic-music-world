# MVP格子操作と発音の方式

この文書は、MVPの縦3・横5格子を一つの操作・発音単位にする方式を決める。操作状態の所有、格子・方向・次元操作と音声との境界を正本にする。音高の定め方は子を、声の管理は子を参照する。

## 要求元

`requirements/intent/shasavistic-music-world.md` のMVP対象範囲と同期要求（全員が同じ音を聞く、厳密な同期は保証しない）を要求元とする。要求を再定義しない。現行の4組合せ聴き比べでは個別オン・オフと集合移動を満たせないため、例外追加ではなく方式変更とする。この変更判断の正本はこの文書に置く。

## 確定した方式

一つの意図状態を全員で共有し、各Cubeの操作、八方向操作、次元選択はその共有値への遷移として集める。発音は各端末に残す。共有の実現手段と状態形は子を参照する。格子は中央 `(0,0)`、横 `-2…2`、縦 `-1…1` とする。1次元（素数2・オクターブ移調）に独立した操作は増やさない。

移動は移動先を先に判定し、全点が格子に収まる場合だけ集合全体を一度に更新する。移動で重なった座標を固定点として特別扱いしない。格子外へ出る移動は集合全体で行わず、折り返しもしない。空集合の移動は発音しない。次元切替では選択次元だけを更新し、座標集合は変えない。旧次元の起動待ち・発音中の声を止めてから、保持した全座標を新次元の周波数で鳴らし直す。途切れは許容する。同一次元の再選択は無操作とし、空集合の切替では発音も文脈生成もしない。

オンの座標集合は訪問者の選択意図であり、声はその時点の次元で作った音声資源として区別し、同じものとして扱わない。表示のオンは選択意図を示し、発音中であることの断定には使わない。再開に失敗しても集合と新次元は巻き戻さず、声だけを失敗扱いとして次の操作で鳴らし直せるようにする。

画面はオン状態、軸、操作対象を色だけに頼らず示す。表示の書体・寸法・配置の具体値は実画面で定める。

## 境界

共有状態への遷移受付は操作側が担い、音声側は座標集合の反映だけを担う。音声側が格子範囲や移動可否を再判定しない。親の音声処理と操作の分離、および診断口を設けない境界は `workflow/design/shasavistic-music-lab.md` を参照する。

子への案内に留め、子の決定内容をここへ複製しない。

- `workflow/design/shasavistic-music-lab/pitch-grid/pitch-assignment.md`（論理比と発音用配置の正本）
- `workflow/design/shasavistic-music-lab/pitch-grid/live-audio.md`（個別声と共有文脈の正本）
- `workflow/design/shasavistic-music-lab/pitch-grid/remote-sync.md`（遠隔共有の正本）
- `workflow/design/shasavistic-music-lab/pitch-grid/sounding-piano.md`（鳴り中音高のピアノ対照表示の正本）
- `workflow/design/shasavistic-music-lab/pitch-grid/theory-intro.md`（奥側の理論説明の表示と文章データの正本）

## 採用しない案

- 4組合せを格子の選択状態に読み替える案は採用しない（この文書の要求元節の方式変更による）。
- 声の管理に関する採用しない案は `workflow/design/shasavistic-music-lab/pitch-grid/live-audio.md` を参照する。
- 発音用配置に関する採用しない案は `workflow/design/shasavistic-music-lab/pitch-grid/pitch-assignment.md` を参照する。

## 検証との接続

方針のみを定め、具体値と判定手順は検証側へ置く。開発環境の実操作起点の信号生成は `npm run test:interact` が覆う範囲へ寄せ、ホストと物理出力の未実行条件だけを `workflow/spec/harmonic-synth-capture.md` の一時計画に置く。なお `test:interact` の現状は旧4 Cube経路のみで格子15点・移動・切替は未整備であり、詳細は同計画を参照する。

## 未確定の候補

八方向操作と次元選択の具体的な部品形状は未確定とし、実画面とホスト操作の確認で決める。何が分かれば決められるかは実装時に記録する。

## 見直し条件

要求のMVP範囲が変わる場合、共有状態で八方向操作と次元選択を受けられない場合、全点収容判定の一括更新が操作応答を損なう場合は、人間の判断へ戻す。子でこの文書の制約を満たせない場合は子に例外を埋め込まず、この文書の判断を見直す。

## 参照

- `requirements/intent/shasavistic-music-world.md`（MVP対象範囲の参照元）
- `requirements/reference/relative-pitch-space.md`（次元と素数軸の対応の参照元）
- `workflow/design/shasavistic-music-lab.md`（分担と境界の参照元）
- `workflow/design/shasavistic-music-lab/harmonic-synth.md`（旧聴き比べ増分の適用範囲の参照先）
- `workflow/spec/harmonic-synth-capture.md`（未実行条件の置き先）
