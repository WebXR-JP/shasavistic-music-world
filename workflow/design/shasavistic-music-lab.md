# Shasavistic Music Lab のワールド設計

この文書は、表示名・配置・目的・作成入口・境界・責務分担を決める。調波シンセの満たし方は決めず、子を参照する。

## 要求元

承認された依頼を要求元とする。要求を再定義しない。今回の受入れ範囲と満たし方は子に置き、この文書で仕様や受入れを確定しない。

## 確定事項

表示名は `Shasavistic Music Lab`、配置はリポジトリ直下の `shasavistic-music-lab/` とする。人間の確定事項であり、案ではない。

目的はシャサフ式音楽の長期的な実験場とする。将来機能の仕様確定とは区別し、目的と設計境界の確定として扱う。

作成入口は `xrift create world shasavistic-music-lab` とする。依存、設定、検証入口はワールド内に閉じる。共有の置場を設けず、複数能力で必要が生じても責務と所有者を決めて一箇所に置く。

## 責務分担

音の生成と停止、資源の解放はワールド内の小さな音声処理が担い、ワールド側は起動操作とライフサイクルの接続だけを担う。描画や操作の記述に音声処理を混ぜない。

理由は、音声方式を能力ごとに選び直せるようにするためである。操作接続にXRift部品の更新影響を閉じ、音声処理の差し替えが描画や操作に波及しないようにする。

## 観測の境界

音声グラフからの採取は信号生成の証明であり、物理出力の証明にはならない。開発環境とホスト環境の成功は別結果として報告する。

起動関数の呼び出しや実行状態の表示だけを合格証拠にしない。具体的な数値と判定式は検証側へ置き、この文書に複製しない。常設の診断口は作らず、自動採取が整うまでの間だけ未実装条件、必要環境、残す証拠を `workflow/spec/` の一時計画に置き、判定可能になった項目から消す。

## 後続能力の方針

後続能力は承認された要求ごとに設計する。複数能力に共通する判断が実際に生じたときに親へ置き、予想だけで親へ置かない。

音高変更、和音、比率操作、可視化などは予定や例として触れるにとどめ、仕様や受入れを確定しない。共通基盤や常設診断口を将来の予想だけで先行構築しない。

## 見直し条件

- 既定雛形が現行の公式雛形と異なるか不適切なら、雛形指定付きの作成手順へ切り替える。
- 後続能力が現在の音声処理と操作の分担を保てないときは、親の粒度と判断を再検討する。
- 複数能力に共通の判断が実際に必要になるときは、親への集約を検討する。
- ワールド単位の依存と検証の境界が成り立たないと判明したときは、親の境界を再検討する。

## 確認済み事実

一次資料の本文取得による確認を次に示す。

- 作成入口の既定雛形は旧称を示すが、現行実体は公式のワールド雛形へ転送される。雛形指定は利用者名とリポジトリ名の形式で、作成時に名前と版数を置換する。
  - 出典: https://docs.xrift.net/cli/commands 、https://raw.githubusercontent.com/WebXR-JP/xrift-cli/main/src/commands/create.ts 、https://raw.githubusercontent.com/WebXR-JP/xrift-cli/main/src/lib/create-world.ts 、https://raw.githubusercontent.com/WebXR-JP/xrift-cli/main/src/lib/template.ts 、https://github.com/WebXR-JP/xrift-world-template
- 雛形は連合モジュール構成で公開口、開発用描画器、設定文書、型検査付き構築手順を備える。
  - 出典: https://github.com/WebXR-JP/xrift-world-template 、https://raw.githubusercontent.com/WebXR-JP/xrift-world-template/main/package.json 、https://raw.githubusercontent.com/WebXR-JP/xrift-world-template/main/vite.config.ts 、https://raw.githubusercontent.com/WebXR-JP/xrift-world-template/main/src/dev.tsx
- 公式部品集に発振や音声生成の口はなく、操作口と映像再生口などに限られる。権限項目は許可領域と許可規則で、音声機能の審査規則はない。取得装置への到達は重大検出の対象のため避ける。検査結果は承認、要審査、却下のいずれかである。
  - 出典: https://docs.xrift.net/world-components/components/ 、https://raw.githubusercontent.com/WebXR-JP/xrift-world-components/main/src/index.ts 、https://docs.xrift.net/guides/configuration 、https://raw.githubusercontent.com/WebXR-JP/xrift-code-security/main/src/analyzer.ts 、https://github.com/WebXR-JP/xrift-code-security 、https://xrift.net/security 、https://docs.xrift.net/cli/commands

## 参照

初回能力の満たし方は子を参照する。運用規則は上位文書による。

- workflow/design/shasavistic-music-lab/harmonic-synth.md
- research/xrift-world-creation.md
- AGENTS.md、workflow/AGENTS.md、workflow/design/AGENTS.md、workflow/spec/AGENTS.md
