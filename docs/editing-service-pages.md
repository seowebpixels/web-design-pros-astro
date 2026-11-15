# Editing service pages

Every service has its own page file in `src/pages/services/`:

- `web-design.astro`
- `website-maintenance.astro`
- `web-hosting.astro`
- `seo-optimization.astro`
- `social-media-marketing.astro`
- `branding-services.astro`
- `saas-micro-tools.astro`
- `e-commerce.astro`
- `google-ads.astro`

Open the relevant file to change its title, introduction, features, included work, process, FAQs and detailed sales content. The `service` and `detail` sections contain the text for that page. Preserve the slug to keep the existing URL working.

The shared design is in `src/components/ServicePage.astro`. The Contact form is shared through `src/components/CTA.astro`. Branding's Microsoft timeline remains in `src/components/BrandTimeline.astro`, with a comment pointing to it from the Branding page.

`src/data/services.ts` contains only short navigation/homepage/related-service summaries. Edit that file if you want those summaries or menu labels to change too. It no longer contains the full page copy.

`src/pages/services/index.astro` is the Services overview.
