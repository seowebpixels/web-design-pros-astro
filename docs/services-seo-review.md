# Services content and SEO review — 15 November 2026

## Baseline reviewed

The current WordPress homepage and these public pages were read before refinement:

- https://www.webdesignpros.co.za/web-design-services/
- https://www.webdesignpros.co.za/website-maintenance-south-africa/
- https://www.webdesignpros.co.za/web-hosting-south-africa/
- https://www.webdesignpros.co.za/seo-services-in-randburg-johannesburg/
- https://www.webdesignpros.co.za/social-media-marketing/
- https://www.webdesignpros.co.za/branding-services-south-africa/
- https://www.webdesignpros.co.za/professional-web-design-johannesburg/

The five original dropdown services remain, with Branding, E-commerce, Google Ads and Micro-tools as additional pages. The new pages retain practical scope, process and FAQ material while reducing repetition. WordPress package prices, inconsistent telephone numbers, unspecified uptime guarantees, unsupported performance/traffic claims and generic testimonials were not migrated into the service copy. Reconcile those separately before launch.

## E-E-A-T and evidence

The service pages now also include service-specific explanations of assessment, decisions and delivery, a practical outcomes list and an explicitly labelled example brief. Example briefs illustrate a possible project; they are not historical client case studies. Marlan Pather is named as the contact person, consistent with the existing Contact page, without adding unverified qualifications or review claims. The exact shared Contact enquiry form is included on all service pages and the overview.

Google's guidance prioritises useful, reliable content and accurate evidence. E-E-A-T is not a certification or a single ranking score: https://developers.google.com/search/docs/fundamentals/creating-helpful-content

- Show the actual legal business identity, location, direct contact links, company-registration document and terms.
- Link to the existing About page rather than inventing a named expert, years of experience, awards or qualifications.
- Web Design shows existing portfolio examples with neutral descriptions; no performance or lead metrics are added without supporting evidence.
- The Microsoft history is a clearly identified educational example, not a WDP client or endorsement. The user's existing five illustrations are copied locally. Historical sources are linked and design lessons are labelled as WDP interpretation. The unsupported claim that Microsoft's 2012 logo originated flat design was removed.
- Before publishing measurable case studies or testimonials, confirm the client permission, work performed, original evidence and measurement period. Do not reuse the old page's 300% growth / 200-lead examples without evidence.

## Implemented on-site foundations

- Unique descriptive service titles, descriptions and topic-focused headings.
- Production canonical URLs, social sharing metadata, en-ZA language, crawlable navigation, related-service links and sitemap inclusion.
- Service, WebPage and BreadcrumbList structured data. Global provider uses ProfessionalService with legalName and a valid imported logo URL. No fabricated rating/review markup; no promise of FAQ rich results.
- Native keyboard-operable FAQ disclosures; illustrated timeline uses an ordered list, dates, image alternatives and a mobile single-column layout.
- One-hop 301 mappings in public/_redirects for the known old WordPress service URLs and /work-with-us/. Preserve meaningful historical fragment links where practical.

Migration reference: https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes

## External work and production checks still required

These are not completed by generating pages. Do not describe off-page SEO as fully complete.

- Confirm one preferred host (new site uses https://webdesignpros.co.za) and configure the www-to-apex host redirect in Cloudflare at launch. Verify HTTPS and redirect responses on both hosts.
- Verify Google Business Profile ownership, eligibility, current contact details, actual service area and website links. Keep directory and social profiles consistent with that approved information.
- Update links you control to the final service URLs after launch. Request corrections to relevant existing listings and earned industry references. No purchased ranking links, fake reviews or fabricated local offices.
- Invite honest feedback from real clients without incentives or prescribed keyword wording. Publish genuine, permissioned case studies and respond to reviews as the business owner.
- Confirm Search Console access, submit the final sitemap, inspect migrated URLs and monitor indexing, redirects, 404s and search performance. Review analytics and consent requirements before adding tracking.
- Measure mobile layout, accessibility and production loading behaviour. Build checks are not a Core Web Vitals field assessment or a guarantee of search positions.
- The sitemap still contains pre-existing account/dashboard/payment routes; decide appropriate noindex/robots rules during the wider site's final SEO pass. Do not rely on robots.txt for access control.

Pricing copy, hosting entitlements and verified contact-number consistency across the entire site need the final site pass. DC remains parked as recorded in launch-final-pass.md.
