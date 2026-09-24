# XRiftワールドの作り方

この文書はXRift公式資料の「最初のワールドを作成する」を中心に、ワールド作成の手順をまとめた参考資料であり、要求正本・設計・検証計画ではない。このプロジェクトで採用する仕様や設計判断は書かない。

## 概要

- XRift公式資料の「最初のワールドを作成する」を中心に、CLIの導入、ワールドプロジェクトの作成、開発用サーバーの起動、見た目や動きの調整、アセットの追加、設定ファイル、ビルドとアップロードまでの流れをまとめる。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

## 前提条件とCLIの導入

- 前提条件は Node.js 18.0.0 以上、npm である。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）
- 導入コマンドは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/getting-started/installation（本文取得、確認）

```bash
npm install -g @xrift/cli
xrift --version
```

- 主なコマンドは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/cli/overview（本文取得、確認）
  - 出典: https://docs.xrift.net/cli/commands（本文取得、確認）

```bash
xrift --help
xrift --version
xrift login          # ログイン（ブラウザ認証）
xrift whoami         # 現在のユーザー確認
xrift create         # 対話型で種類を選択
xrift create world <project-name>
xrift upload         # xrift.json から種別を自動判定
```

- `xrift create` のオプションは `--here`、`-t, --template <repository>`、`--skip-install`、`-y, --no-interactive` である。
  - 出典: https://docs.xrift.net/cli/commands（本文取得、確認）
- デフォルトのテンプレートは次の通り（原文の表どおり）。
  - `xrift create world` は `WebXR-JP/xrift-test-world`、`xrift create item` は `WebXR-JP/xrift-item-template` である。
  - 出典: https://docs.xrift.net/cli/commands（本文取得、確認）
  - ただし現行の実体は `WebXR-JP/xrift-world-template` であり、旧称の可能性が残る。未確認節に分ける。

## ワールドプロジェクトの作成

- 作成コマンドは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```bash
xrift create world my-first-world
cd my-first-world
```

- `-y` を付けると対話を省く。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）
- 導入直後の流れはクイックスタートにも同じ記載がある。
  - 出典: https://docs.xrift.net/getting-started/quick-start（本文取得、確認）

## プロジェクトの構成

- 作成直後の構成は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```
my-first-world/
├── src/
│   ├── World.tsx
│   └── components/
├── public/
├── package.json
└── vite.config.ts
```

- 実際のテンプレートには上記に加えて `xrift.json`、`src/dev.tsx`、`src/index.tsx`、`index.html`、`tsconfig.json` が含まれる。
  - 出典: https://github.com/WebXR-JP/xrift-world-template（本文取得、確認）
- `src/index.tsx` は `export { World } from './World'` の形で `World` を公開する。`src/dev.tsx` は開発用に `DevEnvironment` と `XRiftProvider` で `World` を描画し、本番ビルドに含めない。
  - 出典: https://github.com/WebXR-JP/xrift-world-template（本文取得、確認）
- テンプレートの `package.json` の scripts は次の通り（原文どおり）。
  - 出典: https://github.com/WebXR-JP/xrift-world-template（本文取得、確認）

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit"
}
```

- 主な依存は `@xrift/world-components ^0.53.0`、ピア依存は `react ^19.0.0`、`@react-three/fiber ^9.3.0`、`@react-three/rapier ^2.1.0`、`@react-three/drei ^10.7.3`、`three ^0.183.1`、開発用依存は `@originjs/vite-plugin-federation ^1.4.1`、`vite ^7.3.1` などである。
  - 出典: https://github.com/WebXR-JP/xrift-world-template（本文取得、確認）
- `vite.config.ts` はModule Federationを使い `exposes: { './World': './src/index.tsx' }` を公開し、`shared` に react・three・`@react-three/*`・`@xrift/world-components` をシングルトンで指定する。
  - 出典: https://github.com/WebXR-JP/xrift-world-template（本文取得、確認）
  - 出典: https://docs.xrift.net/sdk/overview（本文取得、確認）

## 開発用サーバーの起動

- 起動コマンドは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```bash
npm run dev
```

- 開発サーバーは `http://localhost:5173` で起動する。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

## ワールドの調整

### オブジェクトの追加

- 例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
<mesh position={[3, 0.5, 0]}>
  <boxGeometry args={[1, 1, 1]} />
  <meshStandardMaterial color="orange" />
</mesh>
```

### インタラクション

- 例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
import { Interactable } from '@xrift/world-components';

<Interactable id="my-button" onInteract={() => console.log('クリック！')}>
  <mesh position={[0, 1, -2]}>
    <sphereGeometry args={[0.5]} />
    <meshStandardMaterial color="hotpink" />
  </mesh>
</Interactable>
```

- コンポーネントの一覧は `@xrift/world-components` のAPIリファレンスにある。
  - 出典: https://docs.xrift.net/world-components/components/（本文取得、確認）

### 状態の同期

- 例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
import { useInstanceState, Interactable } from '@xrift/world-components';

function SyncedLight() {
  const [isOn, setIsOn] = useInstanceState('light', false);

  return (
    <Interactable id="light-switch" onInteract={() => setIsOn(!isOn)}>
      <mesh position={[0, 2, 0]}>
        <sphereGeometry args={[0.3]} />
        <meshStandardMaterial
          color={isOn ? 'yellow' : 'gray'}
          emissive={isOn ? 'yellow' : 'black'}
        />
      </mesh>
    </Interactable>
  );
}
```

### 衝突判定

- 例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
import { RigidBody } from '@react-three/rapier';

{/* プレイヤーが通れない壁 */}
<RigidBody type="fixed">
  <mesh position={[0, 1, -5]}>
    <boxGeometry args={[10, 2, 0.5]} />
    <meshStandardMaterial color="gray" />
  </mesh>
</RigidBody>

{/* 落下するオブジェクト */}
<RigidBody type="dynamic">
  <mesh position={[0, 5, 0]}>
    <sphereGeometry args={[0.5]} />
    <meshStandardMaterial color="red" />
  </mesh>
</RigidBody>
```

- `RigidBody` の type は `fixed` が動かない静止物（壁・床）、`dynamic` が重力と衝突の影響を受けるもの、`kinematicPosition` がコードで位置を扱うものである。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）
- 見えない壁の例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
import { RigidBody, CuboidCollider } from '@react-three/rapier';

<RigidBody type="fixed">
  <CuboidCollider args={[5, 1, 0.25]} position={[0, 1, -5]} />
</RigidBody>
```

## アセットの追加

- アセットは `public/` に置く。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）
- 参照例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```tsx
import { useXRift } from '@xrift/world-components';
import { useGLTF } from '@react-three/drei';

function MyModel() {
  const { baseUrl } = useXRift();
  const { scene } = useGLTF(`${baseUrl}my-model.glb`);
  return <primitive object={scene} />;
}
```

- 注意（原文）: `baseUrl` は末尾に斜線を含む。`${baseUrl}/my-model.glb` は二重斜線になるため `${baseUrl}my-model.glb` と書く。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

## xrift.json 設定

- ワールド用の設定例は次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/configuration（本文取得、確認）

```json
{
  "world": {
    "distDir": "./dist",
    "title": "My World",
    "description": "サンプルワールドです",
    "thumbnailPath": "thumbnail.png",
    "buildCommand": "npm run build",
    "ignore": [
      "**/.DS_Store",
      "**/Thumbs.db",
      "**/*.map"
    ],
    "camera": {
      "near": 0.1,
      "far": 1000
    },
    "outputBufferType": "UnsignedByteType",
    "permissions": {
      "allowedDomains": ["api.example.com"],
      "allowedCodeRules": ["no-storage-access"]
    }
  }
}
```

- 主な項目は次の通り。
  - 出典: https://docs.xrift.net/guides/configuration（本文取得、確認）
  - `distDir`、`title`、`description`、`thumbnailPath`（推奨1280x720）、`buildCommand`、`ignore`、`physics`（`gravity`、`allowInfiniteJump`）、`camera`（`near`、`far`）、`outputBufferType`（`UnsignedByteType`=8ビット（デフォルト）、`HalfFloatType`=16ビットHDR、`FloatType`=32ビット最高精度）、`permissions`（`allowedDomains`、`allowedCodeRules`）。

## ビルドとアップロード

- ビルドと公開の流れは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）

```bash
npm run build
xrift upload world
```

- アップロード時に `xrift.json` の `buildCommand` が自動実行される。初回はタイトルと説明を尋ねる。アップロード後に自動コード審査があり、通過で公開となる。
  - 出典: https://docs.xrift.net/guides/create-first-world（本文取得、確認）
- 公開前の検査コマンドは次の通り（原文どおり）。
  - 出典: https://docs.xrift.net/cli/commands（本文取得、確認）

```bash
xrift upload / xrift upload world / xrift upload item
xrift check / xrift check world / xrift check item
xrift check --build
xrift check item --json
xrift check world --ignore-warnings
```

- `xrift check` のオプションは `--build`、`--ignore-warnings`、`--json` である。結果は APPROVE・REVIEW・REJECT で、REJECT のとき終了コード1である。`xrift upload` のオプションに `--skip-check` がある。
  - 出典: https://docs.xrift.net/cli/commands（本文取得、確認）
- 共有依存の注意として、`three/addons` をそのまま共有指定せず、下位パス単位（例 `three/addons/loaders/DRACOLoader.js`）で指定する（Lottie由来の eval 混入回避）。
  - 出典: https://docs.xrift.net/guides/shared-dependencies（本文取得、確認）
  - 出典: https://docs.xrift.net/sdk/overview（本文取得、確認）

## 出典と確認状態

- 取得日は 2026-09-24、取得方法はHTTP本文取得（Docusaurus の静的生成のため描画処理不要）である。

| 資料 | URL | 状態 |
|---|---|---|
| 最初のワールドを作成する | https://docs.xrift.net/guides/create-first-world | 本文取得、確認 |
| インストール | https://docs.xrift.net/getting-started/installation | 本文取得、確認 |
| クイックスタート | https://docs.xrift.net/getting-started/quick-start | 本文取得、確認 |
| xrift.json 設定（ワールド） | https://docs.xrift.net/guides/configuration | 本文取得、確認 |
| CLI 概要 | https://docs.xrift.net/cli/overview | 本文取得、確認 |
| コマンドリファレンス | https://docs.xrift.net/cli/commands | 本文取得、確認 |
| SDK 概要 | https://docs.xrift.net/sdk/overview | 本文取得、確認 |
| API リファレンス（@xrift/world-components） | https://docs.xrift.net/world-components/components/ | 本文取得、確認 |
| Shared パッケージ一覧 | https://docs.xrift.net/guides/shared-dependencies | 本文取得、確認 |
| 公式ワールドテンプレート | https://github.com/WebXR-JP/xrift-world-template | 本文取得、README・package.json・vite.config.ts・xrift.json・src/World.tsx・src/dev.tsx 等を確認 |

## 未確認事項

- `useXRift`・`XRiftProvider` は資料上に独立した仕様見出しが無い（作成手順のコード例には出るが `@xrift/world-components` のAPIリファレンスには見出しが無い）。
- デフォルトのテンプレート名の差異は未確認である。コマンドリファレンスは `WebXR-JP/xrift-test-world` と書くが、実体は `WebXR-JP/xrift-world-template` へ転送され現行は後者である。資料の記載が旧称の可能性がある。
- バージョンの差異は未確認である。共有依存の例（three `^0.176.0`、`@xrift/world-components ^0.1.0`）と実際のテンプレート（three `^0.183.1`、`@xrift/world-components ^0.53.0`）が一致しない。例が古い可能性がある。
- `npm run preview` はテンプレートにあるが作成手順には記載が無い。
- テンプレートの `src/components/Skybox`・`src/constants.ts`・`public/` の実ファイル本文は未取得である。
- `xrift upload` 後のコード審査基準・設定画面の詳細は未確認である。
- Node.js は全文書「18.0.0 以上」で、推奨バージョンの記載は未確認である。
- `xrift.json` に `type` 項目は無い（SDK内部で付与されると推測、資料上の明示は未確認）。
