import { c as createComponent, d as createAstro, r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute } from '../../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { g as getComedianTables, $ as $$Base, l as listTargetComedianIds } from '../../chunks/Base_PG1JNf83.mjs';
import { o as orderColumns, l as labelFor, c as colClassFor, n as normalizeCellValue, M as MULTILINE_KEYS, i as isTitleKey, r as relatedMovieKeyForTitle } from '../../chunks/columns_BmbIDCq9.mjs';
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro();
async function getStaticPaths() {
  const ids = listTargetComedianIds();
  return ids.map((id) => ({ params: { id } }));
}
const $$id = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$id;
  const base = "/owarai-data/";
  const { id } = Astro2.params;
  const data = getComedianTables(id);
  if (!data) throw new Error("該当データなし");
  const { comedian, byComp } = data;
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": `${comedian.name} の戦績` }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<nav class="breadcrumbs"> <a${addAttribute(base, "href")}>トップ</a><span class="sep">/</span> <a${addAttribute(`${base}co`, "href")}>芸人一覧</a><span class="sep">/</span> <span>${comedian.name}</span> </nav> <h1>${comedian.name} の戦績</h1>  ${comedian.reading && renderTemplate`<p class="reading muted">${comedian.reading}</p>`}${Object.entries(byComp).map(([comp, block]) => {
    const cols = orderColumns(block.extraKeys);
    return renderTemplate`<section> <h2>${block.competition_name}</h2> <div class="table-wrap"> <table> <thead> <tr> <th class="sticky-1 col-year">回</th> <th class="col-rank">順位</th> ${cols.map((k) => renderTemplate`<th${addAttribute(colClassFor(k), "class")}>${labelFor(k)}</th>`)} </tr> </thead> <tbody> ${block.rows.map((r) => {
      const label = r.short_label ?? (r.year != null ? `${r.year}` : "—");
      const linkable = r.year != null;
      return renderTemplate`<tr> <td class="sticky-1 col-year"> ${linkable ? renderTemplate`<a${addAttribute(`${base}${comp}/${r.year}`, "href")}>${label}</a>` : renderTemplate`<span class="muted">${label}</span>`} </td> <td class="sticky-2 col-rank"><span class="badge"${addAttribute(r.rank_sort, "data-ranksort")}>${r.rank}</span></td> ${cols.map((k) => {
        const text = normalizeCellValue(k, r[k]);
        const cls = [colClassFor(k), MULTILINE_KEYS.has(k) ? "multiline" : ""].filter(Boolean).join(" ");
        if (isTitleKey(k)) {
          const movieKey = relatedMovieKeyForTitle(k);
          const url = movieKey ? normalizeCellValue(movieKey, r[movieKey]) : "";
          const isYouTube = !!url && /(?:^https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
          return renderTemplate`<td${addAttribute(cls, "class")}> ${text} ${url && " "} ${url && renderTemplate`<a${addAttribute(`video-link ${isYouTube ? "video-youtube" : ""}`, "class")}${addAttribute(url, "href")} target="_blank" rel="noopener noreferrer"${addAttribute(isYouTube ? "YouTubeで見る" : "動画を見る", "aria-label")}> <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"> <path fill="currentColor" d="M23.5 6.2a4 4 0 0 0-2.8-2.8C18.5 3 12 3 12 3S5.5 3 3.3 3.4A4 4 0 0 0 .5 6.2 41 41 0 0 0 0 12c0 2 .2 3.8.5 5.8a4 4 0 0 0 2.8 2.8C5.5 21 12 21 12 21s6.5 0 8.7-.4a4 4 0 0 0 2.8-2.8c.3-2 .5-3.8.5-5.8s-.2-3.8-.5-5.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z"></path> </svg> </a>`} </td>`;
        }
        return renderTemplate`<td${addAttribute(cls, "class")}>${text}</td>`;
      })} </tr>`;
    })} </tbody> </table> </div> </section>`;
  })}` })}`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/co/[id].astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/co/[id].astro";
const $$url = "/owarai-data/co/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
