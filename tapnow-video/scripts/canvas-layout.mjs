// Execute a locally reviewed world-coordinate plan. No stored canvas IDs,
// automatic semantic inference, generation calls or filesystem side effects.
import {compareCanvas,collisionPairs} from './canvas-geometry.mjs';

export function createLayoutRunner({controller,before,plan,checkpoint=null,onProgress,gap=80,startMs=Date.now()}) {
  plan=plan.map(({id,x,y})=>({id,x,y}));
  const ids=plan.map(p=>p.id),scope=new Set(ids);
  if(!ids.length || scope.size!==ids.length || plan.some(p=>! /^(image|video)-[\w-]+$/.test(p.id) ||
    ![p.x,p.y].every(Number.isFinite) || !before.nodes.some(n=>n.id===p.id)) || !Number.isFinite(gap) || gap<0)
    throw Error('Expected unique ordinary node IDs and finite world-coordinate targets');
  const targets=new Map(plan.map(p=>[p.id,p]));
  const expected=before.nodes.map(n=>({...n,...targets.get(n.id)}));
  const collisions=nodes=>collisionPairs(nodes,gap).filter(([a,b])=>scope.has(a)||scope.has(b));
  if(collisions(expected).length)throw Error('Planned layout collides internally or with protected nodes');
  if(checkpoint && (JSON.stringify(checkpoint.plan)!==JSON.stringify(plan) ||
    !Number.isFinite(checkpoint.startedAt) || checkpoint.startedAt>Date.now()))throw Error('Checkpoint does not match this plan');
  const startedAt=checkpoint?.startedAt??startMs;
  if(!Number.isFinite(startedAt) || startedAt>Date.now())throw Error('Invalid layout start time');
  let busy=false;
  const completed=structuredClone(checkpoint?.completed||[]);
  if(new Set(completed.map(r=>r.id)).size!==completed.length || completed.some(r=>!scope.has(r.id)))throw Error('Invalid completed node IDs');
  const near=(n,p)=>n && Math.max(Math.abs(n.x-p.x),Math.abs(n.y-p.y))<=10;
  const state=()=>({startedAt,plan:structuredClone(plan),completed:structuredClone(completed),
    fullWallMs:Date.now()-startedAt,pending:ids.filter(id=>!completed.some(r=>r.id===id))});
  async function checked() {
    const canvas=await controller.readCanvas(),audit=compareCanvas(before,canvas,ids);
    if(!audit.ok)throw Error('Layout identity/edge audit failed: '+JSON.stringify(audit));
    if(completed.some(r=>!near(canvas.nodes.find(n=>n.id===r.id),targets.get(r.id))))
      throw Error('Completed node moved; inspect the checkpoint before resuming');
    return canvas;
  }
  async function save() {if(onProgress)await onProgress(state());}
  async function moveNodes(batchIds) {
    if(busy)throw Error('Only one layout batch may control the canvas');
    if(!batchIds.length || new Set(batchIds).size!==batchIds.length || batchIds.some(id=>!scope.has(id)))throw Error('Batch IDs outside plan or duplicated');
    busy=true;
    try {
      let canvas=await checked();
      await save(); // Persist the clock before input, including a first-node timeout.
      for(const id of batchIds) {
        if(completed.some(r=>r.id===id))continue;
        const p=targets.get(id),start=Date.now(),prior=canvas;
        let n=canvas.nodes.find(n=>n.id===id),selectMs=0,dragMs=0,fineMs=0;
        const recovered=near(n,p);
        if(!recovered) {
          canvas=await controller.selectNodes([id]);
          selectMs=Date.now()-start;
          n=canvas.nodes.find(n=>n.id===id);
          if(!n || !(canvas.viewport?.scale>0))throw Error('Selected node or viewport unavailable');
          const dragStart=Date.now();
          if(Math.hypot(p.x-n.x,p.y-n.y)*canvas.viewport.scale>=16) {
            canvas=await controller.dragSelected([id],{dx:p.x-n.x,dy:p.y-n.y});
            n=canvas.nodes.find(n=>n.id===id);
          }
          dragMs=Date.now()-dragStart;
          const fineStart=Date.now();
          if(!near(n,p)) {
            if(!n)throw Error('Moved node missing; inspect before resuming');
            canvas=await controller.moveSelected([id],{dx:p.x-n.x,dy:p.y-n.y});
          }
          fineMs=Date.now()-fineStart;
        }
        canvas=await checked();
        const audit=compareCanvas(prior,canvas,[id]);
        if(!audit.ok)throw Error('Move changed other nodes: '+JSON.stringify(audit));
        if(!near(canvas.nodes.find(n=>n.id===id),p))throw Error('Node missed layout target: '+id);
        completed.push({id,recovered,elapsedMs:Date.now()-start,selectMs,dragMs,fineMs});
        await save();
      }
      const result=state();
      if(!result.pending.length && collisions(canvas.nodes).length)throw Error('Final layout has collisions');
      return {...result,generationCalled:false};
    } finally {busy=false;}
  }
  return {moveNodes,state};
}
