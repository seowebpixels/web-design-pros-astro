// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://webdesignpros.co.za',
  output: 'static', // Forces static site generation for all pages by default
  trailingSlash: 'ignore', // Allows Cloudflare Pages to resolve both /contact and /contact/ seamlessly
  build: {
    format: 'file' // Generates /contact.html instead of /contact/index.html
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