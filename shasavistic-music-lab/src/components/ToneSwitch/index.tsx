import { Interactable } from '@xrift/world-components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type SingleToneSession, createSingleToneSession } from '../../audio/singleTone';

export interface ToneSwitchProps {
  /** 操作口の配置位置。 */
  readonly position?: readonly [number, number, number];
}

/**
 * 単音の再生を起動する操作口。
 *
 * 発振器そのものではなく再生の起動口であり、利用者の操作の中でのみ
 * 音声文脈を生成・再開する。音声文脈は操作口の存続中は一つだけ保ち、
 * 停止では発振器だけを止め、破棄時に文脈を一度だけ閉じる。
 */
export function ToneSwitch({ position = [0, 1.5, 6] }: ToneSwitchProps): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  // 操作口の存続に対応する演奏口。文脈の生成は初回の操作まで遅らせる。
  const sessionRef = useRef<SingleToneSession | null>(null);
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
      session = createSingleToneSession();
      sessionRef.current = session;
    }
    const active = session;
    if (active.playing) {
      active.stop();
      setPlaying(false);
      return;
    }
    // 非同期の生成完了を待つ間の連打は、演奏口の中で一つの起動に束ねる。
    void active
      .start()
      .then(() => {
        if (!mountedRef.current) {
          void active.dispose();
          return;
        }
        setPlaying(active.playing);
      })
      .catch(() => {
        if (mountedRef.current) {
          setPlaying(false);
        }
      });
  }, []);

  return (
    <Interactable
      id="single-tone-switch"
      type="button"
      onInteract={handleInteract}
      interactionText={playing ? '音を止める' : '音を鳴らす'}
    >
      <mesh position={[position[0], position[1], position[2]]} castShadow>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={playing ? '#ff7043' : '#4caf50'} />
      </mesh>
    </Interactable>
  );
}
