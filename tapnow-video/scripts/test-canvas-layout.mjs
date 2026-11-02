import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createLayoutRunner} from './canvas-layout.mjs';
import {TapnowPreparation} from './browser-actions.mjs';
import {compareCanvas,collisionPairs} from './canvas-geometry.mjs';

const node=(id,x,y)=>({id,x,y,width:100,height:60,title:'Video',primaryMedia:[],selected:false});
function fixture(count=3) {
  const before={nodes:Array.from({length:count},(_,i)=>node('video-n'+i,(i%8)*220,Math.floor(i/8)*180)),
    edges:Array.from({length:count},(_,i)=>({id:'edge-'+i,label:'n'+i+' to n'+((i+1)%count)})),
    viewport:{x:0,y:0,width:1200,height:900,scale:.5}};
  before.nodes.push(node('image-protected',-1000,-1000));
  const canvas=structuredClone(before),calls=[];
  const controller={readCanvas:async()=>structuredClone(canvas),selectNodes:async([id])=>{
    calls.push(['select',id]);canvas.nodes.forEach(n=>n.selected=n.id===id);return controller.readCanvas();
  },dragSelected:async([id],delta)=>{
    calls.push(['drag',id]);const n=canvas.nodes.find(n=>n.id===id);n.x+=delta.dx;n.y+=delta.dy;return controller.readCanvas();
  },moveSelected:async([id],delta)=>{
    calls.push(['fine',id]);const n=canvas.nodes.find(n=>n.id===id);n.x+=delta.dx;n.y+=delta.dy;return controller.readCanvas();
  }};
  const plan=before.nodes.slice(0,count).map(n=>({id:n.id,x:n.x+3000,y:n.y}));
  return {before,canvas,controller,plan,calls};
}

test('synthetic 80-node cyclic graph batches by ID despite duplicate titles',async()=>{
  const f=fixture(80),runner=createLayoutRunner(f);
  const partial=await runner.moveNodes(f.plan.slice(0,30).map(p=>p.id));
  assert.equal(partial.pending.length,50);
  const result=await runner.moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,80);assert.deepEqual(result.pending,[]);
  assert.equal(f.calls.filter(c=>c[0]==='drag').length,80);
  assert.equal(compareCanvas(f.before,f.canvas,f.plan.map(p=>p.id)).ok,true);
  assert.deepEqual(collisionPairs(f.canvas.nodes,80),[]);assert.equal(result.generationCalled,false);
});

test('resume reads a timed-out move instead of replaying it and retains the wall clock',async(t)=>{
  let now=1000;t.mock.method(Date,'now',()=>now);
  const f=fixture(),drag=f.controller.dragSelected;let saved;
  f.controller.dragSelected=async(ids,delta)=>{
    const result=await drag(ids,delta);now+=10;
    if(ids[0]===f.plan[1].id)throw Error('transport timeout after input');
    return result;
  };
  const runner=createLayoutRunner({...f,onProgress:s=>{saved=s;}});
  await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/timeout/);
  assert.equal(saved.completed.length,1);assert.equal(saved.startedAt,1000);
  now+=21000;f.controller.dragSelected=drag;
  const resumed=createLayoutRunner({...f,checkpoint:saved});
  const result=await resumed.moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed[1].recovered,true);
  assert.equal(f.calls.filter(c=>c[0]==='drag').length,3);
  assert.equal(result.fullWallMs,21020);
});

test('invalid IDs, overlapping targets and protected-node collisions stop before input',()=>{
  const f=fixture();
  for(const plan of [[f.plan[0],f.plan[0]],[{...f.plan[0],id:'group-container'}],
    [{...f.plan[0],x:-1000,y:-1000}],f.plan.map(p=>({...p,x:3000,y:0}))])
    assert.throws(()=>createLayoutRunner({...f,plan}));
  assert.deepEqual(f.calls,[]);
});

test('resume rejects a changed plan or a completed node that drifted',async()=>{
  const f=fixture(),runner=createLayoutRunner(f);
  const checkpoint=await runner.moveNodes([f.plan[0].id]);
  assert.throws(()=>createLayoutRunner({...f,checkpoint,plan:f.plan.map(p=>({...p,x:p.x+500}))}),/Checkpoint/);
  f.canvas.nodes[0].x+=20;
  await assert.rejects(createLayoutRunner({...f,checkpoint}).moveNodes([f.plan[1].id]),/Completed node moved/);
  assert.equal(f.calls.filter(c=>c[0]==='drag').length,1);
});

test('a moved outsider or changed edge stops the batch before the next node',async()=>{
  for(const change of [f=>{f.canvas.nodes.at(-1).x+=20;},f=>{f.canvas.edges.pop();},
    f=>{f.canvas.nodes[1].x+=20;}]) {
    const f=fixture(),drag=f.controller.dragSelected;
    f.controller.dragSelected=async(...args)=>{await drag(...args);change(f);return f.controller.readCanvas();};
    await assert.rejects(createLayoutRunner(f).moveNodes(f.plan.map(p=>p.id)),/audit|other nodes/);
    assert.equal(f.calls.filter(c=>c[0]==='drag').length,1);
  }
});

test('short residual movement uses keyboard correction and records the completed node once',async()=>{
  const f=fixture(),drag=f.controller.dragSelected;
  f.controller.dragSelected=(ids,delta)=>drag(ids,{dx:delta.dx-14,dy:delta.dy});
  const runner=createLayoutRunner(f),result=await runner.moveNodes([f.plan[0].id]);
  assert.equal(result.completed.length,1);assert.equal(f.calls.filter(c=>c[0]==='fine').length,1);
  await runner.moveNodes([f.plan[0].id]);assert.equal(f.calls.filter(c=>c[0]==='select').length,1);
});

// Browser callbacks execute against small public-DOM fixtures; native input is
// simulated separately. No app connection or hidden browser state is used.
const rect=(x,y,width,height)=>({x,y,width,height,right:x+width,bottom:y+height});
function panFixture({blocked=false,gain=.85,moveNode=false,resize=false}={}) {
  const canvas={nodes:[node('image-a',0,0)],edges:[],viewport:{x:0,y:0,width:1200,height:900,scale:.5}};
  const r=rect(950,650,200,150),hit={},outside={};
  const wrapper={getBoundingClientRect:()=>r,contains:e=>e===hit,parentElement:null};
  let parent=wrapper;
  // Vary wrapper depth: the navigation handler is not a fixed third ancestor.
  for(let i=0;i<5;i++)parent={getBoundingClientRect:()=>r,contains:()=>false,parentElement:parent};
  const svg={getBoundingClientRect:()=>r,getAttribute:()=>'-4000 -4000 12000 9000',contains:()=>false,parentElement:parent};
  const mini={count:async()=>1,evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(element,arg)',
    {element:svg,arg,document:{elementFromPoint:()=>blocked?outside:hit}})};
  let shots=0,drags=0;
  const c=new TapnowPreparation({tab:{playwright:{locator:()=>mini}},native:{getScreenshot:async()=>{shots++;},drag:async(a,b)=>{
    drags++;canvas.viewport.x-=(b[0]-a[0])*60*.5*gain;canvas.viewport.y-=(b[1]-a[1])*60*.5*gain;
    if(moveNode)canvas.nodes[0].x+=20;if(resize)canvas.viewport.width+=100;
  }}});
  c.readCanvas=async()=>structuredClone(canvas);
  return {c,counts:()=>({shots,drags})};
}

test('minimap pan measures gain through a same-size wrapper and changes only the view',async()=>{
  const f=panFixture(),after=await f.c.panTo(400,200);
  assert.ok(Math.abs(after.viewport.x-400)<12 && Math.abs(after.viewport.y-200)<12);
  assert.equal(f.counts().drags,2);assert.equal(f.counts().shots,2);assert.equal(after.nodes[0].x,0);
});

test('occluded minimap, absent displacement, node movement and resize never cause blind retries',async()=>{
  for(const [options,pattern,drags] of [[{blocked:true},/occluded/,0],[{gain:0},/not observed/,1],
    [{moveNode:true},/Pan changed nodes/,1],[{resize:true},/Viewport changed/,1]]) {
    const f=panFixture(options);await assert.rejects(f.c.panTo(400,200),pattern);assert.equal(f.counts().drags,drags);
  }
});

function dragFixture({gain=1,extraSelection=false}={}) {
  const canvas={nodes:[{...node('image-a',100,100),selected:true},node('image-b',2000,0)],edges:[],
    viewport:{x:0,y:0,width:1200,height:900,scale:1}};
  let shots=0,drags=0;
  const e={getBoundingClientRect:()=>rect(197,97,100,60)};
  const hit={closest:selector=>selector==='.react-flow__node'?e:null};
  const c=new TapnowPreparation({tab:{playwright:{getByRole:()=>({count:async()=>0})}},native:{
    getScreenshot:async()=>{shots++;},drag:async(a,b)=>{drags++;canvas.nodes[0].x+=(b[0]-a[0])*gain;
      canvas.nodes[0].y+=(b[1]-a[1])*gain;if(extraSelection)canvas.nodes[1].selected=true;}}});
  c.readCanvas=async()=>structuredClone(canvas);
  c.node=()=>({evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')(element)',{element:e,document:{elementFromPoint:()=>hit}})});
  return {c,counts:()=>({shots,drags})};
}

test('drag resets an unsafe learned gain before input and refreshes native mapping',async()=>{
  const f=dragFixture();f.c.dragGain=.5;
  const after=await f.c.dragSelected(['image-a'],{dx:900,dy:0});
  assert.equal(after.nodes[0].x,1000);assert.equal(f.c.dragGain,1);assert.deepEqual(f.counts(),{shots:1,drags:1});
});

test('drag stops on a changed selection or no displacement and refuses an unreachable target',async()=>{
  for(const options of [{extraSelection:true},{gain:0}]) {
    const f=dragFixture(options);await assert.rejects(f.c.dragSelected(['image-a'],{dx:500,dy:0}),/selection|did not move/);
    assert.equal(f.counts().drags,1);
  }
  const f=dragFixture();await assert.rejects(f.c.dragSelected(['image-a'],{dx:3000,dy:0}),/outside viewport/);
  assert.equal(f.counts().drags,0);
});

test('own image identity excludes selected-editor icons and sources, but detects asset replacement',async()=>{
  let asset='original',expanded=true;
  const media=(testid,src,editor=false)=>({tagName:'IMG',getAttribute:k=>({src,'data-testid':testid,alt:''})[k]??null,
    closest:()=>editor?{}:null});
  const e={style:{transform:'translate(0px, 0px)',width:'100px',height:'60px'},classList:{contains:()=>false},
    getBoundingClientRect:()=>rect(10,20,50,30),getAttribute:()=> 'image-a',querySelector:()=>null,
    querySelectorAll:selector=>{
      const all=[media('canvas-node-image-content','https://files/uploads/'+asset)];
      if(expanded)all.push(media(null,'https://files/lens-icon.svg'),media(null,'https://files/uploads/reference',true));
      return all.filter(m=>selector.split(',').some(s=>s.trim()==='img' || s.trim()==='[data-testid="'+m.getAttribute('data-testid')+'"]'));
    }};
  const document={querySelector:()=>({style:{transform:'translate(10px, 20px) scale(0.5)'}}),
    querySelectorAll:selector=>selector==='.react-flow__node[data-id]'?[e]:[]};
  const c=new TapnowPreparation({tab:{playwright:{evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')()',
    {document,innerWidth:1200,innerHeight:900})}}});
  const before=JSON.parse(JSON.stringify(await c.readCanvas()));
  assert.equal(before.nodes[0].primaryMedia.length,1);assert.equal(before.nodes[0].media.length,3);
  expanded=false;const after=JSON.parse(JSON.stringify(await c.readCanvas()));
  assert.equal(compareCanvas(before,after).ok,true);
  asset='replacement';assert.equal(compareCanvas(before,JSON.parse(JSON.stringify(await c.readCanvas()))).ok,false);
});
