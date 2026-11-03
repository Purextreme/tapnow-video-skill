import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCanvasPositionApi} from './canvas-position-api.mjs';
import {createLayoutRunner} from './canvas-layout.mjs';

const readUrl='https://app.tapnow.ai/api/canvas/v1/canvases/test-canvas?with_nodes=true&with_connections=true';
const writeUrl=readUrl.split('?')[0]+'/nodes:batchActions';
function fixture(count=3,{post='ok',readAfter='ok',preflight='ok',change,retryAfter,invalidJson=false}={}) {
  const graph={id:'test-canvas',name:'Fixture',nodes:Array.from({length:count+1},(_,i)=>({
    id:'video-n'+i,type:'video',position:{x:i*220,y:0},measured:{width:100,height:60},
    data:{title:'Video',src:'',params:{generateAudio:false}},parent_id:'',updated_at:'before'})),
  connections:Array.from({length:count},(_,i)=>({id:'edge-'+i,source:'video-n'+i,target:'video-n'+(i+1),data:{order:i}}))};
  graph.nodes.at(-1).position.x=-1000;
  const snapshot=()=>({nodes:graph.nodes.map(n=>({id:n.id,title:n.data.title,...n.position,
    width:n.measured.width,height:n.measured.height,primaryMedia:[],selected:false})),
  edges:graph.connections.map(e=>({id:e.id,label:'Edge from '+e.source+' to '+e.target})),viewport:{scale:1}});
  const before=snapshot(),canvas=structuredClone(before),calls=[];
  let postCount=0,now=Date.UTC(2026,10,3);
  const requestTimes=[],sleeps=[];
  const clock={now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}};
  const response=(status,body)=>({status,headers:{get:name=>name==='retry-after'?(retryAfter??null):null},
    json:async()=>{if(invalidJson)throw Error('not JSON');return body;}});
  const fetch=async(url,init)=>{
    calls.push(init.method);requestTimes.push(now);
    if(init.method==='GET') {
      if(postCount && readAfter==='error')throw Error('read timed out');
      const status=Number(postCount?readAfter:preflight)||200;
      return response(status,{code:status===200?0:110003,data:{canvas:structuredClone(graph)}});
    }
    postCount++;
    const body=JSON.parse(init.body);
    assert.equal(url,writeUrl);assert.equal(body.actions.length,1);assert.equal(body.actions[0].action,'update');
    assert.equal(body.created_by_role,'user');assert.equal(body.canvas_id,graph.id);
    for(const update of body.actions[0].updates)assert.deepEqual(Object.keys(update).sort(),['id','position']);
    if(!(Number(post)>=400))for(const update of body.actions[0].updates.slice(0,post==='partial'?1:undefined)) {
      Object.assign(graph.nodes.find(n=>n.id===update.id),{position:update.position,updated_at:'after'});
    }
    if(change)change(graph);
    if(post==='timeout')throw Error('CDP expression could contain secret-session-value');
    const status=Number(post)||200;
    return response(status,{code:status===200?0:110003});
  };
  const cdp={send:async(method,{expression})=>({result:{value:await vm.runInNewContext(expression,{fetch,performance,AbortSignal})}})};
  const api=createCanvasPositionApi({cdp,readUrl,writeUrl,headers:{Authorization:'secret-session-value'},clock});
  const plan=before.nodes.slice(0,count).map(n=>({id:n.id,x:n.x+3000,y:n.y}));
  const controller={readCanvas:async()=>structuredClone(canvas),selectNodes:async([id])=>{
    calls.push('select');canvas.nodes.forEach(n=>n.selected=n.id===id);return controller.readCanvas();
  },dragSelected:async([id],delta)=>{
    calls.push('drag');const n=canvas.nodes.find(n=>n.id===id);n.x+=delta.dx;n.y+=delta.dy;return controller.readCanvas();
  },moveSelected:async()=>{throw Error('Unexpected keyboard correction');}};
  const syncCanvas=async()=>{calls.push('sync');Object.assign(canvas,snapshot());};
  return {api,controller,syncCanvas,before,plan,canvas,graph,calls,cdp,clock,requestTimes,sleeps};
}

test('80-node API batch changes only coordinates, then synchronizes once without UI moves',async()=>{
  const f=fixture(80),result=await createLayoutRunner({...f,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,80);assert.equal(result.pending.length,0);
  assert.deepEqual(f.calls,['GET','POST','GET','sync']);
  assert.equal(result.routes[0].fallback,false);assert.ok(result.completed.every(n=>n.route==='api'));
});

test('a timed-out committed write is reconciled without replay or UI movement',async()=>{
  const f=fixture(3,{post:'timeout'}),result=await createLayoutRunner({...f,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,3);assert.deepEqual(f.calls,['GET','POST','GET','sync']);
  assert.equal(result.routes[0].reason,'position-write-unavailable');assert.equal(result.routes[0].fallback,false);
  assert.ok(!JSON.stringify(result).includes('secret-session-value'));
});

test('resuming a reconciled timeout keeps API acceleration disabled',async()=>{
  const f=fixture(3,{post:'timeout'}),runner=createLayoutRunner({...f,positionApi:f.api});
  const checkpoint=await runner.moveNodes([f.plan[0].id]);
  const result=await createLayoutRunner({...f,checkpoint,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,3);assert.equal(f.calls.filter(c=>c==='POST').length,1);
  assert.equal(result.completed.filter(n=>n.route==='ui').length,2);
});

test('partial commit falls back for remaining nodes after readback and synchronization',async()=>{
  const f=fixture(3,{post:'partial'}),result=await createLayoutRunner({...f,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.filter(n=>n.route==='api').length,1);
  assert.equal(result.completed.filter(n=>n.route==='ui').length,2);
  assert.deepEqual(f.calls,['GET','POST','GET','sync','select','drag','select','drag']);
  assert.equal(result.routes[0].reason,'position-partial-readback');assert.equal(result.routes[0].fallback,true);
});

test('a rejected write falls back automatically once and reports its reason',async()=>{
  const f=fixture(3,{post:'400'}),runner=createLayoutRunner({...f,positionApi:f.api});
  await runner.moveNodes([f.plan[0].id]);
  const result=await runner.moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,3);assert.equal(f.calls.filter(c=>c==='POST').length,1);
  assert.equal(result.routes[0].reason,'position-write-rejected');assert.equal(result.routes[0].fallback,true);
});

test('preflight unavailable falls back before sending a write or refreshing the page',async()=>{
  const f=fixture(3,{preflight:'500'}),result=await createLayoutRunner({...f,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.equal(result.completed.length,3);assert.ok(!f.calls.includes('POST'));assert.ok(!f.calls.includes('sync'));
  assert.equal(result.routes[0].reason,'position-preflight-unavailable');
});

test('unknown write outcome stops with a checkpoint and sends no fallback input',async()=>{
  const f=fixture(3,{readAfter:'error'}),runner=createLayoutRunner({...f,positionApi:f.api});
  await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-outcome-unknown/);
  assert.deepEqual(f.calls,['GET','POST','GET']);assert.equal(runner.state().routes[0].fallback,false);
  assert.equal(runner.state().routes[0].writeAttempted,true);
  await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/reconcile the saved state/);
  await assert.rejects(createLayoutRunner({...f,checkpoint:runner.state(),positionApi:f.api}).moveNodes(f.plan.map(p=>p.id)),/reconcile the saved state/);
  assert.deepEqual(f.calls,['GET','POST','GET']);
});

test('coordinate requests are paced at least 1500ms apart without per-node requests',async()=>{
  const f=fixture(80);
  await f.api.move(f.plan,f.before);
  assert.deepEqual(f.calls,['GET','POST','GET']);
  assert.deepEqual(f.sleeps,[1500,1500]);
  assert.ok(f.requestTimes.slice(1).every((t,i)=>t-f.requestTimes[i]>=1500));
});

test('default clock enforces the pause in real elapsed time',async()=>{
  const f=fixture(),times=[];
  const cdp={send:async(...args)=>{times.push(performance.now());return f.cdp.send(...args);}};
  const api=createCanvasPositionApi({cdp,readUrl,writeUrl,headers:{Authorization:'ephemeral'}});
  await api.move(f.plan,f.before);
  assert.equal(times.length,3);
  assert.ok(times.slice(1).every((t,i)=>t-times[i]>=1450));
  api.dispose();
});

test('concurrent API moves are rejected without interleaving requests',async()=>{
  const f=fixture(),first=f.api.move(f.plan,f.before);
  await assert.rejects(f.api.move(f.plan,f.before),/position-api-busy/);
  await first;
  assert.deepEqual(f.calls,['GET','POST','GET']);
});

test('429 during preflight, write or readback stops with no UI fallback or further requests',async()=>{
  for(const stage of ['preflight','post','readAfter']) {
    const f=fixture(3,{[stage]:'429',retryAfter:'10'}),runner=createLayoutRunner({...f,positionApi:f.api});
    await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-rate-limited/);
    const count=f.calls.length,route=runner.state().routes[0];
    assert.deepEqual(f.calls,stage==='preflight'?['GET']:stage==='post'?['GET','POST']:['GET','POST','GET']);
    assert.equal(route.httpStatus,429);assert.equal(route.retryAt,f.clock.now()+10000);
    assert.equal(route.fallback,false);assert.equal(route.stopped,true);
    assert.equal(route.writeAttempted,stage!=='preflight');
    // A later call cannot silently bypass a blocked API session, even after cooldown.
    await f.clock.sleep(10001);
    await assert.rejects(f.api.move(f.plan,f.before),/position-rate-limited/);
    await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/reconcile the saved state/);
    await assert.rejects(createLayoutRunner({...f,checkpoint:runner.state(),positionApi:f.api}).moveNodes(f.plan.map(p=>p.id)),/reconcile the saved state/);
    assert.equal(f.calls.length,count);
    assert.ok(!JSON.stringify(route).includes('secret-session-value'));
  }
});

test('Retry-After accepts seconds and HTTP-date; missing or invalid values use a conservative pause',async()=>{
  const start=Date.UTC(2026,10,3);
  for(const [retryAfter,delay] of [['5',5000],[new Date(start+12000).toUTCString(),12000],
    [undefined,30000],['not-a-date',30000],['0',1500]]) {
    const f=fixture(3,{preflight:'429',retryAfter});
    await assert.rejects(f.api.move(f.plan,f.before),error=>{
      assert.equal(error.httpStatus,429);assert.equal(error.retryAt,start+delay);
      assert.equal(error.safeToFallback,false);return true;
    });
    assert.deepEqual(f.calls,['GET']);
  }
});

test('authentication failures and non-JSON success pages stop without switching to UI',async()=>{
  for(const status of ['401','403'])for(const stage of ['preflight','post','readAfter']) {
    const f=fixture(3,{[stage]:status}),runner=createLayoutRunner({...f,positionApi:f.api});
    await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-access-denied/);
    assert.equal(runner.state().routes[0].httpStatus,Number(status));
    assert.ok(!f.calls.some(c=>['select','drag','sync'].includes(c)));
  }
  const f=fixture(3,{invalidJson:true}),runner=createLayoutRunner({...f,positionApi:f.api});
  await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-response-unrecognized/);
  assert.deepEqual(f.calls,['GET']);
});

test('503 also pauses without immediate readback or a fallback request burst',async()=>{
  const f=fixture(3,{post:'503',retryAfter:'60'}),runner=createLayoutRunner({...f,positionApi:f.api});
  await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-service-unavailable/);
  assert.equal(runner.state().routes[0].retryAt,f.clock.now()+60000);
  assert.deepEqual(f.calls,['GET','POST']);
});

test('changed media, outsider positions or links stop before UI fallback',async()=>{
  for(const change of [g=>{g.nodes.at(-1).position.x+=20;},g=>{g.nodes[0].data.src='replacement';},
    g=>{g.connections[0].source='video-n2';},g=>{g.nodes[0].position.x+=20;}]) {
    const f=fixture(3,{change}),runner=createLayoutRunner({...f,positionApi:f.api});
    await assert.rejects(runner.moveNodes(f.plan.map(p=>p.id)),/position-graph-changed/);
    assert.deepEqual(f.calls,['GET','POST','GET']);
  }
});

test('stale UI, missing graph query flags and cross-origin routes never send mutations',async()=>{
  const f=fixture();f.before.nodes[0].x+=20;
  await assert.rejects(f.api.move(f.plan,f.before),/server-ui-position-mismatch/);
  assert.deepEqual(f.calls,['GET']);
  for(const options of [{readUrl:readUrl.split('?')[0]},{writeUrl:writeUrl.replace('app.tapnow.ai','example.com')},
    {writeUrl:writeUrl.replace('nodes:batchActions','connections:batchActions')}])
    assert.throws(()=>createCanvasPositionApi({cdp:f.cdp,readUrl,writeUrl,headers:{Authorization:'ephemeral'},...options}),/unverified-position-route/);
});

test('disposing the session disables API use and retains automatic UI fallback',async()=>{
  const f=fixture();f.api.dispose();
  const result=await createLayoutRunner({...f,positionApi:f.api}).moveNodes(f.plan.map(p=>p.id));
  assert.ok(!f.calls.includes('GET'));assert.equal(result.routes[0].reason,'session-auth-unavailable');
});
