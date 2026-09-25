import { Interactable } from '@xrift/world-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HARMONIC_PRESETS } from '../../audio/harmonicPresets';
import { type HarmonicToneSession, createHarmonicToneSession } from '../../audio/harmonicTone';

export interface HarmonicSwitchProps {
  /** 操作口の配置位置。 */
  readonly position?: readonly [number, number, number];
}

/**
 * 調波単音の再生を起動する操作口。
 *
 * 発振器そのものではなく再生の起動口であり、利用者の操作の中でのみ
 * 音声文脈を生成・再開する。音声文脈は操作口の存続中は一つだけ保ち、
 * 停止では声だけを止め、破棄時に文脈を一度だけ閉じる。
 * 鳴らすたびに次のプリセットへ進み、初回の聴き比べだけを担う。
 * 直接操作子は作らない。
 */
export function HarmonicSwitch({ position = [1.5, 1.5, 6] }: HarmonicSwitchProps): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [presetIndex, setPresetIndex] = useState(0);
  // 操作口の存続に対応する演奏口。文脈の生成は初回の操作まで遅らせる。
  const sessionRef = useRef<HarmonicToneSession | null>(null);
  // 開始時に使う順番。停止と開始をまたぐ二度の操作でずれないよう参照でも保つ。
  const nextIndexRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session !== null) {
        void session.dispose();
      }
    };
  }, []);

  const handleInteract = useCallback(() => {
    let session = sessionRef.current;
    if (session === null) {
      session = createHarmonicToneSession();
      sessionRef.current = session;
    }
    const active = session;
    if (active.playing) {
      active.stop();
      setPlaying(false);
      return;
    }
    const preset = HARMONIC_PRESETS[nextIndexRef.current];
    // 非同期の生成完了を待つ間の連打は、演奏口の中で一つの起動に束ねる。
    void active
      .start({ preset })
      .then(() => {
        if (!mountedRef.current) {
          void active.dispose();
          return;
        }
        if (active.playing) {
          // 鳴らせた場合だけ次のプリセットへ進める。
          const following = (nextIndexRef.current + 1) % HARMONIC_PRESETS.length;
          nextIndexRef.current = following;
          setPresetIndex(following);
        }
        setPlaying(active.playing);
      })
      .catch(() => {
        if (mountedRef.current) {
          setPlaying(false);
        }
      });
  }, []);

  const currentName = HARMONIC_PRESETS[presetIndex].name;

  return (
    <Interactable
      id="harmonic-synth-switch"
      type="button"
      onInteract={handleInteract}
      interactionText={playing ? '音を止める' : `鳴らす: ${currentName}`}
    >
      <mesh position={[position[0], position[1], position[2]]} castShadow>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={playing ? '#ff7043' : '#4caf50'} />
      </mesh>
    </Interactable>
  );
}
