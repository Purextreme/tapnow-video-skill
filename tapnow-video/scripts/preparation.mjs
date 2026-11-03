// Capability routing and timing. No generation tool is ever invoked here.
import {compareCanvas} from './canvas-geometry.mjs';
import {recordTapnowEvent} from './diagnostics.mjs';
export function routePreparation(catalog, request) {
  const tools = catalog?.tools || catalog?.catalog?.tools || {};
  const toolName=request.kind==='image'?'create_image':'create_video';
  const endpoint = Object.values(tools).find(t => t.name === toolName);
  const p = endpoint?.inputSchema?.properties || {};
  const reasons = ['Preparation must not call a paid generation tool'];
  if (!endpoint) reasons.push('MCP has no '+toolName+' tool');
  if (request.operation === 'extend') reasons.push('Continue-video draft requires browser controls');
  for (const [key, value] of Object.entries(request.parameters || {})) {
    if (!(key in p)) reasons.push('MCP does not expose parameter: ' + key);
    else if (p[key].enum && !p[key].enum.includes(value)) reasons.push('Exact value unavailable in MCP: ' + key + '=' + value);
  }
  return {queryRoute: 'mcp', preparationRoute: 'browser',
    reasons, modelChoices: p.model?.enum || [], generationCalled: false};
}
export class PreparationTimer {
  constructor({clock = () => performance.now(), label = 'prepare', budgetMs = 20000} = {}) {
    this.clock = clock; this.label = label; this.budgetMs = budgetMs;
    this.started = clock(); this.stages = []; this.finished = null;
  }
  async stage(name, operation) {
    if (this.finished) throw Error('Timer already finished.');
    const start = this.clock();
    try { const value = await operation(); this.stages.push({name,ms:this.clock()-start,ok:true}); return value; }
    catch (error) { this.stages.push({name,ms:this.clock()-start,ok:false,error:String(error.message||error)}); throw error; }
  }
  finish(evidence) {
    if (!this.finished) {
      const elapsedMs = this.clock() - this.started;
      this.finished = {label:this.label, elapsedMs, stages:this.stages,
        unaccountedMs: Math.max(0,elapsedMs-this.stages.reduce((n,s)=>n+s.ms,0)),
        within20Seconds: elapsedMs <= this.budgetMs, generationCalled:false, evidence};
    }
    return this.finished;
  }
}
export function classifyFailure({message = '', pageText = '', mutationMayBeInFlight = false} = {}) {
  const text = message + '\n' + pageText;
  let kind = /Object storage upload failed/i.test(text) ? 'upload-terminal' :
    /ERR_|Unable to load|network|Failed to fetch|502|503|504|connection|socket/i.test(text) ? 'network-or-page' :
    /not attached|detached|closed|stale|Debugger/i.test(text) ? 'browser-session' :
    /ambiguous|no_matches|selector|locator|missing|deadline/i.test(text) ? 'control-or-readiness' : 'unknown';
  return {kind, retryMutation:false, safeReadOnlyProbe:true,
    refreshAllowed: !mutationMayBeInFlight && kind === 'network-or-page',
    next: mutationMayBeInFlight ? 'Inspect the original task or upload; do not replay it.' :
      kind === 'control-or-readiness' ? 'Inspect one fresh bounded DOM/AX state and its postcondition.' :
      'Read the same target once; check the browser connection/page before changing the script.'};
}

// Call this once from cua_repl after loading the controller and a validated request.
// startMs may be captured before MCP preflight so tool/model hand-off time is included.
export async function runPreparedFlow({controller, request, startMs = Date.now(), mcpMs = 0}) {
  const browserStarted=Date.now();
  let before;
  try {before=await controller.readCanvas();}
  catch(error) {
    await recordTapnowEvent({operation:'prepare',route:'dom',stage:'canvas-read',outcome:'failed',
      reason:classifyFailure({message:String(error?.message||error)}).kind,elapsedMs:Date.now()-startMs});
    throw error;
  }
  let stage='configure';
  controller.lastDraft=request.draft||null;
  try {
    if(controller.dismissKnownOverlay)await controller.dismissKnownOverlay();
    await controller.collapseChat();
    const actions={frames:'prepareFrames',reference:'prepareReference',image:'prepareImage',extend:'prepareExtend',upscale:'prepareUpscale'};
    const action=actions[request.kind||'frames'];
    if(!action)throw Error('Unknown preparation kind');
    const result=await controller[action](request);
    stage='audit';
    const after=await controller.readCanvas();
    const originalNodesMoved=before.nodes.filter(n=>{
      if (n.id===request.draft?.id) return false;
      const a=after.nodes.find(x=>x.id===n.id);
      return !a || Math.abs(a.x-n.x)>.1 || Math.abs(a.y-n.y)>.1 || a.title!==n.title;
    }).map(n=>n.id);
    const removedEdges=before.edges.filter(e=>!after.edges.some(a=>a.id===e.id && a.label===e.label));
    const protectedIds=new Set(before.nodes.filter(n=>n.id!==request.draft?.id).map(n=>n.id));
    const originalAudit=compareCanvas(
      {nodes:before.nodes.filter(n=>protectedIds.has(n.id)),edges:before.edges},
      {nodes:after.nodes.filter(n=>protectedIds.has(n.id)),edges:after.edges.filter(e=>before.edges.some(b=>b.id===e.id))},[]);
    if (originalNodesMoved.length || removedEdges.length || !originalAudit.ok)
      throw Error('Original canvas changed: '+JSON.stringify({originalNodesMoved,removedEdges,originalAudit}));
    const completed=Date.now();
    if(completed-startMs>20000)await recordTapnowEvent({operation:'prepare',route:'dom',stage,outcome:'slow',
      reason:'budget',elapsedMs:completed-startMs});
    return {ok:true,kind:request.kind||'frames-new-draft',browserMs:completed-browserStarted,
      fullWallMs:completed-startMs,mcpMs,within20Seconds:completed-startMs<=20000,
      originalNodesMoved,originalAudit,nodeCountBefore:before.nodes.length,nodeCountAfter:after.nodes.length,
      edgeCountBefore:before.edges.length,edgeCountAfter:after.edges.length,result,generationCalled:false};
  } catch(error) {
    const completed=Date.now();
    await recordTapnowEvent({operation:'prepare',route:'dom',stage,outcome:'failed',
      reason:classifyFailure({message:String(error?.message||error)}).kind,elapsedMs:completed-startMs});
    return {ok:false,kind:request.kind||'frames-new-draft',browserMs:completed-browserStarted,
      fullWallMs:completed-startMs,mcpMs,error:String(error.message||error),draft:controller.lastDraft,generationCalled:false};
  }
}
