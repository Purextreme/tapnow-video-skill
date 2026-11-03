import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,isAbsolute} from 'node:path';
import {uploadTapnowFiles} from './upload-files.js';
import {recordTapnowEvent} from './diagnostics.mjs';

// Current, observed canvas Upload menu. PNG is the live-verified scope.
const snapshot=(tab,knownIds=null)=>tab.playwright.evaluate(known=>{
  const ids=new Set(known||[]);
  return {
    ready:Boolean(document.querySelector('.react-flow')),
    nodes:[...document.querySelectorAll('.react-flow__node')].map(n=>({
      id:n.getAttribute('data-id'),transform:n.style.transform,
      ...(known && !ids.has(n.getAttribute('data-id'))?{
        text:n.innerText,inputs:[...n.querySelectorAll('input')].map(i=>i.value),
        images:[...n.querySelectorAll('img')].map(i=>({src:i.currentSrc,ready:i.complete && i.naturalWidth>0})),
      }:{}),
    })),
    edges:[...document.querySelectorAll('.react-flow__edge')].map(e=>e.getAttribute('data-id')).sort(),
  };
},knownIds);

const samePosition=(a,b)=>{
  if(a===b)return true;
  const parse=s=>s.match(/^translate\(([-+\d.e]+)px,\s*([-+\d.e]+)px\)$/i)?.slice(1).map(Number);
  const x=parse(a),y=parse(b);
  return x && y && x.every((v,i)=>Number.isFinite(v) && Number.isFinite(y[i]) && Math.abs(v-y[i])<=.1);
};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function uploadTapnowCanvasImage(tab,{file,completionTimeoutMs=45000}={}) {
  const start=Date.now(),stages=[];
  let attempted=false,newNode,previewReadyMs,originalReadbackMs,verifiedOriginal=false;
  const stopped=async message=>{
    const stage=attempted?'verify':'preflight',fullWallMs=Date.now()-start;
    await recordTapnowEvent({operation:'upload',route:'chooser',stage,outcome:attempted?'uncertain':'failed',
      reason:'unverified',elapsedMs:fullWallMs,mutationMayBeInFlight:attempted});
    return {ok:false,status:'stopped',stage,filesMayBeSet:attempted,message,fullWallMs,stages};
  };
  try {
    if(typeof file!=='string' || !isAbsolute(file) || !/\.png$/i.test(file))
      return stopped('Expected one absolute PNG path; use the generic chooser helper for other formats.');
    if(!Number.isSafeInteger(completionTimeoutMs) || completionTimeoutMs<1000 || completionTimeoutMs>60000)
      return stopped('Invalid completion timeout.');
    const bytes=await readFile(file),filename=basename(file),title=filename.replace(/\.png$/i,'');
    if(bytes.length<8 || bytes.length>10*1024*1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      return stopped('Expected PNG content no larger than 10 MiB.');
    const hash=sha256(bytes),before=await snapshot(tab);
    if(!before.ready || new Set(before.nodes.map(n=>n.id)).size!==before.nodes.length || before.nodes.some(n=>!n.id))
      return stopped('Inspect the original canvas before uploading.');
    const ids=before.nodes.map(n=>n.id),known=new Set(ids);
    const uploadControl=tab.playwright.getByText('Images / Video / Audio / 3D',{exact:true});
    if(await uploadControl.count()!==1 || !await uploadControl.isVisible())
      await tab.playwright.getByTestId('canvas-dockbar-add-node-btn').click();
    await uploadControl.waitFor({state:'visible',timeoutMs:2500});
    const result=await uploadTapnowFiles(tab,{
      files:[file],uploadControl,
      completionTimeoutMs,
      onProgress:e=>{if(e.stage==='set-files' && e.state==='started')attempted=true;stages.push({...e,elapsedMs:Date.now()-start});},
      verifyUpload:async()=>{
        const deadline=Date.now()+completionTimeoutMs;
        while(Date.now()<deadline) {
          const current=await snapshot(tab,ids),currentIds=new Set(current.nodes.map(n=>n.id));
          if(currentIds.size!==current.nodes.length || JSON.stringify(current.edges)!==JSON.stringify(before.edges) ||
            before.nodes.some(n=>!current.nodes.some(m=>m.id===n.id && samePosition(m.transform,n.transform))))
            throw new Error('Canvas identity, links or prior positions changed; inspect the original canvas.');
          const added=current.nodes.filter(n=>!known.has(n.id));
          if(added.length>1)throw new Error('New-node identity is ambiguous; inspect the original upload.');
          const n=added[0],named=n && (n.inputs.includes(title) || n.text.split('\n').includes(title));
          const images=named?n.images.filter(i=>i.ready && i.src.startsWith('https://files.tapnow.media/')):[];
          const sources=[...new Set(images.map(i=>{
            const url=new URL(i.src);
            if(url.host!=='files.tapnow.media' || !/^\/api\/conversation\/storage\/uploads\/[\w-]+$/.test(url.pathname))return '';
            url.searchParams.delete('variant_name');return url.href;
          }).filter(Boolean))];
          if(sources.length>1)throw new Error('The new image has ambiguous media sources.');
          if(sources.length===1) {
            newNode=n;previewReadyMs=Date.now()-start;
            const readStart=Date.now();
            try {
              // Durable content evidence also works after the transfer toast has disappeared.
              const response=await fetch(sources[0],{redirect:'error',signal:AbortSignal.timeout(8000)});
              if(!response.ok)throw new Error();
              const length=response.headers.get('content-length');
              if(length!==null && Number(length)!==bytes.byteLength)throw new Error();
              const reader=response.body.getReader(),parts=[];let size=0;
              try {
                while(true) {
                  const {value,done}=await reader.read();if(done)break;
                  size+=value.byteLength;if(size>bytes.byteLength)throw new Error();parts.push(value);
                }
              } finally {await reader.cancel().catch(()=>{});}
              verifiedOriginal=size===bytes.byteLength && sha256(Buffer.concat(parts))===hash;
              if(!verifiedOriginal)throw new Error();
            } catch {throw new Error('Original-media readback or SHA-256 verification failed; inspect this node without reuploading.');}
            originalReadbackMs=Date.now()-readStart;
            return {complete:true,evidence:'One new named image with loaded preview and matching original size/SHA-256; prior node identities, positions and links retained.'};
          }
          // Condition polling stays local; no screenshots or model calls.
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        throw new Error('Original node not ready by deadline; inspect it without reuploading.');
      },
    });
    return {...result,filename,bytes:bytes.byteLength,nodeId:newNode?.id,verifiedOriginal,
      fullWallMs:Date.now()-start,previewReadyMs,originalReadbackMs,stages};
  } catch {return stopped('Canvas upload preparation failed; inspect the original state before retrying.');}
}
