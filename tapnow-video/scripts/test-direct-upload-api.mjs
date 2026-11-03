import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdtemp,rmdir,unlink,writeFile,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {createDirectUploadApi} from './direct-upload-api.mjs';

const root=await mkdtemp(join(tmpdir(),'tapnow-direct-test-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64');
const mp4=Buffer.from('00000010667479706d70343200000000','hex');
const file=join(root,'synthetic.png'),video=join(root,'synthetic.mp4'),large=join(root,'oversize.png'),
  browserLarge=join(root,'browser-oversize.png');
after(async()=>{await Promise.all([file,video,large,browserLarge].map(path=>unlink(path)));await rmdir(root);});
await Promise.all([writeFile(file,png),writeFile(video,mp4),writeFile(large,png),writeFile(browserLarge,png)]);
await Promise.all([truncate(large,8*1024*1024+1),truncate(browserLarge,640*1024+1)]);

const initUrl='https://app.tapnow.ai/api/files/upload-urls';
const fileId='11111111-1111-1111-1111-111111111111';
const id='22222222-2222-2222-2222-222222222222';
const base='https://app.tapnow.ai/api/canvas/v1/canvases/'+id;
const canvas={id,readUrl:base+'?with_nodes=true&with_connections=true',writeUrl:base+'/nodes:batchActions'};
const signed='https://storage.googleapis.com/test/object?X-Goog-Signature=TEST_SIGNATURE';
const original='https://files.tapnow.media/api/conversation/storage/uploads/'+fileId;
const secret='Bearer MOCK_SESSION_SECRET';
const json=(data,options)=>Response.json({code:0,data},options);

function fixture({fault,storageTransport='local',mimeType='image/png',payload=png,changeGraph,sendFault}={}) {
  let time=100000;
  const calls=[],clock={now:()=>time,sleep:async ms=>{time+=ms;}};
  const graph={id,name:'synthetic canvas',nodes:[{id:'image-existing',type:'image',position:{x:10,y:20},
    measured:{width:650,height:250},data:{src:'original unchanged'}},{id:'group-parent',type:'group',position:{x:800,y:20},
    measured:{width:400,height:250},data:{}},{id:'image-child',type:'image',parent_id:'group-parent',position:{x:400,y:20},
    measured:{width:300,height:250},data:{}}],connections:[{id:'edge-existing',source:'image-existing',target:'image-child',data:{order:0}}]};
  async function dispatch(url,options={},via) {
    const method=options.method||'GET';
    const stage=url===initUrl?'init':url===initUrl+'/'+fileId+'/complete'?'complete':
      url===signed?'put':url===original?'original':url===canvas.readUrl?'graph':url===canvas.writeUrl?'create':null;
    const call={stage,url,method,options,via,start:time,body:typeof options.body==='string'?JSON.parse(options.body):options.body};
    calls.push(call);time+=37;call.end=time;
    const reply=await fault?.(stage,call,calls);
    if(reply)return reply;
    if(stage==='init')return json({file_id:fileId,upload_strategy:'single_put',upload_url:signed,
      headers:{'Cache-Control':'private, max-age=3600','Content-Type':mimeType}});
    if(stage==='put')return new Response(null,{status:200});
    if(stage==='complete')return json(null);
    if(stage==='original')return new Response(payload,{headers:{'Content-Length':String(payload.length)}});
    if(stage==='graph')return json({canvas:graph});
    if(stage==='create') {graph.nodes.push(call.body.actions[0].creates[0]);changeGraph?.(graph);return json({});}
    throw new Error('unexpected URL');
  }
  const cdp={async send(method,{expression,awaitPromise,returnByValue}) {
    assert.equal(method,'Runtime.evaluate');assert.equal(awaitPromise,true);assert.equal(returnByValue,true);
    if(sendFault)return sendFault();
    const value=await runInNewContext(expression,{fetch:(url,options)=>dispatch(url,options,'browser'),
      AbortSignal,Uint8Array,atob});
    return {result:{value}};
  }};
  const api=createDirectUploadApi({cdp,headers:{Authorization:secret,Cookie:'DROP_ME',Other:'DROP_ME'},
    initUrl,storageTransport,fetchImpl:(url,options)=>dispatch(url,options,'local'),clock});
  return {api,calls,clock,graph};
}

async function stops(setup,code,stages,extra={},options={file}) {
  const {api,calls}=setup;let error;
  await assert.rejects(api.upload(options),e=>{error=e;return e.code===code;});
  for(const [k,v] of Object.entries(extra))assert.equal(error[k],v,k);
  assert.equal(error.safeToFallback,false);
  assert.doesNotMatch(JSON.stringify(error),/MOCK_SESSION_SECRET|TEST_SIGNATURE|DROP_ME/);
  await assert.rejects(api.upload(options),e=>e===error);
  assert.deepEqual(calls.map(x=>x.stage),stages);
  return error;
}

test('local single PUT sends exactly the file bytes, isolates credentials and checks the original',async()=>{
  const {api,calls}=fixture(),out=await api.upload({file});
  assert.equal(out.verifiedOriginal,true);assert.equal(out.fileId,fileId);
  assert.equal(out.sha256,createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(calls.map(x=>[x.stage,x.method,x.via]),[['init','POST','browser'],['put','PUT','local'],
    ['complete','PUT','browser'],['original','GET','local']]);
  assert.equal(calls[0].body.file_hash,out.sha256);assert.equal(calls[0].body.file_size,png.length);
  assert.equal(calls[0].options.headers.authorization,secret);assert.equal(calls[0].options.headers.Cookie,undefined);
  assert.deepEqual(Buffer.from(calls[1].body),png);assert.deepEqual(Object.keys(calls[1].options.headers).sort(),['Cache-Control','Content-Type']);
  assert.equal(calls[3].options.headers,undefined);
  assert.ok(calls.slice(1).every((call,i)=>call.start-calls[i].end>=1500));
});

test('browser transport omits credentials and verifies canvas creation without moving group members',async()=>{
  const {api,calls}=fixture({storageTransport:'browser'}),out=await api.upload({file,canvas});
  const put=calls.find(c=>c.stage==='put'),create=calls.find(c=>c.stage==='create');
  assert.equal(put.via,'browser');assert.equal(put.options.credentials,'omit');assert.equal(put.options.redirect,'error');
  assert.deepEqual(Buffer.from(put.body),png);assert.equal(put.options.headers.authorization,undefined);
  assert.equal(create.body.actions[0].action,'create');assert.equal(create.body.actions[0].creates[0].id,out.nodeId);
  assert.equal(out.priorNodes.length,3);assert.deepEqual(out.priorEdgeIds,['edge-existing']);
  assert.ok(out.position.x>800+400+300);
  assert.deepEqual(calls.map(c=>c.stage),['graph','init','put','complete','original','create','graph']);
});

test('video landing uses the observed video shape and the verified dimensions',async()=>{
  const {api,calls}=fixture({storageTransport:'browser',mimeType:'video/mp4',payload:mp4});
  const out=await api.upload({file:video,canvas,videoDimensions:{width:640,height:360}});
  const n=calls.find(c=>c.stage==='create').body.actions[0].creates[0];
  assert.match(out.nodeId,/^video-/);assert.equal(n.type,'video');assert.equal(n.data.prompt,undefined);
  assert.equal(n.measured.width,444);assert.equal(n.data.src,original);
});

test('preflight rejects oversize, unknown media, mismatched canvas routes, or missing video dimensions before writes',async()=>{
  const {api,calls}=fixture();
  for(const [options,code] of [[{file:large},'unsupported-single-put-file'],[{file:'relative.png'},'absolute-upload-path-required'],
    [{file,canvas:{...canvas,writeUrl:canvas.writeUrl.replace('nodes:','connections:')}},'unverified-upload-canvas'],
    [{file:video,canvas},'verified-video-dimensions-required']])
    await assert.rejects(api.upload(options),e=>e.safeToFallback && e.code===code);
  assert.deepEqual(calls,[]);
});

test('browser payload size gate allows fallback without sending any requests',async()=>{
  const {api,calls}=fixture({storageTransport:'browser'});
  await assert.rejects(api.upload({file:browserLarge}),{code:'unsupported-single-put-file',safeToFallback:true});
  assert.deepEqual(calls,[]);
});

test('unknown multipart strategy stops without sending a byte',()=>stops(fixture({fault:s=>s==='init'?
  json({file_id:fileId,upload_strategy:'multipart',upload_url:signed}):null}),
  'upload-strategy-unverified',['init'],{stage:'init',fileId}));

for(const [label,url,headers] of [['foreign host','https://example.com/upload?X-Goog-Signature=bad',{'Content-Type':'image/png'}],
  ['missing signature','https://storage.googleapis.com/test/upload?other=value',{'Content-Type':'image/png'}],
  ['gateway header',signed,{'Content-Type':'image/png','Authorization':secret}]])
  test('rejects '+label+' before sending any file bytes',()=>stops(fixture({fault:s=>s==='init'?
    json({file_id:fileId,upload_strategy:'single_put',upload_url:url,headers}):null}),
    'upload-destination-unverified',['init'],{fileId}));

for(const [status,header,delay] of [[429,'7',7000],[429,new Date(128000).toUTCString(),28000],[503,'invalid',30000]])
  test(`gateway HTTP ${status} Retry-After ${header}: stops without follow-up`,async()=>{
    const setup=fixture({fault:s=>s==='init'?json(null,{status,headers:{'Retry-After':header}}):null});
    const e=await stops(setup,'upload-init-rate-or-service-stop',['init'],{httpStatus:status});
    assert.ok(Math.abs(e.retryAt-setup.clock.now()-delay)<40);
  });

test('storage rate limiting stops before completion or readback',()=>stops(fixture({fault:s=>s==='put'?
  new Response(null,{status:429,headers:{'Retry-After':'3'}}):null}),
  'storage-rate-or-service-stop',['init','put'],{stage:'transfer',fileId,httpStatus:429}));

for(const status of [401,403])test(`gateway HTTP ${status} blocks rather than falling back`,()=>stops(fixture({fault:s=>s==='init'?
  json(null,{status}):null}),'upload-init-access-denied',['init'],{httpStatus:status}));

test('HTML with HTTP 200 is not an upload success',()=>stops(fixture({fault:s=>s==='init'?
  new Response('<html>unexpected</html>'):null}),'upload-init-response-unrecognized',['init'],{httpStatus:200}));

test('CDP failure hides the expression and never replays initialization',()=>stops(fixture({sendFault:()=>{throw Error(secret+signed);}}),
  'upload-app-transport-unknown',[],{stage:'init',writeAttempted:true}));

test('a local connection reset retains the file ID and does not retry or confirm',()=>stops(fixture({fault:s=>{
  if(s==='put')throw Object.assign(Error(signed),{cause:{code:'ECONNRESET'}});
}}),'upload-transfer-outcome-unknown',['init','put'],{fileId,stage:'transfer',transportCode:'ECONNRESET'}));

test('browser timeout stops the chosen route instead of switching to local',()=>stops(fixture({storageTransport:'browser',fault:s=>{
  if(s==='put')throw Object.assign(Error(signed),{name:'TimeoutError'});
}}),'upload-transfer-outcome-unknown',['init','put'],{fileId,transportCode:'BROWSER_TIMEOUT'}));

test('HTTP 200 with nonzero completion code leaves the original file ID pending',()=>stops(fixture({fault:s=>s==='complete'?
  Response.json({code:409001}):null}),'upload-complete-response-unrecognized',['init','put','complete'],
  {fileId,stage:'complete',httpStatus:200,businessCode:409001}));

test('mismatched original length and digest both stop before any canvas write',async()=>{
  await stops(fixture({fault:s=>s==='original'?new Response(png.subarray(1),{headers:{'Content-Length':String(png.length-1)}}):null}),
    'original-size-mismatch',['init','put','complete','original'],{fileId});
  await stops(fixture({fault:s=>s==='original'?new Response(Buffer.alloc(png.length)):null}),
    'original-hash-mismatch',['graph','init','put','complete','original'],{fileId},{file,canvas});
});

test('a committed node with a lost response preserves its identity and is never created twice',async()=>{
  const setup=fixture({fault:(s,c)=>{if(s==='create') {
    setup.graph.nodes.push(c.body.actions[0].creates[0]);throw Error(secret);
  }}});
  const e=await stops(setup,'upload-app-transport-unknown',['graph','init','put','complete','original','create'],
    {fileId,stage:'node-create',writeAttempted:true},{file,canvas});
  assert.equal(setup.graph.nodes.filter(n=>n.id===e.nodeId).length,1);
});

test('readback rejects a changed pre-existing node or link',async()=>{
  for(const changeGraph of [g=>{g.nodes[0].position.x+=1;},g=>{g.connections=[];}])
    await stops(fixture({changeGraph}),'upload-canvas-readback-mismatch',['graph','init','put','complete','original','create','graph'],
      {fileId,stage:'node-create'},{file,canvas});
});

test('a busy instance rejects a second upload; disposal disables subsequent requests',async()=>{
  const {api,calls}=fixture();const pending=api.upload({file});
  await assert.rejects(api.upload({file}),{code:'upload-api-busy'});
  await pending;api.dispose();await assert.rejects(api.upload({file}),{code:'upload-api-disposed'});
  assert.equal(calls.filter(c=>c.stage==='init').length,1);
});
