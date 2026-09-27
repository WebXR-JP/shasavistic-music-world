/**
 * 格子奥側の理論説明パネルの文章と配置。
 *
 * 文章データ（`src/content/pitch-grid-intro.json`）の段落を短い行に分け、
 * 既存の `TextPlate`（CanvasTexture・非raycast・最大2行）と同じ描画方式の
 * 複数枚パネルとして格子の奥側（訪問者から見て格子より遠い側）に置く。
 * 長文を一枚に詰め込まず、行数・寸法・配置はここの定数に集める。
 * 実画面の確認で調整する場合はこの定数を変え、描画方式自体は変えない。
 *
 * @packageDocumentation
 */

/** 理論説明の文章。静的 import で読む bundled データの形。 */
export interface PitchGridIntro {
  /** 見出し。一行で置く。 */
  readonly title: string;
  /** 短い段落の配列。順序を保って並べる。 */
  readonly paragraphs: readonly string[];
}

/** 一枚の説明パネルの描画指定。`TextPlate` の props にそのまま渡す。 */
export interface TheoryPanelSpec {
  /** 1行または2行の表示文。 */
  readonly lines: readonly [string] | readonly [string, string];
  /** 銘板面の大きさ（幅・高さ）。 */
  readonly size: readonly [number, number];
  /** 銘板面の配置位置。 */
  readonly position: readonly [number, number, number];
}

/** 一行に入れる最大文字数。小さい書体の描画面に収まる幅である。 */
export const THEORY_LINE_MAX_CHARS = 12;

/**
 * 格子面の横中央（部品内座標）。格子 Cube 列の中央と揃える。
 * 格子側の `GRID_CENTER_X` と並べる。ずれたら実画面で揃える。
 */
export const THEORY_CENTER_X = -0.85;

/** 説明パネルの奥行き（部品内座標）。Cube 背面より遠い側に置く。 */
export const THEORY_BEHIND_Z = -0.35;

/** 見出しパネルの大きさ（幅・高さ）。 */
export const THEORY_TITLE_SIZE: readonly [number, number] = [3.35, 0.44];

/** 見出しパネルの高さ（部品内座標）。本文の最上段より一段上に置く。 */
export const THEORY_TITLE_Y = 5.02;

/** 本文パネルの大きさ（幅・高さ）。 */
export const THEORY_BODY_SIZE: readonly [number, number] = [1.6, 0.4];

/** 本文の左右二列の横位置（部品内座標）。中央揃えの対である。 */
export const THEORY_BODY_COLUMNS: readonly [number, number] = [-1.71, 0.01];

/** 本文の最上段の高さ（部品内座標）。格子上段の銘板と重ならない高さである。 */
export const THEORY_BODY_TOP_Y = 4.5;

/** 本文の段間隔。 */
export const THEORY_BODY_ROW_PITCH = 0.52;

/**
 * 段落文を一行の最大文字数で区切る。
 *
 * 日本語文に分かち書きの区切りはないため、文字数で等分する。
 * サロゲートペアを割らないよう符号点単位で数える。
 *
 * @param text - 区切る段落文。
 * @param maxChars - 一行の最大文字数。正の整数。
 * @returns 先頭からの順序を保った行の配列。空文の場合は空配列。
 * @throws `RangeError` — 最大文字数が正の整数でない場合。
 */
export function splitTheoryLines(text: string, maxChars: number = THEORY_LINE_MAX_CHARS): string[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError(`一行の最大文字数は正の整数であること: ${String(maxChars)}`);
  }
  const chars = Array.from(text);
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(''));
  }
  return lines;
}

/**
 * 理論説明の文章をパネル指定の配列に並べる。
 *
 * 先頭に見出しを一行で置き、本文は段落の順序を保ったまま2行までの
 * 複数枚に分け、左右二列・上段から並べる。枚数が奇数の場合の最後の
 * 一枚だけは中央に置く。すべての面は格子の奥側に置く。
 *
 * @param intro - 理論説明の文章。
 * @returns 見出しを先頭にした描画指定の配列。
 */
export function theoryPanelPlates(intro: PitchGridIntro): TheoryPanelSpec[] {
  const specs: TheoryPanelSpec[] = [
    {
      lines: [intro.title],
      size: THEORY_TITLE_SIZE,
      position: [THEORY_CENTER_X, THEORY_TITLE_Y, THEORY_BEHIND_Z],
    },
  ];
  const bodies: Array<readonly [string] | readonly [string, string]> = [];
  for (const paragraph of intro.paragraphs) {
    const lines = splitTheoryLines(paragraph);
    for (let index = 0; index < lines.length; index += 2) {
      const pair = lines.slice(index, index + 2);
      if (pair.length === 1) {
        bodies.push([pair[0]]);
      } else if (pair.length === 2) {
        bodies.push([pair[0], pair[1]]);
      }
    }
  }
  bodies.forEach((lines, index) => {
    const row = Math.floor(index / 2);
    const isLastSingle = bodies.length % 2 === 1 && index === bodies.length - 1;
    const x = isLastSingle ? THEORY_CENTER_X : THEORY_BODY_COLUMNS[index % 2];
    specs.push({
      lines,
      size: THEORY_BODY_SIZE,
      position: [x, THEORY_BODY_TOP_Y - row * THEORY_BODY_ROW_PITCH, THEORY_BEHIND_Z],
    });
  });
  return specs;
}
