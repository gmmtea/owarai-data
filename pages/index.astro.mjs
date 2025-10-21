import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute } from '../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { e as listEditionParams, h as competitionMap, i as competitionOrder, $ as $$Base } from '../chunks/Base_PG1JNf83.mjs';
export { renderers } from '../renderers.mjs';

const $$Index = createComponent(($$result, $$props, $$slots) => {
  const base = "/owarai-data/";
  const params = listEditionParams();
  const labels = competitionMap();
  const compOrder = competitionOrder();
  const groups = /* @__PURE__ */ new Map();
  for (const { comp, year, short_label } of params) {
    if (!groups.has(comp)) groups.set(comp, []);
    groups.get(comp).push({ year: year ?? null, short_label: short_label ?? null });
  }
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "お笑い主要データまとめ" }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<h1>お笑い主要データまとめ</h1> <div class="card"> <p class="muted">
お笑い賞レースの年別結果と、芸人ごとの戦績を横断して参照できる非公式データ集です。
</p> <p class="muted">
現状の収録範囲:
</p> <ul class="muted"> <li>M-1／THE MANZAI／KOC／R-1／ABC（2012〜）／ツギクル 全大会の決勝結果（順位／キャッチコピー／1本目出順／1本目結果／2本目出順／2本目結果）</li> <li>NHK新人お笑い大賞 2014〜2025 の決勝順位</li> <li>KOC 2014〜2025／しずる の決勝ネタ</li> <li>M-1 2015〜2024 1本目／KOC 2015〜2025 1・2本目／R-1 2021〜2025 1本目／ABC 2012〜2015 の審査員別得点</li> </ul> </div> ${compOrder.filter((c) => groups.has(c)).map((c) => {
    const list = groups.get(c);
    list.sort(
      (a, b) => a.year == null ? b.year == null ? 0 : 1 : b.year == null ? -1 : b.year - a.year
    );
    return renderTemplate`<section> <h2>${labels[c]}</h2> <ul> ${list.map(({ year, short_label }) => {
      const label = short_label ?? (year != null ? `${year}` : "（回次未設定）");
      return renderTemplate`<li> ${year != null ? renderTemplate`<a${addAttribute(`${base}${c}/${year}`, "href")}>${label} 決勝結果</a>` : renderTemplate`<span class="muted">${label} 決勝結果</span>`} </li>`;
    })} </ul> <p><a${addAttribute(`${base}${c}`, "href")}>→ ${labels[c]} 年別結果一覧</a></p> </section>`;
  })}` })}`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/index.astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/index.astro";
const $$url = "/owarai-data";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
