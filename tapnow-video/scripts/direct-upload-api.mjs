import {readFile,stat} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {recordTapnowEvent} from './diagnostics.mjs';

const origin='https://app.tapnow.ai';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const idPattern=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const cleanNode=n=>Object.fromEntries(Object.entries(n).filter(([k])=>!['updated_at','selected'].includes(k)));
const localFileLimit=8*1024*1024,browserFileLimit=640*1024;

export class DirectUploadError extends Error {
  constructor(code,details={}) {super(code);this.code=code;Object.assign(this,details);}
}

// Opt-in: caller must have observed this contract and these headers in the current UI.
// A transport failure after a write starts locks this instance; there are no retries.
export function createDirectUploadApi({cdp,headers,initUrl,storageTransport='browser',timeoutMs=15000,fetchImpl=fetch,
  clock={now:()=>Date.now(),sleep:ms=>new Promise(r=>setTimeout(r,ms))}}={}) {
  if(initUrl!==origin+'/api/files/upload-urls' || typeof cdp?.send!=='function' ||
    !['local','browser'].includes(storageTransport) || typeof fetchImpl!=='function' ||
    typeof clock?.now!=='function' || typeof clock?.sleep!=='function' || !Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>30000)
    throw new DirectUploadError('unverified-upload-contract',{safeToFallback:true});
  // Keep the base64 payload sent to the browser tool below 1 MiB.
  const fileLimit=storageTransport==='browser'?browserFileLimit:localFileLimit;
  const auth={},allowed=['authorization','content-type','x-org-id','x-tapnow-origin','x-tap-client-runtime','x-tap-client-version'];
  for(const [k,v] of Object.entries(headers||{}))
    if(allowed.includes(k.toLowerCase()) && typeof v==='string')auth[k.toLowerCase()]=v;
  if(!auth.authorization)throw new DirectUploadError('session-auth-unavailable',{safeToFallback:true});
  auth['content-type']='application/json';
  let busy=false,blocked=null,lastFinished=-Infinity,pending={};
  const stop=(code,details={})=>{blocked=new DirectUploadError(code,{...pending,...details,safeToFallback:false});throw blocked;};
  async function paced(fn) {
    if(blocked)throw blocked;
    const delay=1500-(clock.now()-lastFinished);if(delay>0)await clock.sleep(delay);
    if(blocked)throw blocked;
    try {return await fn();} finally {lastFinished=clock.now();}
  }
  function checkStatus(value,stage) {
    if([429,503].includes(value?.status)) {
      const raw=String(value.retryAfter??'').trim(),now=clock.now();
      const at=/^\d+$/.test(raw)?now+Number(raw)*1000:Date.parse(raw);
      stop(stage+'-rate-or-service-stop',{httpStatus:value.status,
        retryAt:Number.isFinite(at)?Math.max(now+1500,at):now+30000});
    }
    if([401,403].includes(value?.status))stop(stage+'-access-denied',{httpStatus:value.status});
    if(value?.status!==200 || value.body?.code!==0)
      stop(stage+'-response-unrecognized',{httpStatus:value?.status,
        businessCode:Number.isInteger(value?.body?.code)?value.body.code:undefined});
    return value.body.data;
  }
  async function app(path,method='GET',body) {
    const expression=`(async()=>{const r=await fetch(${JSON.stringify(origin+path)},
      {method:${JSON.stringify(method)},credentials:'same-origin',redirect:'error',headers:${JSON.stringify(auth)},
      ${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}signal:AbortSignal.timeout(${timeoutMs})});
      let body;try{body=await r.json()}catch{}return {status:r.status,body,retryAfter:r.headers.get('retry-after')}})()`;
    return paced(async()=>{
      let result;
      try {result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},{timeoutMs:timeoutMs+2000});}
      catch {stop('upload-app-transport-unknown');}
      if(result?.exceptionDetails || !result?.result?.value)stop('upload-app-transport-unknown');
      return result.result.value;
    });
  }
  async function original(url,bytes,hash) {
    return paced(async()=>{
      let r;
      try {r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
      catch {stop('original-transport-unavailable');}
      if([429,503].includes(r.status))checkStatus({status:r.status,retryAfter:r.headers.get('retry-after')},'original');
      if(!r.ok)stop('original-readback-rejected',{httpStatus:r.status});
      const length=r.headers.get('content-length');
      if(length!==null && Number(length)!==bytes.length)stop('original-size-mismatch');
      const parts=[];let size=0;
      try {
        const reader=r.body.getReader();
        try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
          if(size>bytes.length)throw Error();parts.push(value);}}
        finally {await reader.cancel().catch(()=>{});}
      } catch {stop('original-readback-incomplete');}
      if(size!==bytes.length || sha(Buffer.concat(parts))!==hash)stop('original-hash-mismatch');
    });
  }
  async function put(signed,headers,bytes) {
    return paced(async()=>{
      let status,retryAfter;
      if(storageTransport==='browser') {
        // The payload and the signed address are never printed or persisted.
        // Use the browser's network path without opening a system file chooser.
        const expression=`(async()=>{try{const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));
          const r=await fetch(${JSON.stringify(signed)},{method:'PUT',credentials:'omit',redirect:'error',headers:${JSON.stringify(headers)},
          body:bytes,signal:AbortSignal.timeout(${timeoutMs})});return {status:r.status,retryAfter:r.headers.get('retry-after')};
          }catch(e){return {timedOut:e.name==='TimeoutError'}}})()`;
        let reply;try {reply=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},{timeoutMs:timeoutMs+2000});}
        catch {stop('upload-transfer-outcome-unknown');}
        const value=reply?.result?.value;
        if(reply?.exceptionDetails || !Number.isInteger(value?.status))stop('upload-transfer-outcome-unknown',
          {transportCode:value?.timedOut?'BROWSER_TIMEOUT':'BROWSER_STORAGE_UNAVAILABLE'});
        ({status,retryAfter}=value);
      } else {
        let r;try {r=await fetchImpl(signed,{method:'PUT',headers,body:bytes,
          redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch(e) {
          const code=e.cause?.code??e.code;
          stop('upload-transfer-outcome-unknown',{transportCode:/^[A-Z_\d]{1,64}$/.test(code||'')?code:undefined});
        }
        status=r.status;retryAfter=r.headers.get('retry-after');
        try {await r.body?.cancel();}catch {stop('upload-transfer-outcome-unknown');}
      }
      if([429,503].includes(status))checkStatus({status,retryAfter},'storage');
      if(status<200 || status>=300)stop('upload-transfer-rejected',{httpStatus:status});
    });
  }
  function canvasRoute(canvas) {
    if(!canvas || !idPattern.test(canvas.id) || canvas.readUrl!==origin+'/api/canvas/v1/canvases/'+canvas.id+'?with_nodes=true&with_connections=true' ||
      canvas.writeUrl!==origin+'/api/canvas/v1/canvases/'+canvas.id+'/nodes:batchActions')
      throw new DirectUploadError('unverified-upload-canvas',{safeToFallback:true});
    return '/api/canvas/v1/canvases/'+canvas.id;
  }
  async function graph(canvas,path) {
    const g=checkStatus(await app(path+'?with_nodes=true&with_connections=true'),'canvas-read')?.canvas;
    if(g?.id!==canvas.id || !Array.isArray(g.nodes) || !Array.isArray(g.connections) ||
      new Set(g.nodes.map(n=>n.id)).size!==g.nodes.length || new Set(g.connections.map(e=>e.id)).size!==g.connections.length)
      stop('upload-canvas-unrecognized');
    return g;
  }
  async function upload({file,canvas,videoDimensions}={}) {
    if(blocked)throw blocked;
    if(busy)throw new DirectUploadError('upload-api-busy',{safeToFallback:false});
    busy=true;pending={};const start=clock.now(),timings={};
    try {
      if(typeof file!=='string' || !isAbsolute(file))throw new DirectUploadError('absolute-upload-path-required',{safeToFallback:true});
      let bytes;try {const info=await stat(file);if(info.isFile() && info.size<=fileLimit)bytes=await readFile(file);}
      catch {throw new DirectUploadError('upload-file-unavailable',{safeToFallback:true});}
      const filename=basename(file),ext=filename.toLowerCase().match(/\.[^.]+$/)?.[0];
      const mimeType=ext==='.png'?'image/png':['.jpg','.jpeg'].includes(ext)?'image/jpeg':ext==='.mp4'?'video/mp4':null;
      const magic=!bytes?false:mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
        mimeType==='image/jpeg'?bytes[0]===255 && bytes[1]===216 && bytes[2]===255:
        mimeType==='video/mp4'?bytes.toString('ascii',4,8)==='ftyp':false;
      if(!mimeType || !magic || bytes.length<12 || bytes.length>fileLimit)
        throw new DirectUploadError('unsupported-single-put-file',{safeToFallback:true});
      const video=mimeType==='video/mp4',type=video?'video':'image';
      if(canvas && video && ![videoDimensions?.width,videoDimensions?.height].every(n=>Number.isInteger(n) && n>0 && n<=16384))
        throw new DirectUploadError('verified-video-dimensions-required',{safeToFallback:true});
      const canvasPath=canvas?canvasRoute(canvas):null;
      const before=canvas?await graph(canvas,canvasPath):null;
      // Place outside the entire current envelope; no existing node is moved.
      let position;
      if(before) {
        const byId=new Map(before.nodes.map(n=>[n.id,n]));
        function world(n,seen=new Set()) {
          if(!n || seen.has(n.id) || ![n.position?.x,n.position?.y].every(Number.isFinite))return {x:NaN,y:NaN};
          if(!n.parent_id)return n.position;
          seen.add(n.id);const parent=world(byId.get(n.parent_id),seen);
          return {x:n.position.x+parent.x,y:n.position.y+parent.y};
        }
        const boxes=before.nodes.map(n=>({...world(n),width:Math.max(n.measured?.width||0,n.dimensions?.width||0,500)}));
        const right=Math.max(0,...boxes.map(n=>n.x+n.width)),top=Math.min(0,...boxes.map(n=>n.y));
        if(!Number.isFinite(right)||!Number.isFinite(top))throw new DirectUploadError('upload-canvas-position-unrecognized',{safeToFallback:true});
        position={x:Math.round((right+160)*100)/100,y:Math.round(top*100)/100};
      }
      const hash=sha(bytes);let phase=clock.now();
      pending={stage:'init',writeAttempted:true};
      const d=checkStatus(await app('/api/files/upload-urls','POST',{file_name:filename,mime_type:mimeType,
        file_hash:hash,file_size:bytes.length,is_temporary:false,keep_original_filename:false,forbid_overwrite:false,
        is_resumable_mode:false,part_size:8388608}),'upload-init');
      if(idPattern.test(d?.file_id))pending.fileId=d.file_id;
      if(!pending.fileId || d.upload_strategy!=='single_put')stop('upload-strategy-unverified');
      let signed;try {signed=new URL(d.upload_url);}catch {stop('upload-destination-unverified');}
      const storageHeaders=Object.entries(d.headers||{});
      if(signed.origin!=='https://storage.googleapis.com' || signed.username || signed.password || signed.hash ||
        !signed.searchParams.get('X-Goog-Signature') || !storageHeaders.length || storageHeaders.some(([k,v])=>!['content-type','cache-control'].includes(k.toLowerCase()) || typeof v!=='string') ||
        !storageHeaders.some(([k,v])=>k.toLowerCase()==='content-type' && v===mimeType))stop('upload-destination-unverified');
      timings.initMs=clock.now()-phase;phase=clock.now();pending.stage='transfer';
      await put(signed.href,Object.fromEntries(storageHeaders),bytes);
      timings.transferMs=clock.now()-phase;phase=clock.now();pending.stage='complete';
      checkStatus(await app('/api/files/upload-urls/'+d.file_id+'/complete','PUT'),'upload-complete');
      timings.completeMs=clock.now()-phase;phase=clock.now();pending.stage='original';
      const url='https://files.tapnow.media/api/conversation/storage/uploads/'+d.file_id;
      await original(url,bytes,hash);timings.originalMs=clock.now()-phase;
      const result={ok:true,fileId:d.file_id,url,filename,mimeType,bytes:bytes.length,sha256:hash,verifiedOriginal:true,storageTransport,timings};
      if(canvas) {
        const node={id:type+'-'+randomUUID(),canvas_id:canvas.id,type,data:{src:url,...(video?{}:{prompt:''}),
          title:filename.replace(/\.[^.]+$/,''),type:'upload'},position,
          measured:{width:video?Math.max(1,Math.round(videoDimensions.width/videoDimensions.height*250)):250,height:250}};
        pending={...pending,stage:'node-create',nodeId:node.id};phase=clock.now();
        checkStatus(await app(canvasPath+'/nodes:batchActions','POST',{canvas_id:canvas.id,
          actions:[{action:'create',creates:[node]}],created_by_role:'user'}),'upload-node-create');
        const after=await graph(canvas,canvasPath),added=after.nodes.find(n=>n.id===node.id);
        const oldIds=new Set(before.nodes.map(n=>n.id));
        const byId=(a,b)=>a.id.localeCompare(b.id);
        if(before.name!==after.name || after.nodes.length!==before.nodes.length+1 || stable([...before.connections].sort(byId))!==stable([...after.connections].sort(byId)) ||
          before.nodes.some(n=>stable(cleanNode(n))!==stable(cleanNode(after.nodes.find(a=>a.id===n.id)||{}))) ||
          after.nodes.some(n=>!oldIds.has(n.id) && n.id!==node.id) || added?.data?.src!==url || added?.type!==type ||
          added?.data?.title!==node.data.title || stable(added.position)!==stable(node.position))stop('upload-canvas-readback-mismatch');
        result.nodeId=node.id;result.canvasId=canvas.id;result.position=node.position;
        result.priorNodes=before.nodes.map(n=>({id:n.id,position:n.position}));result.priorEdgeIds=before.connections.map(e=>e.id);
        timings.canvasMs=clock.now()-phase;
      }
      result.wallMs=clock.now()-start;pending={};return result;
    } catch(error) {
      const {httpStatus}=error || {};
      const reason=[429,503].includes(httpStatus)?'rate-or-service-stop':
        [401,403].includes(httpStatus)?'access-denied':'unverified';
      await recordTapnowEvent({operation:'upload',route:storageTransport+'-api',stage:pending.stage||'preflight',
        outcome:pending.writeAttempted?'uncertain':'failed',reason,httpStatus,
        elapsedMs:clock.now()-start,mutationMayBeInFlight:pending.writeAttempted===true});
      if(error instanceof DirectUploadError) {if(!error.safeToFallback)blocked=error;throw error;}
      if(pending.writeAttempted)stop('upload-outcome-unknown');
      throw new DirectUploadError('upload-preflight-failed',{safeToFallback:true});
    } finally {busy=false;}
  }
  return {upload,dispose(){for(const k of Object.keys(auth))delete auth[k];blocked=new DirectUploadError('upload-api-disposed',{safeToFallback:false});}};
}
