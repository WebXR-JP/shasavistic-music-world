# 格子奥側の理論説明パネル

この文書は、格子UIの奥側に置く理論説明の表示と文章データの境界を決める。文面の内容判断は利用者が行い、この文書では方式だけを決める。操作状態の所有は親を、音声の扱いは兄弟を参照する。

## 要求元

`requirements/intent/shasavistic-music-world.md` のMVP対象範囲にある「格子UIの奥側にシャサフ式音楽理論に関する知識を知らない人向けに簡単に書く。文章データはプログラムとは別のファイルで管理する」を要求元とする。要求を再定義しない。

## 確定した方式

説明は格子の奥側に置く非操作のパネルとする。既存の `TextPlate`（CanvasTexture・非raycast・最大2行）を踏まえ、長文を一枚に詰め込まず、同じ描画方式の短い複数行パネルに分ける。Cube の背後に完全に隠さず、正面から見える余白に置き、照準と操作釦を遮らない。

文章データは `shasavistic-music-lab/src/content/pitch-grid-intro.json`（見出し・短い段落配列）に置き、バンドルに含めて読み込むため静的 import で読み、実行時アセット読込としない（`public/` と `useXRift().baseUrl` による読込と混同しない）。追加のネットワーク読込や読込失敗の状態は作らない。

文面では理論上の事実と製品独自の選択を区別する。次元・軸・ハラーザの対応は `shasavistic-music-theory` スキルとその公式一次出典に帰属させ、15点UI・220Hz・発音域収容は要求・設計と `requirements/reference/relative-pitch-space.md` に帰属させる。「シャサフ式理論そのものがこの15点UIや220Hzを定める」とは書かない。`research/shasavistic-music-theory.md` は参考であり決定の正本ではない。

文面は利用者が内容を確定した。正規データ `shasavistic-music-lab/src/content/pitch-grid-intro.json`（見出し・4段落）が正本であり、内容判断は利用者が行い、設計では方式だけを扱う。下書き専用ファイルは削除済みであり、正規データへ移す手順は残さない。`sources` は下書き専用の来歴メモであり、正規データには含めない。出典追跡は表示データとは別に保つ。

## 確認済み事実（出典の帰属）

下書きにあった出典は表示データに入れない方針のため、ここに残す。次元・軸対応の公式辞書URLと Chalaxata の一次URL表は `research/shasavistic-music-theory.md` を参照する（URLの複製はしない）。製品独自項目（15点UI・220Hz・発音域収容）の帰属は要求・設計と `requirements/reference/relative-pitch-space.md` による。具体寸法・行数・配置は実画面で決める。実画面の確認が揃えば決められる。

## 見直し条件

「公開後に文章だけ差し替えたい」が要件化されたら `public/` と `useXRift().baseUrl` による読込を再検討する。パネルが照準や操作釦を遮ると判明した場合は配置を見直す。要求のMVP範囲が変わる場合は人間の判断へ戻す。

## 参照

- `workflow/design/shasavistic-music-lab/pitch-grid.md`（格子範囲と方式変更の参照元）
- `requirements/intent/shasavistic-music-world.md`（説明表示の要求の参照元）
- `requirements/reference/relative-pitch-space.md`（次元と素数軸の対応の参照元）
- `shasavistic-music-lab/src/components/PitchGrid/plates.tsx`（描画方式の参照先）
- `research/shasavistic-music-theory.md`（次元・軸対応の一次URL表の参照先）
- `workflow/spec/harmonic-synth-capture.md`（説明の可読確認の置き先）
