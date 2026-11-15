// Deploy this small scheduled Worker separately from the existing Pages site.
// Its only credential is the existing internal retry secret, set as a Worker secret.
export default {
 async scheduled(_event,env,context){context.waitUntil(run(env));},
};
async function run(env){
 const base=new URL(env.WDP_SITE_ORIGIN);
 if(base.protocol!=='https:'||base.origin!==env.WDP_SITE_ORIGIN||!env.WDP_ORDER_ALERT_RETRY_SECRET)throw new Error('Renewal job configuration missing');
 const response=await fetch(base.origin+'/api/internal/renewals',{method:'POST',headers:{Authorization:`Bearer ${env.WDP_ORDER_ALERT_RETRY_SECRET}`},redirect:'manual',signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw new Error('Renewal reminder job failed');
 const data=await response.json();console.log(JSON.stringify({queued:data.queued,sent:data.sent,pending:data.pending}));
}
