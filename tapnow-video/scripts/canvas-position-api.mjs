// Optional replay of observed same-origin requests through the bound CUA CDP
// capability. Coordinates only; authentication stays in this session's closure.
const stable=value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const near=(a,b)=>a && b && ['x','y'].every(k=>Number.isFinite(a[k]) && Math.abs(a[k]-b[k])<=.11);
const ordinary=id=>/^(image|video)-[\w-]+$/.test(id);
const omit=(object,keys)=>Object.fromEntries(Object.entries(object).filter(([key])=>!keys.includes(key)));

export class PositionApiError extends Error {
  constructor(code,safeToFallback=false,{httpStatus,retryAt,writeAttempted}={}) {
    super(code);this.code=code;this.safeToFallback=safeToFallback;
    if(httpStatus!==undefined)this.httpStatus=httpStatus;
    if(retryAt!==undefined)this.retryAt=retryAt;
    if(writeAttempted===true)this.writeAttempted=true;
  }
}

export function createCanvasPositionApi({cdp,readUrl,writeUrl,headers,timeoutMs=6000,
  clock={now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))}}) {
  const read=new URL(readUrl),write=new URL(writeUrl);
  const match=read.pathname.match(/^\/api\/canvas\/v1\/canvases\/([\w-]+)$/);
  if(!match || read.origin!=='https://app.tapnow.ai' || write.origin!==read.origin || read.hash || write.hash ||
    write.search || write.pathname!==read.pathname+'/nodes:batchActions' ||
    read.searchParams.get('with_nodes')!=='true' || read.searchParams.get('with_connections')!=='true' ||
    [...read.searchParams.keys()].length!==2 || typeof cdp?.send!=='function' ||
    !Number.isFinite(timeoutMs) || timeoutMs<1000 || timeoutMs>15000 ||
    typeof clock.now!=='function' || typeof clock.sleep!=='function')
    throw new PositionApiError('unverified-position-route',true);
  const canvasId=match[1],sessionHeaders={};
  const allowed=['authorization','content-type','x-org-id','x-tapnow-origin','x-tap-client-runtime','x-tap-client-version'];
  for(const [key,value] of Object.entries(headers||{}))
    if(allowed.includes(key.toLowerCase()) && typeof value==='string')sessionHeaders[key.toLowerCase()]=value;
  if(!sessionHeaders.authorization)throw new PositionApiError('session-auth-unavailable',true);
  sessionHeaders['content-type']='application/json';
  let busy=false,blocked=null,lastFinishedAt=-Infinity;
  function stop(code,httpStatus,retryAfter) {
    const details={httpStatus};
    if(retryAfter!==undefined) {
      const now=clock.now(),value=retryAfter.trim();
      const until=/^\d+$/.test(value)?now+Number(value)*1000:Date.parse(value);
      details.retryAt=Number.isFinite(until)?Math.max(now+1500,until):now+30000;
    }
    blocked=new PositionApiError(code,false,details);
    throw blocked;
  }
  async function request(url,method='GET',body) {
    if(blocked)throw blocked;
    const delay=1500-(clock.now()-lastFinishedAt);
    if(delay>0)await clock.sleep(delay);
    if(blocked)throw blocked;
    if(!sessionHeaders.authorization)throw new PositionApiError('session-auth-unavailable',true);
    // Never propagate CDP exceptions: they can contain the evaluated expression.
    const expression=`(async()=>{const start=performance.now();const r=await fetch(${JSON.stringify(url)},
      {method:${JSON.stringify(method)},credentials:'same-origin',headers:${JSON.stringify(sessionHeaders)},
      ${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}
      signal:AbortSignal.timeout(${timeoutMs})});let body;try{body=await r.json()}catch{}
      return {status:r.status,body,retryAfter:r.headers.get('retry-after'),elapsedMs:performance.now()-start}})()`;
    let value;
    try {
      const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},{timeoutMs:timeoutMs+2000});
      if(result.exceptionDetails || !result.result?.value)throw Error();
      value=result.result.value;
    } catch {throw new PositionApiError('position-transport-unavailable');}
    finally {lastFinishedAt=clock.now();}
    if(value.status===429 || value.status===503)
      stop(value.status===429?'position-rate-limited':'position-service-unavailable',value.status,value.retryAfter??'');
    if(value.status===401 || value.status===403)stop('position-access-denied',value.status);
    if(value.status===200 && (!value.body || typeof value.body!=='object'))stop('position-response-unrecognized',value.status);
    return value;
  }
  async function readGraph() {
    const result=await request(read.href),graph=result.body?.data?.canvas;
    if(result.status!==200 || result.body?.code!==0 || graph?.id!==canvasId ||
      !Array.isArray(graph.nodes) || !Array.isArray(graph.connections) ||
      new Set(graph.nodes.map(n=>n.id)).size!==graph.nodes.length ||
      new Set(graph.connections.map(e=>e.id)).size!==graph.connections.length ||
      graph.nodes.some(n=>!n.id || !near(n.position,n.position)))
      throw new PositionApiError('position-read-unavailable');
    return {graph,elapsedMs:result.elapsedMs};
  }
  async function moveChecked(plan,expected) {
    if(blocked)throw blocked;
    if(!sessionHeaders.authorization)throw new PositionApiError('session-auth-unavailable',true);
    if(!Array.isArray(plan) || !plan.length || new Set(plan.map(p=>p.id)).size!==plan.length ||
      plan.some(p=>!ordinary(p.id) || ![p.x,p.y].every(Number.isFinite)))
      throw new PositionApiError('invalid-position-plan');
    let initial;
    try {initial=await readGraph();} catch {
      if(blocked)throw blocked;
      throw new PositionApiError('position-preflight-unavailable',true);
    }
    const before=initial.graph,prior=new Map(before.nodes.map(n=>[n.id,n])),targets=new Map(plan.map(p=>[p.id,p]));
    if(!expected?.nodes || before.nodes.length!==expected.nodes.length || expected.nodes.some(n=>!near(prior.get(n.id)?.position,n)) ||
      stable(before.connections.map(e=>e.id).sort())!==stable((expected.edges||[]).map(e=>e.id).sort()))
      throw new PositionApiError('server-ui-position-mismatch');
    if(plan.some(p=>!prior.has(p.id) || !['image','video'].includes(prior.get(p.id).type) || prior.get(p.id).parent_id))
      throw new PositionApiError('unsupported-position-node');
    const pending=plan.filter(p=>!near(prior.get(p.id).position,p));
    if(!pending.length)return {completedIds:plan.map(p=>p.id),pendingIds:[],writeAttempted:false,reason:null};
    let reply,reason=null;
    try {
      reply=await request(write.href,'POST',{canvas_id:canvasId,actions:[{action:'update',updates:
        pending.map(({id,x,y})=>({id,position:{x,y}}))}],created_by_role:'user'});
      if(reply.status!==200 || reply.body?.code!==0)reason='position-write-rejected';
    } catch {
      if(blocked){blocked.writeAttempted=true;throw blocked;}
      reason='position-write-unavailable';
    }
    // A failed/late reply may have committed. Read once before any UI fallback.
    let final;
    try {final=await readGraph();} catch {
      if(blocked){blocked.writeAttempted=true;throw blocked;}
      throw new PositionApiError('position-outcome-unknown',false,{writeAttempted:true});
    }
    const after=final.graph;
    const nodeIdentity=n=>omit(n,['position','updated_at','selected']);
    const edges=g=>stable(g.connections.map(e=>omit(e,['updated_at','selected'])).sort((a,b)=>a.id.localeCompare(b.id)));
    if(before.name!==after.name || before.nodes.length!==after.nodes.length || edges(before)!==edges(after) ||
      after.nodes.some(n=>!prior.has(n.id) || stable(nodeIdentity(n))!==stable(nodeIdentity(prior.get(n.id))) ||
        (!near(n.position,prior.get(n.id).position) && !near(n.position,targets.get(n.id)))))
      throw new PositionApiError('position-graph-changed',false,{writeAttempted:true});
    const completedIds=plan.filter(p=>near(after.nodes.find(n=>n.id===p.id)?.position,p)).map(p=>p.id);
    const pendingIds=plan.filter(p=>!completedIds.includes(p.id)).map(p=>p.id);
    return {completedIds,pendingIds,writeAttempted:true,reason:reason || (pendingIds.length?'position-partial-readback':null),
      requestMs:reply?.elapsedMs,readbackMs:final.elapsedMs};
  }
  async function move(plan,expected) {
    if(busy)throw new PositionApiError('position-api-busy');
    busy=true;
    try {return await moveChecked(plan,expected);}
    catch(error) {
      if(error instanceof PositionApiError && !error.safeToFallback)blocked=error;
      throw error;
    } finally {busy=false;}
  }
  return {move,dispose(){for(const key of Object.keys(sessionHeaders))delete sessionHeaders[key];}};
}
