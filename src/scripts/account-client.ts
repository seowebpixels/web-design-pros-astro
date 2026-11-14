export async function accountRequest(path:string, body?:unknown) {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const value=await response.json().catch(()=>null);
  if(!response.ok){
    if(response.status===429){
      const retry=Number(response.headers.get('retry-after')??response.headers.get('x-retry-after'));
      const seconds=Number.isFinite(retry)&&retry>0?Math.min(3600,Math.ceil(retry)):60;
      throw new Error(`Too many ${path.startsWith('/api/auth/sign-in/')?'sign-in attempts':'requests'}. Please wait ${seconds} seconds before trying again.`);
    }
    const message=typeof value?.message==='string'?value.message:typeof value?.error==='string'?value.error:null;
    throw new Error(message || (response.status>=500?`The account service is temporarily unavailable (HTTP ${response.status}). Please try again shortly.`:`Unable to complete your account request (HTTP ${response.status}). Please refresh the page and try again.`));
  }
  return value;
}
