import business from '../data/schema/business.json';
import offers from '../data/schema/offers.json';
import home from '../data/schema/home.json';
import services from '../data/schema/services.json';
import pricing from '../data/schema/pricing.json';
import contact from '../data/schema/contact.json';
import webDesign from '../data/schema/services__web-design.json';
import maintenance from '../data/schema/services__website-maintenance.json';
import hosting from '../data/schema/services__web-hosting.json';
import seo from '../data/schema/services__seo-optimization.json';
import social from '../data/schema/services__social-media-marketing.json';
import branding from '../data/schema/services__branding-services.json';
import saas from '../data/schema/services__saas-micro-tools.json';
import ecommerce from '../data/schema/services__e-commerce.json';
import googleAds from '../data/schema/services__google-ads.json';

type SchemaNode = { '@id': string; '@type': string; [key: string]: unknown };
type SchemaDocument = { '@context': string; '@graph': SchemaNode[] };

const pageSchemas: Record<string, SchemaDocument> = {
  '/': home,
  '/services/': services,
  '/pricing/': pricing,
  '/contact/': contact,
  '/services/web-design/': webDesign,
  '/services/website-maintenance/': maintenance,
  '/services/web-hosting/': hosting,
  '/services/seo-optimization/': seo,
  '/services/social-media-marketing/': social,
  '/services/branding-services/': branding,
  '/services/saas-micro-tools/': saas,
  '/services/e-commerce/': ecommerce,
  '/services/google-ads/': googleAds,
};

/** One complete graph per page; shared entities and prices have one source. */
export function structuredDataForPage(pathname: string, logoUrl: string): SchemaDocument {
  const path = new URL(pathname, 'https://webdesignpros.co.za').pathname;
  const normalizedPath = path.endsWith('/') ? path : `${path}/`;
  const globalNodes: SchemaNode[] = business['@graph'].map(node =>
    node['@type'] === 'ProfessionalService'
      ? { ...node, logo: { ...node.logo, url: logoUrl } }
      : { ...node }
  );
  const pageNodes = pageSchemas[normalizedPath]?.['@graph'] ?? [];
  const serviceId = `https://webdesignpros.co.za${normalizedPath}#service`;
  const pageOffers = normalizedPath === '/pricing/'
    ? offers
    : offers.filter(offer => offer.itemOffered['@id'] === serviceId);

  return {
    '@context': 'https://schema.org',
    '@graph': [...globalNodes, ...pageNodes, ...pageOffers],
  };
}

/** Prevent edited text from terminating the inline JSON-LD script element. */
export function serializeStructuredData(schema: SchemaDocument): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
