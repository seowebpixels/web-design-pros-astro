// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://webdesignpros.co.za',
  output: 'static',
  build: {
    format: 'directory'
  },
  integrations: [
    sitemap()
  ],
  vite: {
    plugins: [tailwindcss()]
  },
  adapter: cloudflare({
    imageService: 'passthrough',
  })
});