import test from 'node:test';
import assert from 'node:assert/strict';
import {bounds,collisionPairs,planFreeSpace,overlaps,compareCanvas} from './canvas-geometry.mjs';
import {routePreparation,PreparationTimer,classifyFailure,runPreparedFlow} from './preparation.mjs';
import {TapnowPreparation} from './browser-actions.mjs';
const node=(id,x,y,width=100,height=100)=>({id,x,y,width,height,title:id,media:[]});

test('layout detects outside collisions even when selected nodes are internally tidy',()=>{
  const nodes=[node('a',0,0),node('b',110,0),node('outside',150,50)];
  assert.deepEqual(collisionPairs(nodes),[['b','outside']]);
  assert.equal(overlaps(nodes[0],nodes[1]),false);
});
test('free-space planner fits a visible area and reserves composer room',()=>{
  const nodes=[node('a',0,0),node('b',40,0),node('c',400,0)];
  const p=planFreeSpace(nodes,['a'],{gap:20,paddingTop:20,paddingBottom:80,area:{x:-400,y:-300,width:1200,height:800}});
  assert.ok(nodes.slice(1).every(n=>!overlaps(p.reserved,{...n,y:n.y-20,height:n.height+100},20)));
  assert.ok(p.reserved.x>=-400 && p.reserved.y>=-300);
  assert.throws(()=>planFreeSpace(nodes,['missing']));
  assert.throws(()=>planFreeSpace(nodes,['a','a']));
  assert.throws(()=>planFreeSpace(nodes,['a'],{area:{x:0,y:0,width:1,height:1}}));
  assert.deepEqual(bounds(nodes.slice(0,2)),{x:0,y:0,width:140,height:100});
});
test('canvas audit rejects moved outsiders and changed edges but tolerates preview variants',()=>{
  const before={nodes:[{...node('a',0,0),media:[{src:'https://files/x/uploads/asset-one?variant_name=thumbnail'}]},node('b',400,0)],edges:[{id:'e',label:'a to b'}]};
  const after=structuredClone(before);
  after.nodes[0].x=20; after.nodes[0].media[0].src='https://files/x/uploads/asset-one?variant_name=medium';
  assert.equal(compareCanvas(before,after,['a']).ok,true);
  assert.equal(compareCanvas(before,after,[]).ok,false);
  after.edges=[]; assert.ok(compareCanvas(before,after,['a']).issues.includes('edges-changed'));
  after.nodes[0].media[0].src='https://files/x/uploads/another-asset';
  assert.ok(compareCanvas(before,after,['a']).issues.includes('identity:a'));
});
test('paid MCP endpoint is never a preparation route',()=>{
  const catalog={tools:{video:{name:'create_video',inputSchema:{properties:{model:{enum:['exact-mini']},prompt:{}}}}}};
  const result=routePreparation(catalog,{parameters:{model:'exact-mini'}});
  assert.equal(result.preparationRoute,'browser');
  assert.equal(result.generationCalled,false);
  assert.equal(routePreparation(catalog,{prepareOnly:false,parameters:{model:'exact-mini'}}).preparationRoute,'browser');
  const image=routePreparation({tools:{image:{name:'create_image',inputSchema:{properties:{model:{enum:['Image Pro']}}}}}},{kind:'image'});
  assert.deepEqual(image.modelChoices,['Image Pro']);
  assert.ok(routePreparation(catalog,{prepareOnly:false,parameters:{model:'unknown'}}).reasons.some(r=>r.includes('Exact value unavailable')));
});
test('timer includes orchestration gaps instead of summing stage durations',async()=>{
  let now=0; const timer=new PreparationTimer({clock:()=>now});
  await timer.stage('action',async()=>{now+=1000;}); now+=20000;
  const result=timer.finish({});
  assert.equal(result.elapsedMs,21000); assert.equal(result.unaccountedMs,20000); assert.equal(result.within20Seconds,false);
});
test('failure recovery never replays mutations',()=>{
  assert.equal(classifyFailure({message:'Object storage upload failed'}).kind,'upload-terminal');
  assert.equal(classifyFailure({message:'ERR_CONNECTION_RESET',mutationMayBeInFlight:true}).refreshAllowed,false);
  assert.equal(classifyFailure({message:'Failed to fetch'}).refreshAllowed,true);
  assert.equal(classifyFailure({message:'ambiguous locator'}).retryMutation,false);
});
test('submission buttons are rejected before any press',async()=>{
  let pressed=false;
  const controller=new TapnowPreparation({tab:{},native:{}});
  for(const name of ['Generate','Confirm and generate','Send','Video Upscale','Run Group']){
    const locator={count:async()=>1,evaluate:async()=>({name,testid:null,disabled:false}),press:async()=>{pressed=true;}};
    await assert.rejects(controller.activate(locator),/excluded/);
  }
  assert.equal(pressed,false);
});
test('complete-flow audit fails if an existing node moves',async()=>{
  let reads=0;
  const controller={readCanvas:async()=>({nodes:[node('a',reads++?10:0,0)],edges:[]}),collapseChat:async()=>{},prepareFrames:async()=>({generationCalled:false})};
  const record=await runPreparedFlow({controller,request:{}});
  assert.equal(record.ok,false); assert.match(record.error,/Original canvas changed/);
});
test('viewport and canvas zoom changes invalidate learned keyboard steps',async()=>{
  let state={nodes:[],edges:[],viewport:{width:2048,height:927,scale:.5}};
  const c=new TapnowPreparation({tab:{playwright:{evaluate:async()=>structuredClone(state)}}});
  await c.readCanvas();c.keyboardSteps={shift:20};c.dragGain=.875;
  state.viewport.width=1600;await c.readCanvas();
  assert.deepEqual(c.keyboardSteps,{});assert.equal(c.dragGain,null);
  c.keyboardSteps={shift:20};state.viewport.scale=1;await c.readCanvas();
  assert.deepEqual(c.keyboardSteps,{});
});
test('keyboard movement batches readback, preserves outsiders and restores snapping',async(t)=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const nodes=[{...node('image-a',0,0),selected:true},{...node('image-b',200,0),selected:true},node('image-outside',1000,0)];
  const snap={count:async()=>1,getAttribute:async()=> 'true'};
  const c=new TapnowPreparation({tab:{playwright:{getByRole:()=>snap}}});
  let reads=0,toggles=0;
  c.readCanvas=async()=>{now+=30;reads++;return {nodes:structuredClone(nodes),edges:[],viewport:{scale:.5}};};
  c.activate=async()=>{toggles++;};
  c.node=()=>({press:async(key)=>{
    const step=key.startsWith('Shift+')?20:5;
    for(const n of nodes.filter(n=>n.selected)){
      if(key.endsWith('ArrowRight'))n.x+=step;
      if(key.endsWith('ArrowLeft'))n.x-=step;
      if(key.endsWith('ArrowDown'))n.y+=step;
      if(key.endsWith('ArrowUp'))n.y-=step;
    }
  }});
  const result=await c.moveSelected(['image-a','image-b'],{dx:260,dy:75});
  assert.deepEqual(result.nodes.map(n=>[n.x,n.y]),[[260,75],[460,75],[1000,0]]);
  assert.equal(toggles,2);assert.ok(reads<40,'readback should be per batch, not per key');
});
test('keyboard movement stops on lost selection and restores snapping',async()=>{
  const c=new TapnowPreparation({tab:{playwright:{getByRole:()=>({count:async()=>1,getAttribute:async()=> 'true'})}}});
  let selected=true,toggles=0;
  c.readCanvas=async()=>({nodes:[{...node('image-a',0,0),selected}],edges:[]});
  c.activate=async()=>{toggles++;};c.node=()=>({press:async()=>{selected=false;}});
  await assert.rejects(c.moveSelected(['image-a'],{dx:50,dy:0}),/lost selection/);
  assert.equal(toggles,2);
});
test('a missing source edge with a closed picker never triggers another click',async(t)=>{
  let now=0,clicks=0;t.mock.method(Date,'now',()=>now+=150);
  const c=new TapnowPreparation({tab:{playwright:{locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>0})}}});
  c.chooseCanvasSource=async()=>{clicks++;};c.readCanvas=async()=>({nodes:[],edges:[]});
  await assert.rejects(c.bindCanvasSource('video-a','image-a'),/outcome unknown/);
  assert.equal(clicks,1);
});
test('reference requests run the reference path and preserve the original canvas',async()=>{
  let referenceCalls=0;
  const c={readCanvas:async()=>({nodes:[node('image-a',0,0)],edges:[]}),collapseChat:async()=>{},
    prepareReference:async()=>{referenceCalls++;return {generationCalled:false};},
    prepareFrames:async()=>{throw Error('wrong route');}};
  const record=await runPreparedFlow({controller:c,request:{kind:'reference'}});
  assert.equal(record.ok,true);assert.equal(referenceCalls,1);
});
test('image and upscale requests use their own preparation path',async()=>{
  for(const [kind,method] of [['image','prepareImage'],['upscale','prepareUpscale']]){
    let calls=0;
    const c={readCanvas:async()=>({nodes:[node('image-a',0,0)],edges:[]}),collapseChat:async()=>{},
      [method]:async()=>{calls++;return {generationCalled:false};}};
    assert.equal((await runPreparedFlow({controller:c,request:{kind}})).ok,true);
    assert.equal(calls,1);
  }
});
test('a failed preparation returns the created draft instead of inviting duplicate creation',async()=>{
  const c={readCanvas:async()=>({nodes:[node('image-a',0,0)],edges:[]}),collapseChat:async()=>{},
    prepareImage:async()=>{c.lastDraft={id:'image-draft',title:'draft'};throw Error('picker occluded');}};
  const result=await runPreparedFlow({controller:c,request:{kind:'image'}});
  assert.equal(result.ok,false);assert.equal(result.draft.id,'image-draft');assert.equal(result.generationCalled,false);
});
test('original media replacement fails the preparation audit',async()=>{
  let reads=0;
  const c={readCanvas:async()=>({nodes:[{...node('image-a',0,0),primaryMedia:[{src:'https://files/uploads/'+(reads++?'different':'original')}]}],edges:[]}),
    collapseChat:async()=>{},prepareImage:async()=>({generationCalled:false})};
  const result=await runPreparedFlow({controller:c,request:{kind:'image'}});
  assert.equal(result.ok,false);assert.match(result.error,/identity:image-a/);
});
test('an unverified whole-canvas selection stops without sending Ctrl+A',async()=>{
  const c=new TapnowPreparation({tab:{},native:{}});
  c.readCanvas=async()=>({nodes:[node('image-a',0,0),node('image-b',200,0)],edges:[]});
  c.node=()=>{throw Error('must not send an unverified shortcut');};
  await assert.rejects(c.selectNodes(['image-a','image-b']),/Whole-canvas selection is not verified/);
});
