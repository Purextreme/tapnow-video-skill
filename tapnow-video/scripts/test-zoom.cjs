const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(process.argv[2] || require('node:path').join(__dirname, 'set-canvas-zoom.js'), 'utf8').replace(/\nexport \{ setTapnowCanvasZoom \};\s*$/,''), context);
function fixture(initial, count = 1, stuck = false, invalid = false) {
  let value = initial, calls = 0, presses = 0;
  const element = { getAttribute: name => name === 'aria-valuenow' ? (invalid ? null : String(value)) : name === 'aria-valuemin' ? '0.1' : '4' };
  const slider = {
    count: async () => (++calls, count),
    evaluate: async fn => (++calls, fn(element)),
    evaluateAll: async fn => (++calls, fn(Array.from({length:count},()=>element))),
    press: async key => { calls++; presses++; if (!stuck) value += ({PageDown:-.1,PageUp:.1,ArrowLeft:-.01,ArrowRight:.01})[key]; },
    and: () => slider,
    waitFor: async () => { calls++; },
  };
  return {tab:{getAXState:async()=>{calls++;return '';},playwright:{getByRole:()=>slider,locator:()=>({})}},stats:()=>({value,calls,presses})};
}
(async()=>{
  const measurements=[];
  for (const [label,initial,target] of [['already-set',1,1],['two-steps',1.2,1],['fine-step',1.01,1]]) {
    const f=fixture(initial); const result=await context.setTapnowCanvasZoom(f.tab,target);
    assert.ok(Math.abs(result.actual-target)<=.0001);assert.equal(result.keyCount,f.stats().presses);
    measurements.push({label,...f.stats()});
  }
  for(const [label,initial,count,stuck,invalid,target] of [['ambiguous',1,2,false,false,1],['missing',1,0,false,false,1],['invalid',1,1,false,true,1],['no-progress',1.2,1,true,false,1],['out-of-range',1,1,false,false,5]]){
    const f=fixture(initial,count,stuck,invalid); await assert.rejects(()=>context.setTapnowCanvasZoom(f.tab,target));
    assert.ok(f.stats().presses<=1,label+' must stop without repeated mutation');
  }
  console.log(JSON.stringify({passed:8,measurements}));
})().catch(e=>{console.error(e);process.exitCode=1;});
