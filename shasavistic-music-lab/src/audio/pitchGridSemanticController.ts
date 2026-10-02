/**
 * 正規化済み共有意図から意味論型を組み立て session へ届ける制御器。
 *
 * 意図の読み替え・組立て・配置接続・session の寿命を束ねる単一経路である。
 * 発音口を直接更新せず、session だけが書き込む。他の経路との
 * 二重反映はしない。
 * 共有意図の所有は担わず、正規化済み共有意図の根と由来を読むだけであり、
 * 選び直し・解音の選択・ベースの自動導出はしない。
 * 失敗はローカル表示へ届け、共有意図を巻き戻さない。
 *
 * @packageDocumentation
 */

import {
  PITCH_GRID_BASE_FREQUENCY_HZ,
  assignPitchGridFrequencies,
  pitchGridKey,
  pitchGridPointFromKey,
  resolvePitchGridIntent,
  type PitchGridIntent,
  type PitchGridPoint,
} from './pitchGrid';
import { toPitchGridSemanticChord } from './pitchGridSemanticChord';
import {
  createSemanticChordSoundSession,
  type SemanticChordSoundSession,
} from './semanticChordSound';
import {
  PITCH_GRID_MAX_VOICES,
  type PitchGridSoundingVoice,
} from './pitchGridSound';

/**
 * 意味論経路の反射器が画面へ渡す快照。実際に鳴った声だけを載せる。
 *
 * 値は読み取り専用とする。発振器などの音声資源は含まない。
 */
export interface PitchGridSemanticSoundSnapshot {
  /**
   * 実発音一覧の声の数（表示用）。
   *
   * session が声数を公開しないため、一覧の長さから求める。
   * 容量判定には使わない。上限の検査は上位の制御器がオン点＋ベースの
   * 同時発音数で、下位 session が仕様数で行う。
   */
  readonly voiceCount: number;
  /**
   * session が保持中かつ再開成立した声の鍵と周波数（表示用）。
   *
   * 選択意図の座標から周波数を再計算したものではなく、session の
   * 表示中継をそのまま載せる。再開未成立・再開失敗・減衰中の声は含まない。
   */
  readonly soundingVoices: readonly PitchGridSoundingVoice[];
  /**
   * 直近の反映の失敗内容（表示用）。失敗がなければ `null`。
   *
   * 共有意図の巻き戻しは行わず、次に成功した反映で `null` へ戻る。
   */
  readonly failureMessage: string | null;
}

/** 意味論経路の反射器の生成条件。 */
export interface PitchGridSemanticSoundReflectorOptions {
  /**
   * session の生成口。省略時は新規の意味論 session を使う。
   * 検査では代替物に差し替える。
   */
  readonly createSession?: () => SemanticChordSoundSession;
  /** 状態が変わったときの通知口。省略時は通知しない。 */
  readonly notify?: () => void;
}

/**
 * 正規化済み共有意図を自端末の音へ反映する口。
 *
 * session を専有し、遅延生成ではなく生成時に確保する。
 * 発音口の生成は session が初回の発音まで遅らせる。
 */
export interface PitchGridSemanticSoundReflector {
  /** ローカル音声の表示用快照を返す。 */
  getSnapshot(): PitchGridSemanticSoundSnapshot;
  /**
   * 共有意図を自端末の音へ反映する。
   *
   * 自分の操作による変化と遠隔の変化を区別せず、同じ一経路で反映する。
   * 空集合の反映では発音口を生成せず session の停止に寄せる。
   * 非空の反映では配置済みの指数で意味論型を組み、解音周波数を明示して
   * session へ渡す。オン点とベースを合わせた同時発音が上限を超える
   * 場合は session へ渡さず失敗として扱う。次元が変わった反映の切替は
   * session 側に委ね、この口で次元判定を持たない。失敗は表示用快照へ載せて通知し、
   * 共有意図へ投げ返さない。
   *
   * @param intent - 共有機構から届いた演奏意図。正規化してから読む。
   */
  reflect(intent: PitchGridIntent): void;
  /**
   * 全声を止める。
   *
   * session の停止へ委ねる。進行中の反映の完了は古いものとして扱い、
   * 以降の表示を上書きしない。
   */
  stop(): void;
  /**
   * session を破棄する。
   *
   * @remarks
   * 複数回呼んでも破棄は一度だけ行う。破棄後の反映は受け付けない。
   */
  dispose(): Promise<void>;
}

// 失敗の表示文言を取り出す。session 側の失敗を握り潰さず、
// ローカル表示へ載せるための文言化だけを行う。
function failureTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 正規化済み共有意図を自端末の音へ反映する口を作る。
 *
 * 呼び出し側は共有意図の変化時に反映口を呼ぶ。
 * session の表示内容変化はこの口の既存通知へ転送する。
 *
 * @param options - session の生成口と状態通知口。
 * @returns 親操作部品の存続中は使い回す反射器。
 */
export function createPitchGridSemanticSoundReflector(
  options: PitchGridSemanticSoundReflectorOptions = {},
): PitchGridSemanticSoundReflector {
  const createSession = options.createSession ?? ((): SemanticChordSoundSession => createSemanticChordSoundSession());
  const notify = options.notify ?? ((): void => {});
  const session = createSession();
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  // 直近の反映の失敗内容。次に成功した反映・空集合の反映で `null` へ戻る。
  let failureMessage: string | null = null;
  // 反映の世代。未完了反映中の連続更新で古い完了が新しい判定・表示を
  // 上書きしないための最小の制御であり、汎用キューにはしない。
  // 完了の照合はこの数で行い、声の実体照合は session・発音口側に寄せる。
  let generation = 0;

  // session の表示内容変化を既存通知へ転送する。表示の快照取得と
  // 通知の接続だけが目的であり、音声資源の読出しには使わない。
  // session は生成前からの購読を受け付けるため、ここで購読してよい。
  const unsubscribeSounding = session.subscribeSounding(() => {
    if (!disposed) {
      notify();
    }
  });

  // ADR: 反映の受付は `PitchGridIntent` で行う。`PitchGridSnapshot` には
  // 機能根が含まれず、純粋変換に必要な根を読めないため、共有意図そのものを
  // 受けて境界で正規化する。選び直しは行わず、根と由来を読むだけとする。
  const reflector: PitchGridSemanticSoundReflector = {
    getSnapshot(): PitchGridSemanticSoundSnapshot {
      const sounding = session.soundingVoices;
      return { voiceCount: sounding.length, soundingVoices: sounding, failureMessage };
    },
    reflect(intent: PitchGridIntent): void {
      if (disposed) {
        return;
      }
      const resolved = resolvePitchGridIntent(intent);
      const generationOfThis = (generation += 1);
      // 空集合は session の停止に寄せる。発音口が未生成の場合は
      // session 側が何も作らず何もしない。次元の追跡は session が担う。
      if (resolved.onPoints.length === 0) {
        if (failureMessage !== null) {
          failureMessage = null;
          session.stop();
          notify();
          return;
        }
        session.stop();
        return;
      }
      const rootPoint =
        resolved.functionalRootKey === null
          ? null
          : pitchGridPointFromKey(resolved.functionalRootKey);
      const points: PitchGridPoint[] = [];
      for (const key of resolved.onPoints) {
        const point = pitchGridPointFromKey(key);
        if (point !== null) {
          points.push(point);
        }
      }
      // 正規化済みの意図では非空なら根は必ず集合内に定まる。
      // ここに残る不整合は共有値の異常ではなく内部の対応付けの異常であり、
      // 共有意図を巻き戻さずローカル表示へ届ける。
      if (rootPoint === null) {
        failureMessage = `機能根を読み替えられない: ${String(resolved.functionalRootKey)}`;
        notify();
        return;
      }
      // ADR: 各点の配置済み指数 `k` は集合単位の配置関数の結果をそのまま使う。
      // 周波数からの `log2` 逆算・配置の別実装・選び直しは行わない。
      // 鍵の対応付けは座標鍵で行い、発音口の鍵形式とは混同しない。
      // 組立て・配置の失敗は呼び出し側へ投げ返さず、ローカル表示へ届ける。
      let task: Promise<void>;
      try {
        const assigned = assignPitchGridFrequencies(points, resolved.dimension);
        const kByKey = new Map(assigned.map((voice) => [voice.key, voice.k] as const));
        const chordPoints = points.map((point) => {
          const k = kByKey.get(pitchGridKey(point));
          if (k === undefined) {
            throw new Error(`配置結果に対応する点がない: ${pitchGridKey(point)}`);
          }
          return { x: point.x, y: point.y, k };
        });
        // ADR: 解音周波数は全体音高基準を明示して渡す。配置が中央の発音に
        // 選んだ周波数や session の既定値は使わない。
        // ADR: 上限はオン点＋ベースの同時発音で数える（要求 `:64` による
        // 上限内扱い）。ベースの有無は組み立てた意味論型から求め、配線の
        // 確定後も数え漏らさない。超過時は session へ渡さず、発音口を更新せず
        // 既存の声も止めない。下位 session の仕様数検査は最終防御として残す。
        const chord = toPitchGridSemanticChord({
          dimension: resolved.dimension,
          points: chordPoints,
          functionalRoot: rootPoint,
        });
        const simultaneousVoices =
          resolved.onPoints.length + (chord.bass === undefined ? 0 : 1);
        if (simultaneousVoices > PITCH_GRID_MAX_VOICES) {
          failureMessage = `オン点とベースを合わせた同時発音は上限以下であること: ${simultaneousVoices} > ${PITCH_GRID_MAX_VOICES}`;
          notify();
          return;
        }
        task = session.reflect(chord, PITCH_GRID_BASE_FREQUENCY_HZ);
      } catch (error: unknown) {
        failureMessage = failureTextOf(error);
        notify();
        return;
      }
      // 完了・失敗のいずれも世代を照合し、古い完了が新しい判定・表示を
      // 上書きしない。成功では直近の失敗表示を消し、失敗では表示へ載せる。
      // 共有意図への投げ返しは行わない。
      void task.then(
        () => {
          if (disposed || generationOfThis !== generation) {
            return;
          }
          if (failureMessage !== null) {
            failureMessage = null;
          }
          notify();
        },
        (error: unknown) => {
          if (disposed || generationOfThis !== generation) {
            return;
          }
          failureMessage = failureTextOf(error);
          notify();
        },
      );
    },
    stop(): void {
      if (disposed) {
        return;
      }
      // 進行中の反映の完了を古いものにし、停止後の表示を上書きさせない。
      generation += 1;
      session.stop();
    },
    dispose(): Promise<void> {
      if (disposePromise !== null) {
        return disposePromise;
      }
      disposed = true;
      generation += 1;
      unsubscribeSounding();
      disposePromise = session.dispose();
      return disposePromise;
    },
  };

  return reflector;
}
