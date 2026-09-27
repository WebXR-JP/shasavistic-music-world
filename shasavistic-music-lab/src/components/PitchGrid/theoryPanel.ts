/**
 * 格子奥側の理論説明を1枚に描くための文章配置と折返し。
 *
 * 見出しと段落を順序・段落境界を保ったまま一つの描画面に収める。
 * 既存の `TextPlate`（格子ラベル・矢印・次元の最大2行用）は変えず、
 * 説明専用の描画は `TheoryIntroPanel.tsx` がこの配置を使う。
 * 配置の具体値（ワールド座標・寸法・向き）はここの定数に集め、
 * `World.tsx` は格子と独立の説明パネルとして置くだけにする。
 *
 * @packageDocumentation
 */

/** 理論説明の文章。静的 import で読む bundled データの形。 */
export interface PitchGridIntro {
  /** 見出し。先頭に置く。 */
  readonly title: string;
  /** 短い段落の配列。順序と境界を保って並べる。 */
  readonly paragraphs: readonly string[];
}

/** 書体と行文から描画幅を返す測定口。描画時の `measureText` を使う。 */
export type TheoryTextWidth = (font: string, text: string) => number;

/** 一枚の説明に収める配置結果。面は一つだけである。 */
export interface TheoryIntroLayout {
  /** 見出しの行。先頭に置く。 */
  readonly titleLines: readonly string[];
  /** 段落ごとの行。入力の段落順序・境界に対応する。 */
  readonly paragraphLines: ReadonlyArray<readonly string[]>;
  /** 描画に使う見出しの書体サイズ（px）。 */
  readonly titleFontPx: number;
  /** 描画に使う本文の書体サイズ（px）。 */
  readonly bodyFontPx: number;
  /** 一枚に収まるか。収まらない場合は理由を示し、欠落・極小化しない。 */
  readonly fits: boolean;
  /** 収まらない理由。収まる場合はない。 */
  readonly overflowReason?: 'min-font' | 'rows' | 'height';
  /** 描画面の幅（px）。固定上限を超えない。 */
  readonly canvasWidth: number;
  /** 描画面の高さ（px）。固定上限を超えない。 */
  readonly canvasHeight: number;
}

/** 描画面の幅（px）。際限なく解像度を増やさない固定上限である。 */
export const THEORY_INTRO_CANVAS_WIDTH = 1024;

/** 描画面の高さ（px）。際限なく解像度を増やさない固定上限である。 */
export const THEORY_INTRO_CANVAS_HEIGHT = 768;

/** 描画面の余白（片側px）。枠の内側に文字を収める。 */
export const THEORY_INTRO_MARGIN_PX = 64;

/** 見出しの基の書体サイズ（px）。本文より大きくする。 */
export const THEORY_INTRO_TITLE_BASE_PX = 56;

/** 本文の基の書体サイズ（px）。 */
export const THEORY_INTRO_BODY_BASE_PX = 34;

/** 本文の下限書体サイズ（px）。判読できる大きさに留める。 */
export const THEORY_INTRO_BODY_MIN_PX = 24;

/** 見出しと本文の書体差（px）。縮小時も見出しを本文より大きく保つ。 */
export const THEORY_INTRO_TITLE_BODY_DELTA_PX =
  THEORY_INTRO_TITLE_BASE_PX - THEORY_INTRO_BODY_BASE_PX;

/** 見出しの行間（書体倍率）。本文と分ける。 */
export const THEORY_INTRO_TITLE_LINE_HEIGHT = 1.5;

/** 本文の行間（書体倍率）。見出しと分ける。 */
export const THEORY_INTRO_BODY_LINE_HEIGHT = 1.6;

/** 見出しと本文の間隔（px）。 */
export const THEORY_INTRO_TITLE_BODY_GAP_PX = 32;

/** 段落の間隔（px）。段落境界を示す。 */
export const THEORY_INTRO_PARAGRAPH_GAP_PX = 28;

/** 見出しの最大行数。 */
export const THEORY_INTRO_MAX_TITLE_ROWS = 2;

/** 本文の最大行数。 */
export const THEORY_INTRO_MAX_BODY_ROWS = 16;

/**
 * 説明パネルの配置位置（ワールド座標）。
 * 格子（`World.tsx` の `PitchGrid` 配置）より小さい z の奥側に置き、
 * スポーン正面の格子・操作釦と投影上も重ならないよう右へ寄せる。
 * 壁の内側・地面より上に収める。
 */
export const THEORY_INTRO_POSITION: readonly [number, number, number] = [9, 2, 1];

/** 説明パネルの大きさ（幅・高さ）。描画面と同じ縦横比である。 */
export const THEORY_INTRO_SIZE: readonly [number, number] = [4.8, 3.6];

/**
 * 説明パネルの向き。面の既定の正面（+z）を訪問者側へ向けるため回転しない。
 * 回転を付けないことを明示し、向きの検査対象にする。
 */
export const THEORY_INTRO_ROTATION: readonly [number, number, number] = [0, 0, 0];

/** 行頭に置かない文字（閉じ約物など）。行末への追い込みで避ける。 */
const THEORY_INTRO_HEAD_FORBIDDEN = new Set(
  Array.from('、。！？，．・：；!?,.:;）］｝」』’”｠›»≫…‥—―～〜ー)]}'),
);

/** 行末に置かない文字（開き約物）。次行送りで避ける。 */
const THEORY_INTRO_TAIL_FORBIDDEN = new Set(Array.from('（［｛「『‘“｟‹«([{<'));

/** 英数字の連続を判定する式。途中での不自然な分断を避ける。 */
const THEORY_INTRO_ALNUM = /[A-Za-z0-9]/;

/**
 * 見出しの書体指定を作る。本文より大きく太字にする。
 *
 * @param px - 書体サイズ（px）。
 * @returns 描画と測定に使う `font` 指定。
 */
export function theoryTitleFont(px: number): string {
  return `bold ${px}px sans-serif`;
}

/**
 * 本文の書体指定を作る。見出しより小さく通常字にする。
 *
 * @param px - 書体サイズ（px）。
 * @returns 描画と測定に使う `font` 指定。
 */
export function theoryBodyFont(px: number): string {
  return `${px}px sans-serif`;
}

/**
 * 行文に使える幅（px）。描画面から左右余白を除いた幅である。
 *
 * @returns 行文の最大描画幅（px）。
 */
export function theoryIntroMaxLineWidthPx(): number {
  return THEORY_INTRO_CANVAS_WIDTH - THEORY_INTRO_MARGIN_PX * 2;
}

/**
 * 内容が占める高さを求める。描画と収まり判定で同じ式を使う。
 *
 * @param titleRowCount - 見出しの行数。
 * @param bodyRowCount - 本文の全行数。
 * @param paragraphCount - 段落数。段落間隔の数に使う。
 * @param titlePx - 見出しの書体サイズ（px）。
 * @param bodyPx - 本文の書体サイズ（px）。
 * @returns 内容の高さ（px）。余白を含まない。
 */
export function theoryIntroContentHeightPx(
  titleRowCount: number,
  bodyRowCount: number,
  paragraphCount: number,
  titlePx: number,
  bodyPx: number,
): number {
  const titleHeight = titleRowCount * titlePx * THEORY_INTRO_TITLE_LINE_HEIGHT;
  const bodyHeight = bodyRowCount * bodyPx * THEORY_INTRO_BODY_LINE_HEIGHT;
  const gaps =
    THEORY_INTRO_TITLE_BODY_GAP_PX + Math.max(0, paragraphCount - 1) * THEORY_INTRO_PARAGRAPH_GAP_PX;
  return titleHeight + gaps + bodyHeight;
}

/**
 * 折返し位置を整える。行頭禁則・行末禁則・英数字の分断を避ける。
 *
 * 幅超過で決まった区切りを、避けられる範囲でずらすだけであり、
 * 避けられない場合（行全体が連続する英数字など）は元の区切りを保つ。
 *
 * @param chars - 符号点単位の文字配列。
 * @param start - 行の開始位置。
 * @param end - 幅超過で決まった行末（次行の開始位置）。
 * @returns 整えた次行の開始位置。
 */
function adjustTheoryBreak(chars: readonly string[], start: number, end: number): number {
  let adjusted = end;
  const last = chars[adjusted - 1];
  const next = chars[adjusted];
  // 英数字の連続の途中で切る場合は連続の先頭まで戻す。行全体が連続の
  // 場合は戻せないため元の区切りを保つ（収まり判定が検出する）。
  if (last !== undefined && next !== undefined && THEORY_INTRO_ALNUM.test(last) && THEORY_INTRO_ALNUM.test(next)) {
    let runStart = adjusted - 1;
    while (runStart > start && THEORY_INTRO_ALNUM.test(chars[runStart - 1] ?? '')) {
      runStart -= 1;
    }
    if (runStart > start) {
      adjusted = runStart;
    }
  }
  // 行末の開き約物は次行へ送る。行全体が約物の場合は保つ。
  while (adjusted > start + 1 && THEORY_INTRO_TAIL_FORBIDDEN.has(chars[adjusted - 1] ?? '')) {
    adjusted -= 1;
  }
  // 行頭の閉じ約物は行末へ追い込む。余白の内側に収まる範囲の譲歩である。
  while (adjusted < chars.length && THEORY_INTRO_HEAD_FORBIDDEN.has(chars[adjusted] ?? '')) {
    adjusted += 1;
  }
  return adjusted;
}

/**
 * 一つの文を実測幅で折り返す。
 *
 * 書体での描画幅が上限を超えた位置で区切り、固定文字数では切らない。
 * 符号点を割らず、区切り位置は禁則と英数字の連続に配慮する。
 *
 * @param measure - 書体と行文から描画幅を返す測定口。
 * @param text - 折り返す文。空文の場合は空配列。
 * @param font - 測定と描画に使う書体指定。
 * @param maxWidthPx - 行文に使える幅（px）。正の数。
 * @returns 先頭からの順序を保った行の配列。
 * @throws `RangeError` — 行文に使える幅が正の数でない場合。
 */
export function wrapMeasuredText(
  measure: TheoryTextWidth,
  text: string,
  font: string,
  maxWidthPx: number,
): string[] {
  if (!(maxWidthPx > 0)) {
    throw new RangeError(`行文に使える幅は正の数であること: ${String(maxWidthPx)}`);
  }
  const chars = Array.from(text);
  const rows: string[] = [];
  let index = 0;
  while (index < chars.length) {
    let end = index;
    while (end < chars.length && measure(font, chars.slice(index, end + 1).join('')) <= maxWidthPx) {
      end += 1;
    }
    if (end === index) {
      // 一字で幅を超える場合は一字だけ置き、収まり判定で検出する。
      end = index + 1;
    } else if (end < chars.length) {
      end = adjustTheoryBreak(chars, index, end);
    }
    rows.push(chars.slice(index, end).join(''));
    index = end;
  }
  return rows;
}

/**
 * 理論説明の文章を一枚の配置に収める。
 *
 * 見出しを先頭に置き、本文は段落の順序・境界を保ったまま折り返す。
 * 基の書体で収まらない場合は下限まで縮小して折り返し直し、
 * 行数・高さ・最低書体サイズのいずれか超過は理由付きで検出する。
 * 黙って欠落・極小化しない。判定の優先順は最低書体・行数・高さの順である。
 *
 * @param measure - 書体と行文から描画幅を返す測定口。
 * @param intro - 理論説明の文章。
 * @returns 一枚分の配置結果。収まらない場合は理由を持つ。
 */
export function layoutTheoryIntro(measure: TheoryTextWidth, intro: PitchGridIntro): TheoryIntroLayout {
  const maxWidthPx = theoryIntroMaxLineWidthPx();
  const usableHeightPx = THEORY_INTRO_CANVAS_HEIGHT - THEORY_INTRO_MARGIN_PX * 2;
  for (let bodyPx = THEORY_INTRO_BODY_BASE_PX; bodyPx >= THEORY_INTRO_BODY_MIN_PX; bodyPx -= 2) {
    const titlePx = bodyPx + THEORY_INTRO_TITLE_BODY_DELTA_PX;
    const titleRows = wrapMeasuredText(measure, intro.title, theoryTitleFont(titlePx), maxWidthPx);
    if (titleRows.length > THEORY_INTRO_MAX_TITLE_ROWS) {
      continue;
    }
    const paragraphRows = intro.paragraphs.map((paragraph) =>
      wrapMeasuredText(measure, paragraph, theoryBodyFont(bodyPx), maxWidthPx),
    );
    const bodyRowCount = paragraphRows.reduce((total, rows) => total + rows.length, 0);
    const tooWide = (row: string, font: string): boolean => measure(font, row) > maxWidthPx;
    if (
      titleRows.some((row) => tooWide(row, theoryTitleFont(titlePx))) ||
      paragraphRows.some((rows) => rows.some((row) => tooWide(row, theoryBodyFont(bodyPx))))
    ) {
      continue;
    }
    if (bodyRowCount > THEORY_INTRO_MAX_BODY_ROWS) {
      continue;
    }
    if (
      theoryIntroContentHeightPx(
        titleRows.length,
        bodyRowCount,
        intro.paragraphs.length,
        titlePx,
        bodyPx,
      ) > usableHeightPx
    ) {
      continue;
    }
    return {
      titleLines: titleRows,
      paragraphLines: paragraphRows,
      titleFontPx: titlePx,
      bodyFontPx: bodyPx,
      fits: true,
      canvasWidth: THEORY_INTRO_CANVAS_WIDTH,
      canvasHeight: THEORY_INTRO_CANVAS_HEIGHT,
    };
  }
  // 下限でも収まらない場合の理由を同じ測定で診断する。
  const titlePx = THEORY_INTRO_BODY_MIN_PX + THEORY_INTRO_TITLE_BODY_DELTA_PX;
  const titleRows = wrapMeasuredText(measure, intro.title, theoryTitleFont(titlePx), maxWidthPx);
  const paragraphRows = intro.paragraphs.map((paragraph) =>
    wrapMeasuredText(measure, paragraph, theoryBodyFont(THEORY_INTRO_BODY_MIN_PX), maxWidthPx),
  );
  const bodyRowCount = paragraphRows.reduce((total, rows) => total + rows.length, 0);
  const tooWide = (row: string, font: string): boolean => measure(font, row) > maxWidthPx;
  const minFontOverflow =
    titleRows.some((row) => tooWide(row, theoryTitleFont(titlePx))) ||
    paragraphRows.some((rows) =>
      rows.some((row) => tooWide(row, theoryBodyFont(THEORY_INTRO_BODY_MIN_PX))),
    );
  let overflowReason: 'min-font' | 'rows' | 'height' = 'height';
  if (minFontOverflow) {
    overflowReason = 'min-font';
  } else if (
    titleRows.length > THEORY_INTRO_MAX_TITLE_ROWS ||
    bodyRowCount > THEORY_INTRO_MAX_BODY_ROWS
  ) {
    overflowReason = 'rows';
  }
  return {
    titleLines: titleRows,
    paragraphLines: paragraphRows,
    titleFontPx: titlePx,
    bodyFontPx: THEORY_INTRO_BODY_MIN_PX,
    fits: false,
    overflowReason,
    canvasWidth: THEORY_INTRO_CANVAS_WIDTH,
    canvasHeight: THEORY_INTRO_CANVAS_HEIGHT,
  };
}
