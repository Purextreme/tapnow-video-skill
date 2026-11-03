import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadTapnowCanvasImage} from './upload-canvas-image.mjs';

const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const original='https://files.tapnow.media/api/conversation/storage/uploads/file-123';
const old={id:'existing',transform:'translate(0px, 0px)'};
const added={id:'new',transform:'translate(500px, 0px)',text:'probe',inputs:['probe'],
  images:[{src:original+'?variant_name=thumb',ready:true}]};
const state=(nodes=[old,added],edges=[])=>({ready:true,nodes,edges});

async function scenario(options={},check=()=>{}) {
  const dir=await mkdtemp(join(tmpdir(),'tapnow-upload-test-'));
  const file=join(dir,options.filename||'probe.png');
  await writeFile(file,options.bytes||bytes);
  const calls={add:0,choose:0,setFiles:0,fetch:[]};
  const states=options.states||[state()];let index=0,menuReady=!options.delayedMenu,menuOpened=options.menuAlreadyOpen===true;
  const chooser={isMultiple:()=>true,setFiles:async files=>{calls.setFiles++;assert.deepEqual(files,[file]);}};
  const control={count:async()=>menuOpened?1:0,isVisible:async()=>menuOpened && menuReady,isEnabled:async()=>true,
    waitFor:async options=>{assert.equal(options.state,'visible');assert.equal(menuOpened,true);menuReady=true;},
    click:async()=>{calls.choose++;if(options.clickError)throw new Error('chooser rejected');}};
  const tab={playwright:{
    evaluate:async(fn,known)=>structuredClone(known===null?options.before||state([old]):states[Math.min(index++,states.length-1)]),
    getByTestId:id=>{assert.equal(id,'canvas-dockbar-add-node-btn');return{click:async()=>{calls.add++;menuOpened=!menuOpened;}};},
    getByText:text=>{assert.equal(text,'Images / Video / Audio / 3D');return control;},
    waitForEvent:async name=>{assert.equal(name,'filechooser');return chooser;},
  }};
  const saved=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.fetch.push({url,init});
    if(options.fetchError)throw new Error('sensitive-url-must-not-leak');
    return new Response(options.responseBytes||bytes,{status:options.httpStatus||200,
      headers:options.noLength?{}:{'content-length':String((options.responseBytes||bytes).length)}});
  };
  try {
    const result=await uploadTapnowCanvasImage(tab,{file,completionTimeoutMs:1000});
    await check(result,calls);
  } finally {globalThis.fetch=saved;await unlink(file);await rmdir(dir);}
}

test('one chooser, completed node and original hash verify without a transfer toast',async()=>{
  await scenario({},(r,c)=>{
    assert.equal(r.ok,true);assert.equal(r.nodeId,'new');assert.equal(r.verifiedOriginal,true);
    assert.equal(c.setFiles,1);assert.equal(c.choose,1);assert.equal(c.fetch.length,1);
    assert.equal(c.fetch[0].url,original);assert.equal(c.fetch[0].init.headers,undefined);
    assert.equal(c.fetch[0].init.redirect,'error');assert.ok(r.fullWallMs>=r.previewReadyMs);
  });
});
test('ready empty canvas can accept its first image',()=>scenario({before:state([]),states:[state([added])]},r=>assert.equal(r.ok,true)));
test('wait for the upload menu to become visible before chooser preflight',()=>scenario({delayedMenu:true},(r,c)=>{
  assert.equal(r.ok,true);assert.equal(c.add,1);assert.equal(c.choose,1);assert.equal(c.setFiles,1);
}));
test('reuse an already open upload menu instead of toggling it closed',()=>scenario({menuAlreadyOpen:true},(r,c)=>{
  assert.equal(r.ok,true);assert.equal(c.add,0);assert.equal(c.choose,1);assert.equal(c.setFiles,1);
}));
test('existing image with same title cannot satisfy the new-upload gate',()=>scenario({
  before:state([{...old,text:'probe',inputs:['probe']}]),states:[state([{...old,text:'probe',inputs:['probe']}])],
},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.fetch.length,0);assert.equal(c.setFiles,1);}));
test('a duplicate filename still verifies the distinct new node',()=>scenario({before:state([{...old,text:'probe',inputs:['probe']}])},r=>assert.equal(r.nodeId,'new')));
test('more than one new node stops without another upload',()=>scenario({states:[state([old,added,{...added,id:'other'}])]},(r,c)=>{
  assert.equal(r.ok,false);assert.match(r.message,/ambiguous/);assert.equal(c.setFiles,1);assert.equal(c.fetch.length,0);
}));
test('moving an existing node stops before content reads',()=>scenario({states:[state([{...old,transform:'translate(40px, 0px)'},added])]},(r,c)=>{
  assert.equal(r.ok,false);assert.match(r.message,/positions changed/);assert.equal(c.fetch.length,0);
}));
test('small coordinate serialization rounding is harmless',()=>scenario({states:[state([{...old,transform:'translate(0.02px, -0.02px)'},added])]},r=>assert.equal(r.ok,true)));
test('existing connection change stops',()=>scenario({states:[state([old,added],['new-edge'])]},r=>assert.equal(r.ok,false)));
test('wrong original bytes stop and never resend files',()=>scenario({responseBytes:Buffer.alloc(bytes.length)},(r,c)=>{
  assert.equal(r.ok,false);assert.equal(r.verifiedOriginal,false);assert.equal(c.setFiles,1);assert.equal(c.fetch.length,1);
}));
test('oversize response with missing length stops',()=>scenario({responseBytes:Buffer.alloc(bytes.length+1),noLength:true},(r,c)=>{
  assert.equal(r.ok,false);assert.equal(c.fetch.length,1);
}));
test('HTTP error stops without falling back to another upload',()=>scenario({httpStatus:404},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.setFiles,1);}));
test('readback failure does not leak transport exception text',()=>scenario({fetchError:true},r=>{
  assert.equal(r.ok,false);assert.ok(!r.message.includes('sensitive-url'));
}));
test('preview readiness can arrive after node creation',()=>scenario({states:[state([old,{...added,images:[{...added.images[0],ready:false}]}]),state()]},r=>assert.equal(r.ok,true)));
test('chooser rejection does not set files',()=>scenario({clickError:true},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.setFiles,0);}));
test('non-PNG content is rejected before UI actions',()=>scenario({bytes:Buffer.from('not an image')},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.add,0);}));
test('unsupported extension is rejected before UI actions',()=>scenario({filename:'probe.jpg'},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.add,0);}));
test('unready canvas is rejected before UI actions',()=>scenario({before:{...state([old]),ready:false}},(r,c)=>{assert.equal(r.ok,false);assert.equal(c.add,0);}));
