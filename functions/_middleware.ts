import { legacyWordPressResponse } from '../src/lib/legacy-wordpress';

export const onRequest: PagesFunction = async context => {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.webdesignpros.co.za') {
    url.hostname = 'webdesignpros.co.za';
    url.protocol = 'https:';
    return new Response(null, { status: ['GET', 'HEAD'].includes(context.request.method) ? 301 : 308, headers: { Location: url.href } });
  }
  const response = legacyWordPressResponse(context.request) ?? await context.next();
  // _headers covers static files; Functions must attach this header themselves.
  if (url.hostname === 'web-design-pros-astro.pages.dev' || url.hostname.endsWith('.web-design-pros-astro.pages.dev')) {
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
};
