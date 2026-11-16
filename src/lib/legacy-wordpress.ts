// Published business-page IDs from the pre-migration WordPress export.
const pages: Record<string, string> = {
  '23': '/',
  '2876': '/services/web-design/',
  '3566': '/services/social-media-marketing/',
  '3669': '/services/web-design/',
  '3775': '/contact/',
  '4043': '/services/seo-optimization/',
  '4394': '/services/web-hosting/',
  '4468': '/services/website-maintenance/',
  '4577': '/services/branding-services/',
};

export function legacyWordPressResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/' || !['GET', 'HEAD'].includes(request.method)) return null;

  const ids = [...url.searchParams.getAll('p'), ...url.searchParams.getAll('page_id')];
  const template = url.searchParams.has('wpr_templates') || url.searchParams.has('wpr_mega_menu');
  if (!template && ids.length === 0) return null;

  // Only unambiguous, known business-page IDs have a relevant replacement.
  const target = !template && ids.length === 1 ? pages[ids[0]] : undefined;
  if (target) {
    url.pathname = target;
    url.searchParams.delete('p');
    url.searchParams.delete('page_id');
    return new Response(null, { status: 301, headers: {
      Location: url.pathname + url.search,
      'Cache-Control': 'no-store',
    } });
  }

  return new Response(request.method === 'HEAD' ? null : '<!doctype html><html lang="en-ZA"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | Web Design Pros</title><body><main><h1>Page not found</h1><p>This old page is no longer available.</p><a href="/">Visit Web Design Pros</a></main></body></html>', {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
