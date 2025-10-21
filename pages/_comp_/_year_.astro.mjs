import { c as createComponent, d as createAstro, r as renderComponent, F as Fragment, a as renderTemplate, b as addAttribute, m as maybeRenderHead } from '../../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { b as getEditionTable, c as getJudgeScoreTable, d as listEditionYears, $ as $$Base, e as listEditionParams } from '../../chunks/Base_PG1JNf83.mjs';
import { o as orderColumns, l as labelFor, c as colClassFor, n as normalizeCellValue, M as MULTILINE_KEYS, i as isTitleKey, r as relatedMovieKeyForTitle } from '../../chunks/columns_BmbIDCq9.mjs';
export { renderers } from '../../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Astro$1 = createAstro();
const $$JudgeScoresTable = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$1, $$props, $$slots);
  Astro2.self = $$JudgeScoresTable;
  const { base, title, table, scale } = Astro2.props;
  const ok = !!table && table.seats.length > 0 && table.rows.length > 0;
  function buildLocalScale() {
    const bySeat = {};
    let globalHalf = 0;
    for (const s of table.seats) {
      let min = Infinity, max = -Infinity;
      for (const r of table.rows) {
        const v = r.bySeat[s.seat_no];
        if (typeof v === "number" && !Number.isNaN(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (min === Infinity) {
        min = 0;
        max = 0;
      }
      const mid = (min + max) / 2;
      const half = Math.max(0, (max - min) / 2);
      bySeat[s.seat_no] = { mid, half };
      if (half > globalHalf) globalHalf = half;
    }
    if (globalHalf === 0) globalHalf = 1;
    let tmin = Infinity, tmax = -Infinity;
    for (const r of table.rows) {
      const v = r.total;
      if (typeof v === "number" && !Number.isNaN(v)) {
        if (v < tmin) tmin = v;
        if (v > tmax) tmax = v;
      }
    }
    const tmid = tmin === Infinity ? 0 : (tmin + tmax) / 2;
    const thalf = tmin === Infinity ? 1 : Math.max(1e-9, (tmax - tmin) / 2);
    return { bySeat, globalHalf, total: { mid: tmid, half: thalf } };
  }
  const S = scale ?? (ok ? buildLocalScale() : { bySeat: {}, globalHalf: 1 });
  function mixTo(color, p) {
    const white = [255, 255, 255];
    const q = Math.max(0, Math.min(1, p));
    const r = Math.round(white[0] + (color[0] - white[0]) * q);
    const g = Math.round(white[1] + (color[1] - white[1]) * q);
    const b = Math.round(white[2] + (color[2] - white[2]) * q);
    return `rgb(${r}, ${g}, ${b})`;
  }
  function colorFor(score, seat_no) {
    if (score == null || typeof score !== "number" || Number.isNaN(score)) return null;
    const st = S.bySeat[seat_no];
    if (!st || st.half === 0 || S.globalHalf === 0) return null;
    const delta = score - st.mid;
    let t = delta / S.globalHalf;
    t = Math.max(-1, Math.min(1, t));
    const intensity = Math.abs(t);
    const RED = [252, 165, 165];
    const BLUE = [147, 197, 253];
    const gain = 0.75;
    const p = intensity * gain;
    return t >= 0 ? mixTo(RED, p) : mixTo(BLUE, p);
  }
  function colorForTotal(score) {
    if (!S.total) return null;
    if (score == null || typeof score !== "number" || Number.isNaN(score)) return null;
    const { mid, half } = S.total;
    if (half <= 0) return null;
    const delta = score - mid;
    let t = delta / half;
    t = Math.max(-1, Math.min(1, t));
    const intensity = Math.abs(t);
    const RED = [252, 165, 165];
    const BLUE = [147, 197, 253];
    const gain = 0.75;
    const p = intensity * gain;
    return t >= 0 ? mixTo(RED, p) : mixTo(BLUE, p);
  }
  const uid = Math.random().toString(36).slice(2);
  return renderTemplate`${ok && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result2) => renderTemplate(_a || (_a = __template(["", "<h2>", '</h2><div class="table-wrap tight"', ' data-judge-scores><table class="judge-scores"><thead><tr><th class="col-name" data-sortable="text" data-key="name">\u82B8\u4EBA</th><th class="col-order" data-sortable="number" data-key="order_no">\u51FA\u9806</th><th class="col-total" data-sortable="number" data-key="total">\u5408\u8A08</th>', "</tr></thead><tbody>", "</tbody></table></div><script>\n			(() => {\n				// \u30DA\u30FC\u30B8\u5185\u306E\u5168 judge-scores \u30C6\u30FC\u30D6\u30EB\u3092\u5BFE\u8C61\u306B\u521D\u671F\u5316\uFF081\u672C\u76EE/2\u672C\u76EE\u3068\u3082OK\uFF09\n				const tables = document.querySelectorAll('[data-judge-scores] table.judge-scores');\n				tables.forEach((table) => {\n					const thead = table.tHead;\n					const tbody = table.tBodies && table.tBodies[0];\n					if (!thead || !tbody) return;\n\n					const headers = Array.from(thead.querySelectorAll('th[data-sortable]'));\n					let activeKey = null; // \u73FE\u5728\u30BD\u30FC\u30C8\u4E2D\u30AD\u30FC\n					let direction = -1; // -1=\u964D\u9806, 1=\u6607\u9806\uFF08\u5217\u3054\u3068\u306B\u521D\u671F\u5024\u3092\u51FA\u3057\u5206\u3051\uFF09\n\n					function setAria(th, state){\n						headers.forEach(h => h.removeAttribute('aria-sort'));\n						th.setAttribute('aria-sort', state === 1 ? 'ascending' : 'descending');\n					}\n\n					// \u3053\u3053\u3067\u201C\u5217\u3054\u3068\u306E\u521D\u56DE\u65B9\u5411\u201D\u3092\u6C7A\u5B9A\n					function initialDirectionFor(th){\n						const key = th.getAttribute('data-key') || '';\n						if (key === 'name' || key === 'order_no') return 1; // \u82B8\u4EBA\u30FB\u51FA\u9806\u306F\u6607\u9806\u30B9\u30BF\u30FC\u30C8\n						return -1; // \u305D\u308C\u4EE5\u5916\u306F\u964D\u9806\u30B9\u30BF\u30FC\u30C8\uFF08\u70B9\u6570\u30FB\u5408\u8A08\u306A\u3069\uFF09\n					}\n\n					function compareRow(a, b, th) {\n						const type = th.getAttribute('data-sortable');\n						const idx  = headers.indexOf(th); // \u30D8\u30C3\u30C0\u30FC\u9806\uFF1D\u30BB\u30EB\u9806\n						const ca   = a.children[idx];\n						const cb   = b.children[idx];\n\n						if (type === 'number') {\n							const va = Number(ca.getAttribute('data-value-num') || '');\n							const vb = Number(cb.getAttribute('data-value-num') || '');\n							const aEmpty = Number.isNaN(va), bEmpty = Number.isNaN(vb);\n							if (aEmpty && bEmpty) return 0;\n							if (aEmpty) return 1;   // \u7A7A\u306F\u6700\u5F8C\n							if (bEmpty) return -1;\n							return va - vb;         // \u57FA\u672C\u306F\u6607\u9806\uFF08\u964D\u9806\u306F\u5F8C\u3067\u53CD\u8EE2\uFF09\n						} else {\n							const sa = (ca.getAttribute('data-value-text') || '').toString();\n							const sb = (cb.getAttribute('data-value-text') || '').toString();\n							if (!sa && !sb) return 0;\n							if (!sa) return 1;\n							if (!sb) return -1;\n							return sa.localeCompare(sb, 'ja', { numeric: true, sensitivity: 'base' });\n						}\n					}\n\n					headers.forEach((th) => {\n						th.style.cursor = 'pointer';\n						th.addEventListener('click', () => {\n							const key = th.getAttribute('data-key');\n\n							if (activeKey !== key) {\n								activeKey = key;\n								direction = initialDirectionFor(th);       // \u2190 \u5207\u66FF\u6642\u306B\u5217\u3054\u3068\u306E\u521D\u671F\u65B9\u5411\u3092\u63A1\u7528\n							} else {\n								direction = (direction === -1) ? 1 : -1;   // 2\u6BB5\u968E\u30C8\u30B0\u30EB\uFF08\u964D\u2194\u6607\uFF09\n							}\n\n							setAria(th, direction);\n\n							const rows = Array.from(tbody.rows);\n							rows.sort((a,b) => compareRow(a,b,th));      // \u307E\u305A\u6607\u9806\n							if (direction === -1) rows.reverse();        // \u964D\u9806\u306A\u3089\u53CD\u8EE2\n							rows.forEach(r => tbody.appendChild(r));\n						});\n					});\n				});\n			})();\n		<\/script>"])), maybeRenderHead(), title, addAttribute(`judge-scores-${uid}`, "id"), table.seats.map(
    (s) => renderTemplate`<th class="col-score" data-sortable="number"${addAttribute(`seat-${s.seat_no}`, "data-key")}>${s.name}</th>`
  ), table.rows.map((r, i) => renderTemplate`<tr><td class="col-name"${addAttribute(r.comedian_reading ?? r.comedian_name, "data-value-text")}><a${addAttribute(`${base}co/${r.comedian_id}`, "href")}${addAttribute(r.comedian_name, "title")}><span class="truncate">${r.comedian_name}</span></a></td><td class="col-order"${addAttribute(r.order_no ?? "", "data-value-num")}>${r.order_no ?? ""}</td><td class="col-total heat"${addAttribute(r.total ?? "", "data-value-num")}${addAttribute(r.total != null ? `background:${colorForTotal(r.total)}` : void 0, "style")}>${r.total ?? ""}</td>${table.seats.map((s) => {
    const v = r.bySeat[s.seat_no] ?? null;
    const bg = colorFor(v, s.seat_no);
    return renderTemplate`<td class="col-score heat"${addAttribute(v ?? "", "data-value-num")}${addAttribute(bg ? `background:${bg}` : void 0, "style")}>${v ?? ""}</td>`;
  })}</tr>`)) })}`}`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/components/JudgeScoresTable.astro", void 0);

const $$Astro = createAstro();
async function getStaticPaths() {
  const params = listEditionParams().filter((p) => p.year != null).map((p) => ({ params: { comp: p.comp, year: String(p.year) } }));
  return params;
}
const $$year = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$year;
  const base = "/owarai-data/";
  const { comp, year } = Astro2.params;
  const y = Number(year);
  const data = getEditionTable(comp, y);
  if (!data) throw new Error("該当データなし");
  const { edition, rows, extraKeys } = data;
  const pageTitle = edition.title ?? `${edition.competition_name} ${edition.year} 決勝結果`;
  function formatJpDate(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return s;
    const y2 = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y2, mo - 1, d));
    const youbi = ["日", "月", "火", "水", "木", "金", "土"][dt.getUTCDay()];
    return `${y2}年${mo}月${d}日(${youbi})`;
  }
  formatJpDate(edition.final_date);
  const cols = orderColumns(extraKeys);
  const round1 = getJudgeScoreTable(comp, y, 1);
  const round2 = getJudgeScoreTable(comp, y, 2);
  function buildSharedScale(r1, r2) {
    const bySeat = {};
    let globalHalf = 0;
    const seatNos = /* @__PURE__ */ new Set();
    for (const s of r1?.seats ?? []) seatNos.add(s.seat_no);
    for (const s of r2?.seats ?? []) seatNos.add(s.seat_no);
    for (const seat of seatNos) {
      let min = Infinity, max = -Infinity;
      for (const tbl of [r1, r2]) {
        if (!tbl) continue;
        for (const row of tbl.rows) {
          const v = row.bySeat[seat];
          if (typeof v === "number" && !Number.isNaN(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
      if (min === Infinity) {
        min = 0;
        max = 0;
      }
      const mid = (min + max) / 2;
      const half = Math.max(0, (max - min) / 2);
      bySeat[seat] = { mid, half };
      if (half > globalHalf) globalHalf = half;
    }
    if (globalHalf === 0) globalHalf = 1;
    let tmin = Infinity, tmax = -Infinity;
    for (const tbl of [r1, r2]) {
      if (!tbl) continue;
      for (const row of tbl.rows) {
        const v = row.total;
        if (typeof v === "number" && !Number.isNaN(v)) {
          if (v < tmin) tmin = v;
          if (v > tmax) tmax = v;
        }
      }
    }
    const total = tmin === Infinity ? { mid: 0, half: 1 } : { mid: (tmin + tmax) / 2, half: Math.max(1e-9, (tmax - tmin) / 2) };
    return { bySeat, globalHalf, total };
  }
  const sharedScale = buildSharedScale(round1, round2);
  const years = listEditionYears(comp);
  const i = years.indexOf(y);
  const prevYear = i > 0 ? years[i - 1] : null;
  const nextYear = i >= 0 && i < years.length - 1 ? years[i + 1] : null;
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": `${pageTitle} 決勝結果` }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<nav class="breadcrumbs"> <a${addAttribute(base, "href")}>トップ</a><span class="sep">/</span> <a${addAttribute(`${base}${comp}`, "href")}>${edition.competition_name}</a><span class="sep">/</span> <span>${edition.year}年</span> </nav> <div class="sticky-h1"> <div class="h1-row"> <h1>${pageTitle} 決勝結果</h1> ${(prevYear != null || nextYear != null) && renderTemplate`<nav class="year-pager"> ${prevYear != null && renderTemplate`<a class="btn"${addAttribute(`${base}${comp}/${prevYear}`, "href")}${addAttribute(`${prevYear}年へ`, "aria-label")}>← ${prevYear}</a>`} ${nextYear != null && renderTemplate`<a class="btn"${addAttribute(`${base}${comp}/${nextYear}`, "href")}${addAttribute(`${nextYear}年へ`, "aria-label")}>${nextYear} →</a>`} </nav>`} </div> </div>  <div class="table-wrap"> <table> <thead> <tr> <th class="sticky-1 col-name">芸人</th> <th class="sticky-2 col-rank">順位</th> ${cols.map((k) => renderTemplate`<th${addAttribute(colClassFor(k), "class")}>${labelFor(k)}</th>`)} </tr> </thead> <tbody> ${rows.map((r) => renderTemplate`<tr> <td class="sticky-1 col-name"><a${addAttribute(`${base}co/${r.comedian_id}`, "href")}>${r.name}</a></td> <td class="sticky-2 col-rank"> <span class="badge"${addAttribute(r.rank_sort, "data-ranksort")}>${r.rank}</span> </td> ${cols.map((k) => {
    const text = normalizeCellValue(k, r[k]);
    const cls = [colClassFor(k), MULTILINE_KEYS.has(k) ? "multiline" : ""].filter(Boolean).join(" ");
    if (isTitleKey(k)) {
      const movieKey = relatedMovieKeyForTitle(k);
      const url = movieKey ? normalizeCellValue(movieKey, r[movieKey]) : "";
      const isYouTube = !!url && /(?:^https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
      return renderTemplate`<td${addAttribute(cls, "class")}> ${text} ${url && " "} ${url && renderTemplate`<a${addAttribute(`video-link ${isYouTube ? "video-youtube" : ""}`, "class")}${addAttribute(url, "href")} target="_blank" rel="noopener noreferrer"${addAttribute(isYouTube ? "YouTubeで見る" : "動画を見る", "aria-label")}> <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"> <path fill="currentColor" d="M23.5 6.2a4 4 0 0 0-2.8-2.8C18.5 3 12 3 12 3S5.5 3 3.3 3.4A4 4 0 0 0 .5 6.2 41 41 0 0 0 0 12c0 2 .2 3.8.5 5.8a4 4 0 0 0 2.8 2.8C5.5 21 12 21 12 21s6.5 0 8.7-.4a4 4 0 0 0 2.8-2.8c.3-2 .5-3.8.5-5.8s-.2-3.8-.5-5.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z"></path> </svg> </a>`} </td>`;
    }
    return renderTemplate`<td${addAttribute(cls, "class")}>${text}</td>`;
  })} </tr>`)} </tbody> </table> </div> ${renderComponent($$result2, "JudgeScoresTable", $$JudgeScoresTable, { "base": base, "title": "1本目 審査員別得点", "table": round1, "scale": sharedScale })} ${renderComponent($$result2, "JudgeScoresTable", $$JudgeScoresTable, { "base": base, "title": "2本目 審査員別得点", "table": round2, "scale": sharedScale })} <p class="muted"><a${addAttribute(`${base}${comp}`, "href")}>← ${edition.competition_name} 年別一覧</a> / <a${addAttribute(base, "href")}>トップ</a></p> ` })} <style>
  /* [comp]/[year] 用：h1 をヘッダーの下に固定 */
  .sticky-h1{
    position: sticky;
    top: calc(var(--header-h) + var(--header-gap)); /* 固定ヘッダー分ずらす */
    z-index: 10;          /* テーブル見出し(th: z-index:1)より上に */
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 16px 0;
    /* iOS Safari 対策（ほぼ不要だが保険） */
    position: -webkit-sticky;
  }

  /* もし h1 が大きすぎて詰まるなら微調整可 */
  .sticky-h1 h1{
    margin: 0;            /* 余白で跳ねないように */
    line-height: 1.3;
  }

  .h1-row{ display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
  .h1-sub{ margin:0; font-size:14px; }
</style>`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/[comp]/[year].astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/[comp]/[year].astro";
const $$url = "/owarai-data/[comp]/[year]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$year,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
