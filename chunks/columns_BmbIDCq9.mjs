const COL_LABELS = {
  catchphrase: "キャッチコピー",
  first_order: "1本目出順",
  first_result: "1本目結果",
  first_title: "1本目ネタ",
  second_order: "2本目出順",
  second_result: "2本目結果",
  second_title: "2本目ネタ"
};
const PREFERRED_ORDER = [
  "catchphrase",
  "first_order",
  "first_result",
  "first_title",
  "second_order",
  "second_result",
  "second_title"
];
function orderColumns(keys) {
  const onlyVisible = keys.filter((k) => !k.endsWith("_movie"));
  return [...onlyVisible].sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a);
    const bi = PREFERRED_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}
function labelFor(key) {
  return COL_LABELS[key] ?? key;
}
const MULTILINE_KEYS = /* @__PURE__ */ new Set(["catchphrase"]);
function normalizeCellValue(key, value) {
  if (value == null) return "";
  let s = String(value);
  s = s.replace(/\\n/g, "\n");
  return s;
}
function isMovieKey(key) {
  return key.endsWith("_movie");
}
function colClassFor(key) {
  if (isMovieKey(key)) return "col-movie";
  if (/_order$/.test(key)) return "col-order";
  if (/_result$/.test(key)) return "col-result";
  if (/_title$/.test(key)) return "col-title";
  if (key === "catchphrase") return "col-catch";
  return "";
}
function relatedMovieKeyForTitle(key) {
  if (key === "first_title") return "first_movie";
  if (key === "second_title") return "second_movie";
  return null;
}
function isTitleKey(key) {
  return key.endsWith("_title");
}

export { MULTILINE_KEYS as M, colClassFor as c, isTitleKey as i, labelFor as l, normalizeCellValue as n, orderColumns as o, relatedMovieKeyForTitle as r };
