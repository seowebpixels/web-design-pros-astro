# Production domain cutover

Canonical origin: **https://webdesignpros.co.za**. Preserve the Microsoft 365 MX/TXT records and the existing GSC verification method.

Before changing live website DNS:

1. Push/deploy the legacy URL and indexing safeguards. Confirm preview root/HTML responses have `X-Robots-Tag: noindex`, `/404.html` is deployed, unknown `?p=` URLs return 404 and `/#contact-section` reaches the enquiry section.
2. Connect apex and www to this Pages project, preserve a snapshot of the old web DNS for rollback, and confirm the Cloudflare certificates are active. Configure HTTPS at the zone. Do not change mail DNS or nameservers as a shortcut.
3. At cutover change production `AUTH_BASE_URL` from the pages.dev origin to `https://webdesignpros.co.za` and redeploy. Confirm account sign-in and verification/reset link origins. Payment testing is not live-payment readiness.
4. At cutover add/enable a Cloudflare zone Single Redirect matching `(http.host eq "www.webdesignpros.co.za")`, dynamic target `concat("https://webdesignpros.co.za", http.request.uri.path)`, 301, preserve query string. Do not activate it against the old WordPress site before checking its existing apex-to-www behaviour. Root/API/dashboard responses also canonicalise through `functions/_middleware.ts` (308 for non-GET requests). The canonical metadata and sitemap use the apex HTTPS origin. Verify HTTP is redirected to HTTPS by Cloudflare. Hostname-source patterns are not supported by this project's Pages `_redirects` parser.
5. The pages.dev project, deployment and branch addresses remain available for testing but carry `noindex`: `_headers` for static responses and middleware for Functions. Do not block their crawling in robots.txt, because crawlers must see the noindex header. Verify the production domain does **not** inherit noindex.
6. Recheck all eight old service/contact paths, homepage, enquiry, account flows, HTTPS/apex/www and 404 responses. Inspect service pages and submit the canonical production sitemap in the appropriate verified GSC property. Existing www-prefix GSC history must be retained; confirm apex/domain-property coverage.

## Required post-launch redirect verification

User requested this explicit check before committing on 16 November 2026. Check against the **live production domain after cutover**, not only the Pages preview. Leave unchecked until verified.

- [ ] `/web-design-services/` → `/services/web-design/` returns **301**, then the destination returns **200**.
- [ ] `/professional-web-design-johannesburg/` → `/services/web-design/`.
- [ ] `/website-maintenance-south-africa/` → `/services/website-maintenance/`.
- [ ] `/web-hosting-south-africa/` → `/services/web-hosting/`.
- [ ] `/seo-services-in-randburg-johannesburg/` → `/services/seo-optimization/`.
- [ ] `/social-media-marketing/` → `/services/social-media-marketing/`.
- [ ] `/branding-services-south-africa/` → `/services/branding-services/`.
- [ ] `/work-with-us/` → `/contact/`.
- [ ] For every mapping, verify the old URL with and without the trailing slash, on both apex and www; confirm the final HTTPS apex destination, a permanent redirect and no redirect loops. Record any unnecessary redirect chains.
- [ ] Confirm query strings survive appropriate redirects and `/#contact-section` still reaches the enquiry form.
- [ ] Confirm unrelated missing paths and unknown legacy numeric IDs return real **404** responses rather than a **200** homepage.

Analytics audit in progress: the signed-in Google account had no GTM accounts. GA4 has a Web Design Pros account (387591925) as well as Facet Architecture; do not use Facet's measurement ID. The WDP property/stream must be inspected before installing tracking. No new Google accounts, containers or properties have been created.


## Robots, sitemap and canonical verification

16 November pre-cutover audit directly fetched deployed robots.txt, sitemap-index.xml, sitemap-0.xml and all 33 public pages. Sitemap URLs use the HTTPS apex production origin: nine service pages, eight main public pages and 16 location pages. No private routes or malformed URLs were included. All 33 preview page responses were 200 with X-Robots-Tag: noindex.

The audit found 19 deployed canonical URLs missing the trailing slash used by the sitemap. Layout.astro now normalises canonical and og:url to the production directory URL; the rebuilt HTML passed exact comparison for all 33 entries.

- [ ] Deploy the canonical formatting correction and re-fetch all 33 pages to confirm exact matches with the sitemap XML.
- [ ] After domain cutover, fetch production robots.txt and both sitemap XML files; confirm 200 responses, production URLs and all nine services.
- [ ] After domain cutover, verify every sitemap page returns 200 with its matching production canonical and no meta/header noindex. Reconfirm preview pages retain noindex.
