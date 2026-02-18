// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';

const base = '/owarai-data/';

// リダイレクトマップを読み込み、baseを追加
const redirectsRaw = fs.existsSync('./redirects.json') 
  ? JSON.parse(fs.readFileSync('./redirects.json', 'utf8'))
  : {};

const redirects = {};
for (const [from, to] of Object.entries(redirectsRaw)) {
  // baseを含めないパスに対してbaseを追加
  redirects[from] = `${base}${to.startsWith('/') ? to.slice(1) : to}`;
}

export default defineConfig({
  site: 'https://gmmtea.github.io',
  base,
  integrations: [sitemap()],
  redirects,
});
