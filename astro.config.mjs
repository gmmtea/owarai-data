// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';

// リダイレクトマップを読み込む
const redirectsRaw = fs.existsSync('./redirects.json') 
  ? JSON.parse(fs.readFileSync('./redirects.json', 'utf8'))
  : {};

const redirects = redirectsRaw;

export default defineConfig({
  site: 'https://owarai-data.com',
  integrations: [sitemap()],
  redirects,
});
