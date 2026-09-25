# WebAudio リズム隊・シーケンサ構成

## 方針

WebAudio API を音源処理の基盤とし、シーケンサ部分には Tone.js を利用する。

Tone.js は主に時間管理・パターン再生に限定して使用し、音源は自作 WebAudio ノードやサンプラーを統一的に扱える構成にする。

## 全体構成

```text
Tone.Transport
  │
  ├─ Tone.Sequence
  ├─ Tone.Part
  └─ schedule
        │
        ▼
  InstrumentEvent
        │
        ├─ Drum Sampler
        ├─ Bass Synth
        ├─ Custom Oscillator
        └─ AudioWorklet Instrument
```

## シーケンサ

Tone.js を以下の用途に使用する。

- BPM・拍子管理
- ループ
- スウィング
- 16分音符などの音楽的時間指定
- 発音タイミングの正確な予約
- パターン・イベント列の管理

`Tone.Sequence` や `Tone.Part` のコールバックから渡される WebAudio 時刻を使って、自作音源を発音する。

## 音源インターフェース

音源ごとの差をシーケンサから隠蔽する。

```ts
interface Instrument {
  trigger(event: InstrumentEvent, time: number): void;
}
```

イベント例:

```ts
interface InstrumentEvent {
  note?: number;
  velocity?: number;
  duration?: number;
  params?: Record<string, number>;
}
```

これにより以下を同じシーケンサから扱える。

- AudioBuffer ベースのサンプラー
- smplr 等の既製音源
- OscillatorNode ベースの自作シンセ
- AudioWorklet ベースの高度な音源
- 将来的な WASM 音源

## ドラム構成

ドラムは基本的にサンプルベースとする。

```text
Drums
├─ Kick
├─ Snare
├─ Closed Hi-Hat
├─ Open Hi-Hat
├─ Clap
└─ Percussion
```

各音は `AudioBufferSourceNode` または既存サンプラーで再生する。

初期段階では TR-808 / TR-909 系などの既存サンプルセットを使うと実装が速い。

パターン例:

```text
Kick   X--- X--- X--- X---
Snare  ---- X--- ---- X---
HH     X-X- X-X- X-X- X-X-
```

## ベース・自作シンセ

ベースや独自音色は WebAudio API で構成する。

```text
Oscillator
   ↓
Filter
   ↓
Envelope / Gain
   ↓
Effects
   ↓
Master
```

Tone.js は発音タイミングのみ管理し、波形生成・倍音・フィルターなどの音響処理は自前実装する。

## 推奨構成

```text
Tone.js
  → Transport / Sequence / Part

smplr / AudioBuffer
  → ドラム・既製サンプル音源

WebAudio API
  → 自作オシレーター・フィルター・エフェクト

AudioWorklet
  → 将来的な高度なDSP
```

Tone.js への依存をシーケンサ層に限定することで、音源部分を自由に拡張・置換できる構成とする。