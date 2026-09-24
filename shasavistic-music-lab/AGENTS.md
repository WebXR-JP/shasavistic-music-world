# Shasavistic Music Lab - AI ガイド

## 詳細な API ドキュメントの取得

詳細な API リファレンス・コードテンプレート・型定義は以下のコマンドで取得できます：

```bash
npx skills add WebXR-JP/xrift-skills
```

---

## 最重要ルール（必ず守ること）

1. **アセット読み込みは必ず `useXRift()` の `baseUrl` を使用**
2. **アセットファイルは `public/` ディレクトリに配置**
3. **`baseUrl` は末尾に `/` を含むため、`${baseUrl}path` で結合**（`${baseUrl}/path` は NG）

```typescript
// ✅ 正しい
const { baseUrl } = useXRift()
const model = useGLTF(`${baseUrl}robot.glb`)

// ❌ 間違い
const model = useGLTF('/robot.glb')           // 絶対パス NG
const model = useGLTF(`${baseUrl}/robot.glb`) // 余分な / NG
```

---

## shared 依存として利用可能なパッケージ

Module Federation により、以下のパッケージはワールドチャンクにインライン化されず shared チャンクとして分離されます：

- `react`, `react-dom`, `react/jsx-runtime`, `react-dom/client`
- `three`
- `three/addons/loaders/GLTFLoader.js`, `three/addons/loaders/DRACOLoader.js`, `three/addons/loaders/KTX2Loader.js`（サブパス単位のみ。バレル全体やその他のアドオンは対象外）
- `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`
- `@react-three/uikit`, `@pmndrs/uikit`
- `@xrift/world-components`

**Three.js アドオンについて**: DRACOLoader 等の Three.js アドオンは `three/addons/loaders/xxx.js` のサブパスで import してください（`three/addons` バレル全体は shared 対象外）。`three/examples/jsm` からの直接 import はワールドチャンクにインライン化され、`@xrift/code-security` で `new Worker()` が critical 違反として検出される場合があります。

```typescript
// ✅ 正しい（shared チャンクとして分離される）
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

// ❌ 間違い（インライン化されセキュリティ違反の可能性）
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
```

---

## プロジェクト概要

- **用途**: XRiftプラットフォーム用WebXRワールド（シャサフ式音楽の実験場「Shasavistic Music Lab」）
- **技術**: React Three Fiber + Rapier物理エンジン + Module Federation
- **動作**: CDNにアップロード後、フロントエンドから動的ロード

---

## プロジェクト構造

```
shasavistic-music-lab/
├── public/              # アセットファイル（直接配置、サブディレクトリ不要）
├── src/
│   ├── components/      # 3Dコンポーネント
│   ├── World.tsx        # メインワールドコンポーネント
│   ├── dev.tsx          # 開発用エントリーポイント
│   ├── index.tsx        # 本番用エクスポート
│   └── constants.ts     # 定数定義
├── .triplex/            # Triplex（3Dエディタ）設定
├── xrift.json           # XRift CLI設定
├── vite.config.ts       # ビルド設定（Module Federation）
└── package.json
```

---

## 検証入口

このワールドの検証はこのディレクトリを作業場所として完結させる。実行順序は `typecheck` → `test` → `build` → `xrift check` とする。

```bash
npm run typecheck  # 型検査
npm test           # 配線検査と実 Chrome での音声信号採取検査（約2秒）
npm run build      # 本番ビルド
xrift check        # セキュリティ検査（APPROVE/REVIEW/REJECT）
```

`test` の採取検査は実 Chrome を起動する。実行体は `XRIFT_CAPTURE_CHROME` で指定できる。Chrome が無い環境では失敗する。未実装の受入れ条件は `workflow/spec/` の一時的な検証計画に置く。

---

## コマンドリファレンス

```bash
# 開発
npm run dev        # 開発サーバー起動 (http://localhost:5173)
npm run build      # 本番ビルド
npm run typecheck  # 型チェック
npm test           # 配線検査（vitest）

# XRift CLI
xrift login        # 認証
xrift create world # 新規ワールドプロジェクト作成
xrift upload       # アップロード（xrift.json から自動判定）
xrift whoami       # ログインユーザー確認
xrift logout       # ログアウト
xrift check        # セキュリティ検査
```

---

## 実装例の参照先

このワールドは最小構成のため、実装例は以下のみです。その他のコンポーネント（VideoPlayer、Interactable等）の使い方は [XRift ドキュメント](https://docs.xrift.net) を参照してください。

- **Skybox**: `src/components/Skybox/index.tsx`
- **メインワールド**: `src/World.tsx`
