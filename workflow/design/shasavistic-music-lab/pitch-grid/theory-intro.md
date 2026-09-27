# 格子奥側の理論説明パネル

この文書は、格子UIの奥側に置く理論説明の表示と文章データの境界を決める。文面の内容判断は利用者が行い、この文書では方式だけを決める。操作状態の所有は親を、音声の扱いは兄弟を参照する。

## 要求元

`requirements/intent/shasavistic-music-world.md` のMVP対象範囲にある「格子UIの奥側にシャサフ式音楽理論に関する知識を知らない人向けに簡単に書く。文章データはプログラムとは別のファイルで管理する」を要求元とする。要求を再定義しない。

## 確定した方式

説明は格子の奥側に置く非操作の1枚パネルとする。見出しと段落を順序と段落境界を保ったまま一つの描画面に描き、一つの面として置く。既存の `TextPlate`（格子ラベル・矢印・次元の最大2行用）は変えず、説明専用の描画部品を新設する。既存用途の見た目を変えない。

文章データは `shasavistic-music-lab/src/content/pitch-grid-intro.json`（見出し・短い段落配列）に置き、バンドルに含めて読み込むため静的 import で読み、実行時アセット読込としない（`public/` と `useXRift().baseUrl` による読込と混同しない）。追加のネットワーク読込や読込失敗の状態は作らない。データの形は `{title, paragraphs}` を保ち、段落を1文字列に潰さない。表示幅依存の `lines` のような形は採らない（実装判断を利用者管理の文面へ固定しないため）。

折返しは描画時の実測幅で行い、固定文字数だけで切らない。行頭の句読点や英数字の不自然な分断を避ける。見出しと本文で書体・行間を分ける。描画面は適度な固定上限に収め、際限なく解像度を増やさない。

収まらない場合（行数・高さ・最低書体サイズのいずれか超過）は黙って欠落・極小化せず検出する。具体的な上限値はテストと実画面の結果から決める。

配置は訪問者から見て格子より小さい z の空間へ置き、面の正面は訪問者側の +z に向ける。スポーン正面の格子・操作釦と投影上も重ならないよう横に寄せる。壁の内側・地面より上に収め、近づいて読める位置にする。配置責務は `World.tsx` が担い、格子と独立の説明パネルとして置く。具体座標・寸法は実画面で調整し、この文書には複製しない。

文面では理論上の事実と製品独自の選択を区別する。次元・軸・ハラーザの対応は `shasavistic-music-theory` スキルとその公式一次出典に帰属させ、15点UI・220Hz・発音域収容は要求・設計と `requirements/reference/relative-pitch-space.md` に帰属させる。「シャサフ式理論そのものがこの15点UIや220Hzを定める」とは書かない。`research/shasavistic-music-theory.md` は参考であり決定の正本ではない。

文面は利用者が内容を確定した。正規データ `shasavistic-music-lab/src/content/pitch-grid-intro.json`（見出しと段落配列）が正本であり、内容判断は利用者が行い、設計では方式だけを扱う。下書き専用ファイルは削除済みであり、正規データへ移す手順は残さない。`sources` は下書き専用の来歴メモであり、正規データには含めない。出典追跡は表示データとは別に保つ。

## 確認済み事実（出典の帰属）

下書きにあった出典は表示データに入れない方針のため、ここに残す。次元・軸対応の公式辞書URLと Chalaxata の一次URL表は `research/shasavistic-music-theory.md` を参照する（URLの複製はしない）。製品独自項目（15点UI・220Hz・発音域収容）の帰属は要求・設計と `requirements/reference/relative-pitch-space.md` による。具体寸法・行数・配置は、可読距離と遮蔽の有無を実画面で確認してから決める。

## 見直し条件

「公開後に文章だけ差し替えたい」が要件化されたら `public/` と `useXRift().baseUrl` による読込を再検討する。パネルが照準や操作釦を遮ると判明した場合は配置を見直す。一枚に収まらない文面が来た場合は検出結果を起点に見直す。要求のMVP範囲が変わる場合は人間の判断へ戻す。

## 参照

- `workflow/design/shasavistic-music-lab/pitch-grid.md`（格子範囲と方式変更の参照元）
- `requirements/intent/shasavistic-music-world.md`（説明表示の要求の参照元）
- `requirements/reference/relative-pitch-space.md`（次元と素数軸の対応の参照元）
- `shasavistic-music-lab/src/components/PitchGrid/TheoryIntroPanel.tsx`（説明専用の描画の参照先）
- `shasavistic-music-lab/src/components/PitchGrid/plates.tsx`（既存銘板の描画方式の参照先）
- `research/shasavistic-music-theory.md`（次元・軸対応の一次URL表の参照先）
- `workflow/spec/harmonic-synth-capture.md`（説明の可読確認の置き先）
