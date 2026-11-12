export async function accountRequest(path:string, body?:unknown) {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const value=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(value?.message || value?.error || 'Unable to complete your account request. Please try again.');
  return value;
}
