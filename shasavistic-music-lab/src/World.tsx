import { SpawnPoint } from '@xrift/world-components'
import { RigidBody } from '@react-three/rapier'
import { useRef } from 'react'
import { Mesh } from 'three'
import { Skybox } from './components/Skybox'
import { PitchGrid } from './components/PitchGrid'
import { TheoryIntroPanel } from './components/PitchGrid/TheoryIntroPanel'
import {
  THEORY_INTRO_POSITION,
  THEORY_INTRO_SIZE,
} from './components/PitchGrid/theoryPanel'
import pitchGridIntro from './content/pitch-grid-intro.json'
import { COLORS, WORLD_CONFIG } from './constants'

export interface WorldProps {
  position?: [number, number, number]
  scale?: number
}

export const World: React.FC<WorldProps> = ({ position = [0, 0, 0], scale = 1 }) => {
  const groundRef = useRef<Mesh>(null)
  const worldSize = WORLD_CONFIG.size * scale
  const wallHeight = WORLD_CONFIG.wallHeight * scale
  const wallThickness = WORLD_CONFIG.wallThickness * scale

  return (
    <group position={position} scale={scale}>

      {/* ========== 環境・照明 ========== */}
      <Skybox radius={500} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-far={80}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0}>
        <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[worldSize, worldSize]} />
          <meshLambertMaterial color={COLORS.ground} />
        </mesh>
      </RigidBody>

      {/* ========== 壁 ========== */}
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0}>
        <mesh position={[worldSize / 2, wallHeight / 2, 0]} castShadow>
          <boxGeometry args={[wallThickness, wallHeight, worldSize]} />
          <meshLambertMaterial color={COLORS.wall} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0}>
        <mesh position={[-worldSize / 2, wallHeight / 2, 0]} castShadow>
          <boxGeometry args={[wallThickness, wallHeight, worldSize]} />
          <meshLambertMaterial color={COLORS.wall} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0}>
        <mesh position={[0, wallHeight / 2, worldSize / 2]} castShadow>
          <boxGeometry args={[worldSize, wallHeight, wallThickness]} />
          <meshLambertMaterial color={COLORS.wall} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0}>
        <mesh position={[0, wallHeight / 2, -worldSize / 2]} castShadow>
          <boxGeometry args={[worldSize, wallHeight, wallThickness]} />
          <meshLambertMaterial color={COLORS.wall} />
        </mesh>
      </RigidBody>

      {/* ========== スポーン ========== */}
      <group position={[0, 0, 8]}>
        <SpawnPoint />
      </group>

      {/* ========== 音高格子の操作口（15 Cube・八方向移動・次元選択） ========== */}
      {/* 開発環境の中央光線の到達距離（3.5m）に収める。左右の端は平行移動で寄る。 */}
      <PitchGrid position={[0, 0, 5]} />

      {/* ========== 理論説明の1枚パネル。格子と独立の非操作面として奥側へ置く ========== */}
      {/* 格子（z=5）より小さい z に置き、正面を訪問者側の +z へ向ける。 */}
      {/* スポーン正面の格子・操作釦と投影上も重ならないよう右へ寄せる。 */}
      <TheoryIntroPanel
        intro={pitchGridIntro}
        position={THEORY_INTRO_POSITION}
        size={THEORY_INTRO_SIZE}
      />
    </group>
  )
}
