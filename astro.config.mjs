// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://gmmtea.github.io',
  base: '/owarai-data/',
  integrations: [sitemap()],
});
