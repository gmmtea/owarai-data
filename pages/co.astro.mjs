import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute, F as Fragment } from '../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { a as listComediansAll, $ as $$Base } from '../chunks/Base_PG1JNf83.mjs';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

const $$Index = createComponent(($$result, $$props, $$slots) => {
  const base = "/owarai-data/";
  const canon = (s) => s.normalize("NFKC").trim().replace(/\s+/g, " ");
  const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 96));
  const isKanaOnly = (s) => /^[\p{sc=Hiragana}\p{sc=Katakana}ー・･・\s]+$/u.test(canon(s));
  const stripSymbolsForReading = (s) => s.replace(/[・･·\u30FB\uFF65]/g, "").replace(/[\u0020\u00A0\u3000]/g, "").replace(/[()\[\]{}「」『』【】〈〉《》]/g, "").replace(/[.,，．\/／]/g, "").replace(/[-_—–―]/g, "");
  const decideReading = (name, reading) => {
    if (reading && reading.trim() !== "") return reading;
    if (isKanaOnly(name)) return stripSymbolsForReading(toHiragana(canon(name)));
    return "";
  };
  const groups = [
    { key: "あ", set: "あいうえお" },
    { key: "か", set: "かきくけこがぎぐげご" },
    { key: "さ", set: "さしすせそざじずぜぞ" },
    { key: "た", set: "たちつてとだぢづでど" },
    { key: "な", set: "なにぬねの" },
    { key: "は", set: "はひふへほばびぶべぼぱぴぷぺぽ" },
    { key: "ま", set: "まみむめも" },
    { key: "や", set: "やゆよ" },
    { key: "ら", set: "らりるれろ" },
    { key: "わ", set: "わゐゑをん" }
    // ん はここへ寄せる
  ];
  const groupIndex = (ch) => {
    const h = toHiragana(ch);
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].set.includes(h)) return i;
    }
    return -1;
  };
  const raw = listComediansAll();
  const enriched = raw.map((r) => {
    const reading = decideReading(r.name, r.reading);
    return { ...r, reading };
  });
  const sortKey = (s, fallback) => s && s.length ? s : fallback;
  const buckets = {};
  for (const g of groups) buckets[g.key] = [];
  buckets["その他"] = [];
  for (const r of enriched) {
    const rd = r.reading;
    const head = rd ? rd[0] : "";
    const idx = head ? groupIndex(head) : -1;
    const key = idx >= 0 ? groups[idx].key : "その他";
    buckets[key].push({ id: r.id, name: r.name, reading: rd });
  }
  const collator = new Intl.Collator("ja", { sensitivity: "base", usage: "sort" });
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => {
      const ak = sortKey(a.reading, a.name);
      const bk = sortKey(b.reading, b.name);
      const c = collator.compare(ak, bk);
      if (c !== 0) return c;
      return collator.compare(a.name, b.name);
    });
  }
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "芸人一覧（五十音）", "data-astro-cid-7wnhf6kv": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<nav class="breadcrumbs" data-astro-cid-7wnhf6kv> <a${addAttribute(base, "href")} data-astro-cid-7wnhf6kv>トップ</a><span class="sep" data-astro-cid-7wnhf6kv>/</span> <span data-astro-cid-7wnhf6kv>芸人一覧</span> </nav> <h1 data-astro-cid-7wnhf6kv>芸人一覧</h1> ${groups.map((g) => renderTemplate`<section data-astro-cid-7wnhf6kv> <h2 data-astro-cid-7wnhf6kv>${g.key}行</h2> ${buckets[g.key].length ? renderTemplate`<p class="name-line" data-astro-cid-7wnhf6kv> ${buckets[g.key].map((it, i) => renderTemplate`${renderComponent($$result2, "Fragment", Fragment, { "data-astro-cid-7wnhf6kv": true }, { "default": ($$result3) => renderTemplate`${i > 0 && " / "}<a${addAttribute(`${base}co/${it.id}`, "href")} data-astro-cid-7wnhf6kv>${it.name}</a> ` })}`)} </p>` : renderTemplate`<p class="muted" data-astro-cid-7wnhf6kv>該当なし</p>`} </section>`)}${buckets["その他"].length > 0 && renderTemplate`<section data-astro-cid-7wnhf6kv> <h2 data-astro-cid-7wnhf6kv>その他</h2> <p class="name-line" data-astro-cid-7wnhf6kv> ${buckets["その他"].map((it, i) => renderTemplate`${renderComponent($$result2, "Fragment", Fragment, { "data-astro-cid-7wnhf6kv": true }, { "default": ($$result3) => renderTemplate`${i > 0 && " / "}<a${addAttribute(`${base}co/${it.id}`, "href")} data-astro-cid-7wnhf6kv>${it.name}</a> ` })}`)} </p> </section>`}` })} `;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/co/index.astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/co/index.astro";
const $$url = "/owarai-data/co";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
