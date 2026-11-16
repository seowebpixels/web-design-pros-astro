# Production domain cutover

Canonical origin: **https://webdesignpros.co.za**. Preserve the Microsoft 365 MX/TXT records and the existing GSC verification method.

Before changing live website DNS:

1. Push/deploy the legacy URL and indexing safeguards. Confirm preview root/HTML responses have `X-Robots-Tag: noindex`, `/404.html` is deployed, unknown `?p=` URLs return 404 and `/#contact-section` reaches the enquiry section.
2. Connect apex and www to this Pages project, preserve a snapshot of the old web DNS for rollback, and confirm the Cloudflare certificates are active. Configure HTTPS at the zone. Do not change mail DNS or nameservers as a shortcut.
3. At cutover change production `AUTH_BASE_URL` from the pages.dev origin to `https://webdesignpros.co.za` and redeploy. Confirm account sign-in and verification/reset link origins. Payment testing is not live-payment readiness.
4. At cutover add/enable a Cloudflare zone Single Redirect matching `(http.host eq "www.webdesignpros.co.za")`, dynamic target `concat("https://webdesignpros.co.za", http.request.uri.path)`, 301, preserve query string. Do not activate it against the old WordPress site before checking its existing apex-to-www behaviour. Root/API/dashboard responses also canonicalise through `functions/_middleware.ts` (308 for non-GET requests). The canonical metadata and sitemap use the apex HTTPS origin. Verify HTTP is redirected to HTTPS by Cloudflare. Hostname-source patterns are not supported by this project's Pages `_redirects` parser.
5. The pages.dev project, deployment and branch addresses remain available for testing but carry `noindex`: `_headers` for static responses and middleware for Functions. Do not block their crawling in robots.txt, because crawlers must see the noindex header. Verify the production domain does **not** inherit noindex.
6. Recheck all eight old service/contact paths, homepage, enquiry, account flows, HTTPS/apex/www and 404 responses. Inspect service pages and submit the canonical production sitemap in the appropriate verified GSC property. Existing www-prefix GSC history must be retained; confirm apex/domain-property coverage.

Analytics audit in progress: the signed-in Google account had no GTM accounts. GA4 has a Web Design Pros account (387591925) as well as Facet Architecture; do not use Facet's measurement ID. The WDP property/stream must be inspected before installing tracking. No new Google accounts, containers or properties have been created.
