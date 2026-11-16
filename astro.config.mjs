// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://webdesignpros.co.za',
  output: 'static',

  build: {
    format: 'directory',
    inlineStylesheets: 'always'
  },

  integrations: [
    sitemap({
      filter: page => {
        const path = decodeURIComponent(new URL(page).pathname);
        return !/^\/(account|checkout|dashboard|payment|api)(\/|$)/.test(path) && !/\s/.test(path);
      }
    })
  ],

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: cloudflare()
});
