import { c as createComponent, d as createAstro, a as renderTemplate, e as renderSlot, b as addAttribute, f as renderHead, r as renderComponent, F as Fragment, u as unescapeHTML } from './astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import Database from 'better-sqlite3';

const globalCss = ":root{--header-h: 56px;--header-gap: 12px;--container: 960px;--radius: 12px;--bg:#ffffff;--text:#111111;--muted:#64748b;--border:#e6e6e6;--brand:#111111;--brand-contrast:#ffffff;--accent:#f97316;--accent-strong:#ea580c;--accent-weak:#fff3e6;--gold-1:#fff3b0;--gold-2:#f7c84b;--gold-border:#e6b23e;--silver-1:#f3f4f6;--silver-2:#d1d5db;--silver-border:#c6cbd1;--bronze-1:#f2c1a3;--bronze-2:#d99572;--bronze-border:#b77a5e;--stage-sf:#6b21a8;--stage-qf:#1e40af;--stage-r3:#166534;--stage-r2:#64748b;--stage-r1:#475569}*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Hiragino Kaku Gothic ProN,Noto Sans JP,Yu Gothic UI,Meiryo,sans-serif;font-size:16px;line-height:1.65;padding-top:calc(var(--header-h) + var(--header-gap))}:root{color-scheme:light}a{color:var(--accent);text-decoration:none}a:hover{color:var(--accent-strong);text-decoration:underline}::selection{background:var(--accent);color:#fff}a:focus,button:focus,[tabindex]:focus{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}h1{font-size:24px;margin:0 0 12px}h2{font-size:20px;margin:28px 0 8px}p{margin:8px 0}.muted{color:var(--muted)}.container{max-width:var(--container);margin-inline:auto;padding:16px}.content{padding-block:24px}.site-header{position:fixed;inset:0 0 auto;z-index:1000;backdrop-filter:saturate(180%) blur(6px);background:var(--brand);border-bottom:1px solid var(--border)}.header-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:var(--header-h)}.brand{font-weight:700;font-size:18px;color:var(--brand-contrast)}.nav{display:flex;gap:8px}.nav a{color:var(--brand-contrast);padding:8px 10px;border-radius:8px;opacity:.9}.nav a:hover{background:color-mix(in srgb,var(--accent) 20%,transparent);text-decoration:none;opacity:1}.site-footer{border-top:1px solid var(--border);padding:24px 0;margin-top:48px}.skip{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}.skip:focus{position:static;width:auto;height:auto;padding:8px;background:#fff;border:1px solid var(--border)}.breadcrumbs{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:12px}.breadcrumbs a{color:inherit}.breadcrumbs .sep{color:var(--muted)}.card{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:16px}.table-wrap{overflow:auto;background:#fff;border:1px solid var(--border);border-radius:var(--radius)}table{width:100%;min-width:560px;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:middle}thead th{position:sticky;top:0;background:var(--brand);color:var(--brand-contrast);z-index:1;white-space:nowrap}th.spacer,td.spacer{width:100%;padding:0;border-bottom:none}tbody tr:hover{background:#fff8f1}.table-wrap :is(th.sticky-1,td.sticky-1){position:sticky;left:0;z-index:2;width:60px}.table-wrap td.sticky-1{background:#fff}.table-wrap tbody tr:hover>td.sticky-1{background:#fff8f1}.col-year{width:60px;max-width:60px}.col-rank{min-width:60px;white-space:nowrap;padding-right:6px}.col-name{min-width:160px}.col-catch{min-width:200px}.col-order,.col-result{min-width:60px}.col-title{min-width:160px}.col-score{min-width:56px;text-align:right;font-variant-numeric:tabular-nums}.col-total{min-width:64px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.multiline{white-space:pre-line}.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:1rem;line-height:1.5;background:#fff;border:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums}.badge[data-ranksort=\"1\"]{background:linear-gradient(135deg,var(--gold-1),var(--gold-2));color:#111;border-color:var(--gold-border)}.badge[data-ranksort=\"2\"]{background:linear-gradient(135deg,var(--silver-1),var(--silver-2));color:#111;border-color:var(--silver-border)}.badge[data-ranksort=\"3\"]{background:linear-gradient(135deg,var(--bronze-1),var(--bronze-2));color:#111;border-color:var(--bronze-border)}.badge[data-ranksort=\"4\"]{background:color-mix(in srgb,var(--accent) 40%,#fff);border-color:color-mix(in srgb,var(--accent) 60%,#fff);color:#111}.badge[data-ranksort=\"5\"]{background:color-mix(in srgb,var(--accent) 38%,#fff);border-color:color-mix(in srgb,var(--accent) 58%,#fff);color:#111}.badge[data-ranksort=\"6\"]{background:color-mix(in srgb,var(--accent) 36%,#fff);border-color:color-mix(in srgb,var(--accent) 56%,#fff);color:#111}.badge[data-ranksort=\"7\"]{background:color-mix(in srgb,var(--accent) 34%,#fff);border-color:color-mix(in srgb,var(--accent) 54%,#fff);color:#111}.badge[data-ranksort=\"8\"]{background:color-mix(in srgb,var(--accent) 32%,#fff);border-color:color-mix(in srgb,var(--accent) 52%,#fff);color:#111}.badge[data-ranksort=\"9\"]{background:color-mix(in srgb,var(--accent) 30%,#fff);border-color:color-mix(in srgb,var(--accent) 50%,#fff);color:#111}.badge[data-ranksort=\"10\"]{background:color-mix(in srgb,var(--accent) 28%,#fff);border-color:color-mix(in srgb,var(--accent) 48%,#fff);color:#111}.badge[data-ranksort=\"11\"]{background:color-mix(in srgb,var(--accent) 26%,#fff);border-color:color-mix(in srgb,var(--accent) 46%,#fff);color:#111}.badge[data-ranksort=\"12\"]{background:color-mix(in srgb,var(--accent) 24%,#fff);border-color:color-mix(in srgb,var(--accent) 44%,#fff);color:#111}.badge[data-ranksort=\"50\"]{background:color-mix(in srgb,var(--stage-sf) 10%,#fff);border-color:color-mix(in srgb,var(--stage-sf) 28%,#fff);color:#111}.badge[data-ranksort=\"100\"]{background:color-mix(in srgb,var(--stage-qf) 9%,#fff);border-color:color-mix(in srgb,var(--stage-qf) 26%,#fff);color:#111}.badge[data-ranksort=\"500\"]{background:color-mix(in srgb,var(--stage-r3) 8%,#fff);border-color:color-mix(in srgb,var(--stage-r3) 24%,#fff);color:#111}.badge[data-ranksort=\"1000\"]{background:color-mix(in srgb,var(--stage-r2) 7%,#fff);border-color:color-mix(in srgb,var(--stage-r2) 22%,#fff);color:#111}.badge[data-ranksort=\"5000\"]{background:color-mix(in srgb,var(--stage-r1) 6%,#fff);border-color:color-mix(in srgb,var(--stage-r1) 20%,#fff);color:#111}.badge[data-ranksort=\"99999\"]{color:var(--muted);background:#fff;border-color:var(--border)}a.video-link{display:inline-block;vertical-align:-.12em;line-height:1;margin-left:.25em;border-radius:6px;text-decoration:none}a.video-link:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}a.video-link svg{width:1.05em;height:1.05em;display:block}a.video-link.video-youtube{color:#f03}.kv{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.nav details.menu{position:relative}.nav details.menu>summary{list-style:none;cursor:pointer;color:var(--brand-contrast);padding:8px 22px 8px 10px;border-radius:8px;opacity:.9;position:relative}.nav details.menu>summary::-webkit-details-marker{display:none}.nav details[open]>summary{background:color-mix(in srgb,var(--accent) 20%,transparent);opacity:1}.nav details.menu>summary:after{content:\"\";position:absolute;right:8px;top:50%;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid currentColor;transform:translateY(-35%);opacity:.85;transition:transform .15s ease}.nav details[open]>summary:after{transform:translateY(-35%) rotate(180deg)}.nav .menu-list{position:absolute;left:0;top:calc(100% + 6px);z-index:1001;min-width:180px;margin:0;padding:6px;background:#fff;color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px #0000001f}.nav .menu-list li{list-style:none}.nav .menu-list a{display:block;padding:8px 10px;border-radius:8px;color:inherit;text-decoration:none}.nav .menu-list a:hover{background:color-mix(in srgb,var(--accent) 12%,#fff)}@media (max-width: 640px){.nav .menu-list{min-width:160px}}.table-wrap.tight{display:inline-block;max-width:100%;overflow:auto;margin-inline:0;background:#fff;border:1px solid var(--border);border-radius:var(--radius)}.table-wrap.tight table{width:auto;min-width:0}table.judge-scores{width:100%;min-width:auto}table.judge-scores th{line-height:1.25;white-space:normal}table.judge-scores th.col-score,table.judge-scores td.col-score{text-align:right;padding-inline:8px}table.judge-scores th.col-score{inline-size:3.6em;overflow-wrap:anywhere;word-break:break-word}table.judge-scores th.col-total,table.judge-scores td.col-total{text-align:right;padding-inline:8px}table.judge-scores th.col-total{inline-size:4.2em}table.judge-scores .col-order{min-width:48px;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;padding-inline:8px}table.judge-scores .col-name a{display:inline-flex;align-items:center;line-height:1.5}table.judge-scores .col-name .truncate{display:inline-block;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media (max-width: 640px){table{min-width:0}thead th{white-space:normal}.col-name{min-width:120px}.col-catch{min-width:140px}.col-title{min-width:120px}table.judge-scores .col-score,table.judge-scores .col-total{min-width:44px;padding:6px;font-size:14px}table.judge-scores .col-order{min-width:40px;padding-inline:6px;font-size:14px}table.judge-scores th.col-score{inline-size:3.2em}table.judge-scores th.col-total{inline-size:3.8em}}table.judge-scores td.heat{transition:background-color .15s ease-in-out}@media (prefers-contrast: no-preference){table.judge-scores td.heat{text-shadow:0 1px 0 rgba(255,255,255,.25)}}table.judge-scores th[data-sortable]{user-select:none;cursor:pointer}.page-topbar{position:sticky;top:calc(var(--header-h) + var(--header-gap));z-index:10;background:var(--bg);border-bottom:1px solid var(--border);padding:6px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.page-topbar .breadcrumbs{margin:0}.page-topbar .topbar-title{display:none;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.page-topbar.show-title .topbar-title{display:inline-block}.year-pager{margin-left:auto;display:inline-flex;gap:8px}.year-pager .btn{display:inline-block;padding:6px 12px;background:#fff;color:inherit;text-decoration:none;border:1px solid var(--border);border-radius:999px;line-height:1.3}.year-pager .btn:hover{background:color-mix(in srgb,var(--accent) 8%,#fff);text-decoration:none}@media (min-width: 641px){.page-topbar{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;gap:8px 12px}.page-topbar .breadcrumbs{grid-column:1 / 2;grid-row:1 / 2}.page-topbar .topbar-title{grid-column:1 / 2;grid-row:2 / 3}.page-topbar .year-pager{grid-column:2 / 3;grid-row:1 / 3;justify-self:end;margin-left:0}}.h1-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.h1-row h1{margin:0;line-height:1.3;flex:1 1 auto;min-width:240px}@media (max-width: 520px){.h1-row{gap:8px}.h1-row h1{min-width:100%}}";

let _db = null;
const db = () => _db ??= new Database("data/awards.sqlite", { readonly: true });
function listCompetitions() {
  return db().prepare(`
    SELECT key, name, sort_order
    FROM competitions
    ORDER BY sort_order IS NULL, sort_order, key
  `).all();
}
function competitionMap() {
  const rows = listCompetitions();
  const map = {};
  for (const r of rows) map[r.key] = r.name;
  return map;
}
function competitionOrder() {
  return listCompetitions().map((c) => c.key);
}
function listEditionParams() {
  const rows = db().prepare(`
    select c.key as comp, e.year, e.short_label
    from editions e join competitions c on c.id=e.competition_id
    order by c.key, e.year
  `).all();
  return rows.map((r) => ({
    comp: r.comp,
    year: r.year,
    // NULL あり
    short_label: r.short_label
  }));
}
function finalResultExtraColumns() {
  const info = db().prepare(`pragma table_info('final_results')`).all();
  const base = /* @__PURE__ */ new Set(["id", "edition_id", "comedian_id", "rank", "rank_sort"]);
  return info.map((i) => i.name).filter((n) => !base.has(n));
}
function getEditionTable(comp, year) {
  const ed = db().prepare(
    `
    select
      e.id           as edition_id,
      e.year         as year,
      e.title        as title,
      e.final_date   as final_date,
      e.short_label  as short_label,
      c.name         as competition_name
    from editions e
    join competitions c on c.id=e.competition_id
    where c.key=? and e.year=?`
  ).get(comp, year);
  if (!ed) return null;
  const extras = finalResultExtraColumns();
  const selectExtras = extras.map((k) => `fr."${k}" as "${k}"`).join(", ");
  const sql = `
    select fr.rank, fr.rank_sort, co.id as comedian_id, co.name
      ${selectExtras ? "," + selectExtras : ""}
    from final_results fr
    join comedians co on co.id=fr.comedian_id
    where fr.edition_id=?
    order by CAST(fr.rank_sort AS INTEGER) asc, co.name asc
  `;
  const rows = db().prepare(sql).all(ed.edition_id);
  const used = extras.filter((k) => rows.some((r) => r[k] !== null && String(r[k] ?? "").trim() !== ""));
  return {
    edition: {
      year: ed.year,
      title: ed.title,
      final_date: ed.final_date,
      // "YYYY-MM-DD" 文字列 or null
      short_label: ed.short_label,
      competition_name: ed.competition_name
    },
    extraKeys: used,
    rows
  };
}
function getCompetitionYearTables(comp) {
  const years = db().prepare(`
    select e.year, e.short_label
    from editions e
    join competitions c on c.id=e.competition_id
    where c.key=?
    order by e.year desc
  `).all(comp);
  return years.map((y) => ({
    year: y.year,
    // null の可能性あり（表示側で扱う）
    short_label: y.short_label,
    table: y.year != null ? getEditionTable(comp, y.year) : null
  }));
}
function listTargetComedianIds() {
  const rows = db().prepare(`
    select distinct co.id
    from comedians co
    where exists (select 1 from final_results fr where fr.comedian_id=co.id)
    order by co.name
  `).all();
  return rows.map((r) => r.id);
}
function listComediansAll() {
  return db().prepare(`SELECT id, name, reading FROM comedians`).all();
}
function getComedianTables(comedianId) {
  const co = db().prepare(`select id, name, reading from comedians where id=?`).get(comedianId);
  if (!co) return null;
  const extras = finalResultExtraColumns();
  const selectExtras = extras.length ? ", " + extras.map((k) => `fr."${k}" as "${k}"`).join(", ") : "";
  const sql = `
    select
      e.year,
      e.short_label,
      c.key  as comp,
      c.name as competition_name,
      fr.rank,
      fr.rank_sort,
      co.name
      ${selectExtras}
    from final_results fr
    join editions e     on e.id = fr.edition_id
    join competitions c on c.id = e.competition_id
    join comedians  co  on co.id = fr.comedian_id
    where fr.comedian_id = ?
    order by
      (c.sort_order is null),  -- nullは後ろへ
      c.sort_order,            -- 昇順で並べる
      c.key,                   -- 同順番ならkeyで安定化
      e.year desc              -- 各大会内は年の降順
  `;
  const rows = db().prepare(sql).all(comedianId);
  const byComp = {};
  for (const r of rows) {
    const grp = byComp[r.comp] ??= { competition_name: r.competition_name, extraKeys: [], rows: [] };
    grp.rows.push(r);
  }
  for (const k of Object.keys(byComp)) {
    const used = extras.filter((col) => byComp[k].rows.some((r) => r[col] !== null && String(r[col] ?? "").trim() !== ""));
    byComp[k].extraKeys = used;
  }
  return { comedian: co, byComp };
}
function getJudgeScoreTable(comp, year, round_no) {
  const ed = db().prepare(`
    SELECT e.id AS eid
    FROM editions e JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year=? LIMIT 1
  `).get(comp, year);
  if (!ed) return null;
  const seats = db().prepare(`
    SELECT ej.seat_no, j.name
    FROM edition_judges ej
    JOIN judges j ON j.id=ej.judge_id
    WHERE ej.edition_id=?
    ORDER BY ej.seat_no
  `).all(ed.eid);
  const rows = db().prepare(`
    SELECT
      fr.comedian_id,
      co.name    AS comedian_name,
      co.reading AS comedian_reading,
      fr.rank_sort,
      -- ラウンドに応じて出順を拾う（整数化）
      CASE ?
        WHEN 1 THEN CAST(fr.first_order  AS INTEGER)
        WHEN 2 THEN CAST(fr.second_order AS INTEGER)
        ELSE NULL
      END AS order_no,
      js.seat_no,
      js.score
    FROM final_results fr
    JOIN comedians co ON co.id=fr.comedian_id
    LEFT JOIN judge_scores js
      ON js.edition_id=fr.edition_id
     AND js.round_no=?
     AND js.comedian_id=fr.comedian_id
    WHERE fr.edition_id=?
      AND EXISTS (
        SELECT 1 FROM judge_scores js2
        WHERE js2.edition_id = fr.edition_id
          AND js2.round_no   = ?
          AND js2.comedian_id= fr.comedian_id
      )
    -- 出順があればそれを最優先、無ければ rank_sort→名前
    ORDER BY (order_no IS NULL), order_no ASC,
             CAST(fr.rank_sort AS INTEGER) ASC, co.name ASC
  `).all(round_no, round_no, ed.eid, round_no);
  const byId = /* @__PURE__ */ new Map();
  for (const r of rows) {
    let row = byId.get(r.comedian_id);
    if (!row) {
      row = {
        comedian_id: r.comedian_id,
        comedian_name: r.comedian_name,
        comedian_reading: r.comedian_reading ?? null,
        rank_sort: r.rank_sort,
        order_no: r.order_no,
        bySeat: {},
        total: null
      };
      byId.set(r.comedian_id, row);
    }
    if (r.seat_no != null) row.bySeat[r.seat_no] = r.score;
  }
  const out = Array.from(byId.values());
  for (const row of out) {
    const vals = seats.map((s) => row.bySeat[s.seat_no]).filter((v) => typeof v === "number");
    row.total = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return { seats, rows: out };
}
function listEditionYears(comp) {
  const rows = db().prepare(`
    select e.year
    from editions e
    join competitions c on c.id=e.competition_id
    where c.key=? and e.year is not null
    order by e.year asc
  `).all(comp);
  return rows.map((r) => r.year);
}

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a, _b;
const $$Astro = createAstro();
const $$Base = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Base;
  const { title = "お笑い主要データまとめ", description = "M-1/KOC/R-1 決勝結果まとめ" } = Astro2.props;
  const siteTitle = "お笑い主要データまとめ";
  const base = "/owarai-data/";
  const comps = listCompetitions();
  const canonical = new URL(Astro2.url.pathname, Astro2.site).href;
  return renderTemplate(_b || (_b = __template(['<html lang="ja"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>', '</title><meta name="description"', '><link rel="icon" href="/favicon.ico"><link rel="canonical"', '><meta name="format-detection" content="telephone=no"><!-- 共有時のOGP（必要なら調整） --><meta property="og:title"', '><meta property="og:description"', '><meta property="og:type" content="website"><meta name="theme-color" content="#111111"><style is:global>', "</style>", "", '</head> <body> <!-- <a class="skip" href="#main">本文へスキップ</a> --> <header class="site-header"> <div class="container header-row"> <a class="brand"', ">", '</a> <nav class="nav"> <details class="menu"> <summary>大会</summary> <ul class="menu-list"> ', " </ul> </details> <a", `>芸人一覧</a> </nav> </div> </header> <script>
			// クリックで外側なら閉じる
			document.addEventListener('click', (ev) => {
				// 複数将来対応：開いてる details を全部閉じる
				document.querySelectorAll('details.menu[open]').forEach((el) => {
					if (!el.contains(ev.target)) el.open = false;
				});
			});

			// Esc でも閉じる（フォーカスがどこでもOK）
			document.addEventListener('keydown', (ev) => {
				if (ev.key === 'Escape') {
					document.querySelectorAll('details.menu[open]').forEach((el) => (el.open = false));
				}
			});
		</script> <main id="main" class="container content"> `, ' </main> <footer class="site-footer"> <div class="container"> <p class="muted">\n本サイトは非公式のデータ集です。<br>\nデータは公式発表等の一次情報を優先しつつ、公開された二次情報も参照して編成しています。収集には手作業も含まれるため、正確性・完全性は保証できません。鵜呑みにせず一次情報でのご確認を推奨します。誤りにお気づきの際は、ご指摘いただけると嬉しいです。\n</p> <p class="muted"> <a href="https://forms.gle/ewpxezQFHYeHDzmD9" target="_blank">お問い合わせフォーム</a><br>\n作成者: <a href="https://twitter.com/gmm_tea_ob" target="_blank">てあ</a> </p> </div> </footer> </body></html>'])), title, addAttribute(description, "content"), addAttribute(canonical, "href"), addAttribute(title, "content"), addAttribute(description, "content"), unescapeHTML(globalCss), renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result2) => renderTemplate(_a || (_a = __template([`<script async src="https://www.googletagmanager.com/gtag/js?id=G-9Y0DD8R00V"></script><script>
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());

					gtag('config', 'G-9Y0DD8R00V');
				</script>`]))) })}`, renderHead(), addAttribute(base, "href"), siteTitle, comps.map((c) => renderTemplate`<li><a${addAttribute(`${base}${c.key}`, "href")}>${c.name}</a></li>`), addAttribute(`${base}co`, "href"), renderSlot($$result, $$slots["default"]));
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/layouts/Base.astro", void 0);

export { $$Base as $, listComediansAll as a, getEditionTable as b, getJudgeScoreTable as c, listEditionYears as d, listEditionParams as e, getCompetitionYearTables as f, getComedianTables as g, competitionMap as h, competitionOrder as i, listTargetComedianIds as l };
