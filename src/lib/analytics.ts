export const ANALYTICS_CHOICE_KEY = 'wdp-analytics-choice-v1';
export const GTM_CONTAINER_ID = 'GTM-5W2GL9MC';

declare global {
  interface Window {
    dataLayer?: unknown[];
    wdpAnalyticsLoaded?: boolean;
  }
}

export function isPublicProductionPage(location: Pick<Location, 'hostname' | 'pathname'>) {
  return location.hostname === 'webdesignpros.co.za' &&
    !/^\/(account|checkout|dashboard|payment|api)(\/|$)/.test(location.pathname);
}

export function analyticsAllowed() {
  try { return localStorage.getItem(ANALYTICS_CHOICE_KEY) === 'accepted'; }
  catch { return false; }
}

export function trackWebsiteEvent(event: 'generate_lead' | 'phone_click', source: 'contact-form' | 'growth-modal' | 'phone-link') {
  if (!isPublicProductionPage(window.location) || !analyticsAllowed() || !window.wdpAnalyticsLoaded) return;
  window.dataLayer?.push({ event, lead_source: source });
}
