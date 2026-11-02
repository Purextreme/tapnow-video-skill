import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseDuration,validatePromptParts,comparisonRequests} from './workflow-policy.mjs';

test('the same two-second intent adapts to each current UI minimum',()=>{
  assert.equal(chooseDuration(2,{values:[4,5,6,8]}).actualSeconds,4);
  assert.equal(chooseDuration(2,{min:2,max:30,step:1}).actualSeconds,2);
  assert.equal(chooseDuration(2,{min:3,max:15,step:2}).actualSeconds,3);
  assert.equal(chooseDuration(4,{min:3,max:15,step:2}).actualSeconds,5);
  assert.equal(chooseDuration(5,{min:3,max:15,step:2}).adapted,false);
});
test('an explicit numeric range is not limited to quick-preset buttons',()=>{
  assert.equal(chooseDuration(20,{values:[2,3,4,5],min:2,max:30,step:1}).actualSeconds,20);
  assert.equal(chooseDuration(4.2,{values:[4,6,8]}).actualSeconds,6);
  assert.throws(()=>chooseDuration(31,{min:2,max:30,step:1}),/exceeds/);
  assert.throws(()=>chooseDuration(2,{}),/unknown/);
  for(const target of [0,-2,NaN,Infinity])assert.throws(()=>chooseDuration(target,{values:[4]}),/positive/);
});
test('reference prompts require bound identities, including every source',()=>{
  const references=[{id:'image-a',title:'phone'},{id:'image-b',title:'background'}];
  assert.deepEqual(validatePromptParts(['手持 ',{mention:'image-a'},'，背景参考 ',{mention:'image-b'}],references),['image-a','image-b']);
  assert.throws(()=>validatePromptParts(['手持 @phone'],references),/literal @/);
  assert.throws(()=>validatePromptParts([{mention:'image-other'}],references),/bound/);
  assert.throws(()=>validatePromptParts([{mention:'image-a'}],references),/every bound/);
  assert.throws(()=>validatePromptParts([{mention:'image-a'}],[references[0],references[0]]),/unique/);
});
test('comparison keeps common intent and assets while permitting supported output parameters',()=>{
  const shared={kind:'reference',targetSeconds:2,references:[{id:'image-a',title:'phone'}],promptParts:['手持 ',{mention:'image-a'}]};
  const requests=comparisonRequests(shared,[{model:'Wan 3.0',resolution:'720P'},{model:'MiniMax H3',resolution:'768P'}]);
  assert.deepEqual(requests.map(r=>[r.model,r.targetSeconds,r.audio,r.prepareOnly]),[['Wan 3.0',2,false,true],['MiniMax H3',2,false,true]]);
  assert.deepEqual(requests.map(r=>r.references),[shared.references,shared.references]);
  for(const override of [{prompt:''},{references:[]},{audio:true},{targetSeconds:8},{kind:'image'}])
    assert.throws(()=>comparisonRequests(shared,[{model:'Wan 3.0',...override}]),/shared task/);
  assert.throws(()=>comparisonRequests(shared,[{model:'Wan 3.0'},{model:'Wan 3.0'}]),/distinct/);
});
