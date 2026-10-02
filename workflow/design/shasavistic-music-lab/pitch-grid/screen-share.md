# 格子奥側の画面共有パネル

この文書は、格子UIの奥側に置く画面共有パネルの方式と、開発環境・ホストで確認できる範囲の境界を決める。格子操作と発音の所有は親を参照する。

## 要求元

`requirements/intent/shasavistic-music-world.md` のMVP対象範囲（61行目）にある「格子UIの奥側に置いた画面共有パネルをInteractして開始・停止できる」と、非目標（72行目）の「音声通話機能を提供しない（画面共有の映像転送がXRift側のルーム接続を内部で利用することはある）」を要求元とする。要求を再定義しない。

## 確定した方式

XRift公式の `ScreenShareDisplay` をワールドに一面だけ配置する。開始・停止は同部品が標準で持つInteract操作をそのまま使い、独自のキャプチャ・転送・通話実装を作らない。ワールド内の共有画面は一面とする（複数置いても同一映像を示すため）。共有状態は xrift-frontend が注入する `ScreenShareContext` から読み、ワールド側で共有状態を所有しない。

配置はワールド奥側の壁に寄せ、訪問者から見て格子より小さい z の空間へ置き、面の正面を訪問者側の +z に向ける。スポーン正面では手前の格子越しになるが、その遮蔽は許容する（人間判断）。幅は壁の高さに収まる最大とし、高さは16:9で決まる。壁の内側・地面より上に収める。理論説明パネル（右側、x が正）とは投影上重ならない。配置責務は `World.tsx` が担い、具体座標・寸法・幅はコード側の定数へ置いて実画面で調整し、この文書には複製しない。パネルの `id` は既存の格子・方向・次元操作の `Interactable` と重ならない一意値をコード側の定数に置く（具体値は複製しない）。

プレースホルダー画像を採用する場合は、公式が示すCORS条件と、ワールドのアセット読込規則（`shasavistic-music-lab/AGENTS.md` の `useXRift().baseUrl` 規則）に従う。採用可否は未確定とする。

## 環境と確認範囲

開発環境（`src/dev.tsx`）では `XRiftProvider` が既定（no-op、`isRoomConnected: false`）の `ScreenShareProvider` を供給するため、`ScreenShareDisplay` は throw せず描画される。したがって開発環境で確認できるのは、非共有時の見え方、配置、格子越しの見え方、既定動作までとする。（開発環境では未接続の文言側が見える）実際の共有開始、同室の他参加者への表示、通話ルーム加入の要否はXRiftホストでの確認とし、開発環境の成功をホストの成功と同一視しない。模擬Providerを常設の診断口として置かない（診断口を設けない境界は親 `workflow/design/shasavistic-music-lab.md` を参照）。

## 確認済み事実

- 公式部品集に `ScreenShareDisplay` があり、`id`・位置・回転・幅・更新FPS・未共有画像を指定でき、高さは16:9で自動計算し映像比率を保つ。共有の開始・停止のAPI呼出しは部品内部に閉じ、ワールドはInteract経由でのみ使う。ワールド内の共有画面は一面まで。
  - 出典: https://docs.xrift.net/world-components/components/#screensharedisplay 、https://docs.xrift.net/world-components/components/#usescreensharecontext （本文取得、確認）
- 導入済み部品の実装では、`ScreenShareDisplay` は `useScreenShareContext()` を呼び、映像もプレースホルダー画像も無い場合にテキストを表示する。ルーム接続時は「クリックして画面共有」、未接続時は「音声通話に接続できていません」を表示する。`XRiftProvider` は既定の no-op 実装で `ScreenShareProvider` を供給する。
  - 出典: `shasavistic-music-lab/node_modules/@xrift/world-components/dist/components/ScreenShareDisplay/index.js`、同 `dist/contexts/ScreenShareContext.js`、同 `dist/contexts/XRiftContext.js`（ローカル導入物の読み取り、確認）
- `xrift.json` に画面共有専用の設定項目は確認できていない（現設定にも無い）。設定不要の証明ではない。
  - 出典: https://docs.xrift.net/guides/configuration#permissions （本文取得、確認）

## 未確定の候補

- パネルの具体座標・幅（壁に収まる最大を初期値とし実画面で調整）。プレースホルダー画像の採用可否。実画面とホスト操作の確認で決める。
- ホストでの共有開始が通話ルーム加入やマイク有効化を不可避に要求するか。ホスト観測で決める。何が分かれば決められるかは実装時に記録する。
- 更新レート上限（`targetFps`）の値。実機の負荷を見て決める（部品の既定は制限なし）。

## 見直し条件

ホストで共有が通話参加やマイク有効化を不可避に要求する場合は、非目標との整合を人間の判断へ戻す。スポーンや接近時に共有面を狙えず操作できない場合は、接近経路または配置を見直す。理論説明パネルと投影上重なる場合も配置を見直す。要求のMVP範囲が変わる場合は人間の判断へ戻す。子で親の制約を満たせない場合は子に例外を埋め込まず、親の判断を見直す。

## 検証との接続

方式のみを定め、具体値と判定手順は検証側へ置く。配置と非共有時の見え方の実機確認は `workflow/spec/` の一時計画への追加想定とする（現時点で未整備）。配線・型・ビルドはワールドの既存検証入口（`npm run typecheck`、`npm test`、`npm run build`、`xrift check`）が覆う範囲へ寄せる。テスト未整備の事項を検証済みとしない。

## 参照

- `requirements/intent/shasavistic-music-world.md`（要求元）
- `workflow/design/shasavistic-music-lab.md`（診断口を設けない境界の参照元）
- `workflow/design/shasavistic-music-lab/pitch-grid.md`（親。奥側パネルの配置境界）
- `workflow/design/shasavistic-music-lab/pitch-grid/theory-intro.md`（右側に残す理論説明パネル）
- `shasavistic-music-lab/src/World.tsx`（配置責務）
- https://docs.xrift.net/world-components/components/#screensharedisplay
