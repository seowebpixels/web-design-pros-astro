import {parse,parseFragment,serialize} from 'parse5';
import type {DefaultTreeAdapterMap} from 'parse5';
import type {AccountEnv} from '../accounts/auth';
import {invoiceView,type InvoiceDetail} from './invoice-view';
type Node=DefaultTreeAdapterMap['node'];
type Element=DefaultTreeAdapterMap['element'];
const children=(node:Node):Node[]=>'childNodes' in node?node.childNodes:[];
const elements=(node:Node):Element[]=>children(node).flatMap(child=>[...('tagName' in child?[child]:[]),...elements(child)]);
const attr=(node:Element,name:string)=>node.attrs.find(value=>value.name===name)?.value;
function setAttr(node:Element,name:string,value:string){node.attrs=node.attrs.filter(item=>item.name!==name);node.attrs.push({name,value});}
function text(node:Element,value:string){node.childNodes=[{nodeName:'#text',value,parentNode:node}];}
function remove(node:Element){const parent=node.parentNode;if(parent&&'childNodes' in parent)parent.childNodes=parent.childNodes.filter(child=>child!==node);}
function base64(bytes:Uint8Array){let value='';for(let offset=0;offset<bytes.length;offset+=8192)value+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(value);}

export async function invoiceHtml(env:AccountEnv,invoice:InvoiceDetail){
  if(!env.ASSETS||!env.AUTH_BASE_URL)throw new Error('pdf_configuration');
  const origin=new URL(env.AUTH_BASE_URL).origin;
  const asset=async(path:string)=>{
    const url=new URL(path,origin);
    if(url.origin!==origin||url.search||(!url.pathname.startsWith('/_astro/')&&url.pathname!=='/dashboard/invoice/'))throw new Error('pdf_asset');
    // Static assets only; never forward a customer cookie or access token.
    const response=await env.ASSETS!.fetch(new Request(url,{redirect:'manual'}));
    if(!response.ok)throw new Error('pdf_asset');return response;
  };
  const document=parse(await (await asset('/dashboard/invoice/')).text());
  const all=elements(document),head=all.find(node=>node.tagName==='head')!,body=all.find(node=>node.tagName==='body')!;
  const byId=(id:string)=>{const node=all.find(node=>attr(node,'id')===id);if(!node)throw new Error('pdf_template');return node;};
  const paper=byId('invoice-paper'),view=invoiceView(invoice);
  for(const [id,value] of Object.entries(view.text))text(byId(id),value);
  paper.attrs=paper.attrs.filter(item=>item.name!=='hidden');
  if(view.test)byId('invoice-test-note').attrs=byId('invoice-test-note').attrs.filter(item=>item.name!=='hidden');
  else setAttr(byId('invoice-test-note'),'hidden','');
  const rows=byId('invoice-lines');rows.childNodes=[];
  for(const values of view.lines){
    const fragment=parseFragment('<table><tbody><tr><td></td><td></td><td></td></tr></tbody></table>');
    const cells=elements(fragment).filter(node=>node.tagName==='td'),row=elements(fragment).find(node=>node.tagName==='tr')!;
    cells.forEach((cell,index)=>text(cell,values[index]));row.parentNode=rows;rows.childNodes.push(row);
  }
  text(all.find(node=>node.tagName==='title')!,view.title);
  // Reuse the built page's scoped styles and logo, without a public invoice URL.
  const styles=all.filter(node=>node.tagName==='style');
  for(const link of all.filter(node=>node.tagName==='link'&&attr(node,'rel')==='stylesheet')){
    const css=await (await asset(attr(link,'href')!)).text();
    const style=elements(parseFragment('<style></style>'))[0];text(style,css);styles.push(style);
  }
  head.childNodes=head.childNodes.filter(node=>'tagName' in node&&['meta','title'].includes(node.tagName));
  for(const style of styles){style.parentNode=head;head.childNodes.push(style);}
  paper.parentNode=body;body.childNodes=[paper];
  for(const node of elements(document)){
    if(['script','iframe','object','embed','base'].includes(node.tagName)){remove(node);continue;}
    node.attrs=node.attrs.filter(item=>!item.name.startsWith('on'));
    if(node.tagName==='img'){
      const response=await asset(attr(node,'src')!);const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>500000)throw new Error('pdf_asset');
      setAttr(node,'src',`data:${response.headers.get('content-type')?.split(';')[0]??'image/avif'};base64,${base64(bytes)}`);
      node.attrs=node.attrs.filter(item=>!['srcset','loading'].includes(item.name));
    }
  }
  return serialize(document);
}

export async function invoiceAttachment(env:AccountEnv,invoice:InvoiceDetail){
  if(!env.WDP_PDF_ACCOUNT_ID||!/^[a-f0-9]{32}$/i.test(env.WDP_PDF_ACCOUNT_ID)||!env.WDP_PDF_API_TOKEN)throw new Error('pdf_configuration');
  const html=await invoiceHtml(env,invoice);
  // Customer invoice rendering through Cloudflare was explicitly approved.
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.WDP_PDF_ACCOUNT_ID}/browser-run/pdf`,{
    method:'POST',headers:{Authorization:`Bearer ${env.WDP_PDF_API_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({html,allowRequestPattern:['^data:','^https://api[.]fontshare[.]com/','^https://cdn[.]fontshare[.]com/','^https://fonts[.]googleapis[.]com/','^https://fonts[.]gstatic[.]com/'],pdfOptions:{format:'a4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false}}),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw new Error('pdf_render');
  const reader=response.body?.getReader();if(!reader)throw new Error('pdf_render');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>900000){await reader.cancel();throw new Error('pdf_size');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('pdf_render');
  return {filename:invoice.reference+'.pdf',content:base64(bytes),content_type:'application/pdf'};
}
