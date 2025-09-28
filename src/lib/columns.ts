// 表示ラベルと、列の推奨並び順（あれば優先）をまとめて管理
export const COL_LABELS: Record<string, string> = {
  catchphrase:  "キャッチコピー",
  first_order:  "1本目出順",
  first_result:  "1本目結果",
  second_order: "2本目出順",
  second_result: "2本目結果",
};

export const PREFERRED_ORDER = [
  "catchphrase",
  "first_order", "first_result",
  "second_order", "second_result",
];

// extraKeys を並び替える（未定義キーは末尾で名前順）
export function orderColumns(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
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
