// 表示ラベルと、列の推奨並び順（あれば優先）をまとめて管理
export const COL_LABELS: Record<string, string> = {
  catchphrase:  "キャッチコピー",
  first_order:  "1本目出順",
  first_result:  "1本目結果",
  first_title:  "1本目ネタ",
  second_order: "2本目出順",
  second_result: "2本目結果",
  second_title:  "2本目ネタ",
};

export const PREFERRED_ORDER = [
  "catchphrase",
  "first_order", "first_result", "first_title",
  "second_order", "second_result", "second_title",
];

// extraKeys を並び替える（未定義キーは末尾で名前順）
export function orderColumns(keys: string[]): string[] {
  // 1) _movie 列はテーブルから排除（_titleに内包するため）
  const onlyVisible = keys.filter(k => !k.endsWith('_movie'));
  // 2) 優先順 → それ以外は名前順
  return [...onlyVisible].sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a);
    const bi = PREFERRED_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function labelFor(key: string): string {
  return COL_LABELS[key] ?? key;
}

export const MULTILINE_KEYS = new Set(["catchphrase"]); // 改行を効かせたい列名

export function normalizeCellValue(key: string, value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  // CSV中の「\n」を実際の改行に
  s = s.replace(/\\n/g, "\n");
  return s;
}

export function isMovieKey(key: string): boolean {
  return key.endsWith('_movie');
}

export function colClassFor(key: string): string {
  if (isMovieKey(key)) return 'col-movie';
  if (/_order$/.test(key))  return 'col-order';
  if (/_result$/.test(key)) return 'col-result';
  if (/_title$/.test(key))   return 'col-title';
  if (key === 'catchphrase') return 'col-catch';
  return '';
}

// `_title` → 対応する `_movie` キーを返すヘルパ
export function relatedMovieKeyForTitle(key: string): string | null {
  if (key === "first_title")  return "first_movie";
  if (key === "second_title") return "second_movie";
  return null;
}

export function isTitleKey(key: string): boolean {
  return key.endsWith("_title");
}
