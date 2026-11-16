# Structured data

Imported from the user's `wdp_jsonld_priced_complete.zip` revision.

- `business.json`: shared WebSite and ProfessionalService entities.
- `offers.json`: the four published website package prices, in ZAR. The visible Pricing component and relevant service pages use these same prices.
- `home.json`, `services.json`, `pricing.json`, `contact.json`: page-specific entities.
- `services__*.json`: each service page's entities, with its WebPage, Service and breadcrumbs.

`src/lib/structured-data.ts` combines the shared entities, the matching page and its offers into a single graph. `Layout.astro` emits that graph once. Other pages continue to receive the shared business/site entities.

The logo URL in the imported business data is replaced with Astro's current imported image URL at build time. Do not manually maintain a hashed `_astro` filename.

Keep service descriptions consistent with the visible page content. Shared offer IDs connect the Web Design and E-Commerce pages to the pricing catalog. Change package amounts in `offers.json`; their visible prices and JSON-LD will update together. No Product or review-rating markup is added.
