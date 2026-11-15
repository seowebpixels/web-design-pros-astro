export interface Service {
  slug:string; title:string; seoTitle?:string; icon:string; summary:string; headline:string; intro:string;
  audience:string; features:string[]; deliverables:{title:string;description:string}[];
  steps:{title:string;description:string}[]; faqs:{question:string;answer:string}[];
  scope:string; related:string[];
}

export interface ServiceDetail {
  heading:string; introduction:string[];
  approach:{title:string;body:string}[];
  outcomes:string[]; example:{title:string;body:string};
}

