import { c as createComponent, d as createAstro, r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute } from '../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { f as getCompetitionYearTables, $ as $$Base, e as listEditionParams } from '../chunks/Base_PG1JNf83.mjs';
import { o as orderColumns, l as labelFor, c as colClassFor, n as normalizeCellValue, M as MULTILINE_KEYS, i as isTitleKey, r as relatedMovieKeyForTitle } from '../chunks/columns_BmbIDCq9.mjs';
export { renderers } from '../renderers.mjs';

const $$Astro = createAstro();
async function getStaticPaths() {
  const params = listEditionParams();
  const comps = Array.from(new Set(params.map((p) => p.comp)));
  return comps.map((comp) => ({ params: { comp } }));
}
const $$Index = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Index;
  const base = "/owarai-data/";
  const { comp } = Astro2.params;
  const list = getCompetitionYearTables(comp);
  if (!list.length) throw new Error("該当データなし");
  const compName = list.find((x) => x.table)?.table?.edition.competition_name ?? "大会";
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": `${compName} 年別結果` }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<nav class="breadcrumbs"> <a${addAttribute(base, "href")}>トップ</a><span class="sep">/</span> <span>${compName}</span> </nav> <h1>${compName} 年別結果</h1> ${list.map(({ year, short_label, table }) => {
    const label = short_label ?? (year != null ? `${year}` : "（回次未設定）");
    const cols = table ? orderColumns(table.extraKeys) : [];
    return renderTemplate`<section> <h2 class="kv"> ${label} ${table ? renderTemplate`<a class="muted"${addAttribute(`${base}${comp}/${table.edition.year}`, "href")}>（単独ページ）</a>` : null} </h2> ${table ? renderTemplate`<div class="table-wrap"> <table> <thead> <tr> <th class="sticky-1 col-name">芸人</th> <th class="sticky-2 col-rank">順位</th> ${cols.map((k) => renderTemplate`<th${addAttribute(colClassFor(k), "class")}>${labelFor(k)}</th>`)} </tr> </thead> <tbody> ${table.rows.map((r) => renderTemplate`<tr> <td class="sticky-1 col-name"><a${addAttribute(`${base}co/${r.comedian_id}`, "href")}>${r.name}</a></td> <td class="sticky-2 col-rank"><span class="badge"${addAttribute(r.rank_sort, "data-ranksort")}>${r.rank}</span></td> ${cols.map((k) => {
      const text = normalizeCellValue(k, r[k]);
      const cls = [colClassFor(k), MULTILINE_KEYS.has(k) ? "multiline" : ""].filter(Boolean).join(" ");
      if (isTitleKey(k)) {
        const movieKey = relatedMovieKeyForTitle(k);
        const url = movieKey ? normalizeCellValue(movieKey, r[movieKey]) : "";
        const isYouTube = !!url && /(?:^https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
        return renderTemplate`<td${addAttribute(cls, "class")}> ${text} ${url && " "} ${url && renderTemplate`<a${addAttribute(`video-link ${isYouTube ? "video-youtube" : ""}`, "class")}${addAttribute(url, "href")} target="_blank" rel="noopener noreferrer"${addAttribute(isYouTube ? "YouTubeで見る" : "動画を見る", "aria-label")}> <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"> <path fill="currentColor" d="M23.5 6.2a4 4 0 0 0-2.8-2.8C18.5 3 12 3 12 3S5.5 3 3.3 3.4A4 4 0 0 0 .5 6.2 41 41 0 0 0 0 12c0 2 .2 3.8.5 5.8a4 4 0 0 0 2.8 2.8C5.5 21 12 21 12 21s6.5 0 8.7-.4a4 4 0 0 0 2.8-2.8c.3-2 .5-3.8.5-5.8s-.2-3.8-.5-5.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z"></path> </svg> </a>`} </td>`;
      }
      return renderTemplate`<td${addAttribute(cls, "class")}>${text}</td>`;
    })} </tr>`)} </tbody> </table> </div>` : renderTemplate`<p class="muted">この回はページ未対応（year 未設定）。</p>`} </section>`;
  })}` })}`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/[comp]/index.astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/[comp]/index.astro";
const $$url = "/owarai-data/[comp]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
