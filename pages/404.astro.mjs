import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute } from '../chunks/astro/server_B4pMu0y3.mjs';
import 'kleur/colors';
import 'html-escaper';
import { $ as $$Base } from '../chunks/Base_PG1JNf83.mjs';
export { renderers } from '../renderers.mjs';

const $$404 = createComponent(($$result, $$props, $$slots) => {
  const base = "/owarai-data/";
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "ページが見つかりません" }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<h1>404</h1> <p>URLをご確認ください。<a${addAttribute(base, "href")}>トップに戻る</a></p> ` })}`;
}, "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/404.astro", void 0);
const $$file = "/Users/kanazashikito/Projects/owarai-data/owarai-data/src/pages/404.astro";
const $$url = "/owarai-data/404";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$404,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
