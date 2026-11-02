// Decisions based on the current UI, never a permanent per-model capability table.
export function chooseDuration(targetSeconds, {values = [], min, max, step} = {}) {
  const target = Number(targetSeconds);
  if (!(target > 0) || !Number.isFinite(target)) throw Error('A positive target duration is required');
  const legal = [...new Set(values.map(Number).filter(n => n > 0 && Number.isFinite(n)))].sort((a,b)=>a-b);
  let actual;
  // A numeric input's explicit range may extend beyond its quick-preset buttons.
  if (Number.isFinite(min) && Number.isFinite(max) && step > 0 && min > 0 && max >= min) {
    actual = min + Math.max(0, Math.ceil((target-min)/step-1e-8))*step;
    if (actual > max+1e-8) actual = undefined;
  } else if (legal.length) actual = legal.find(n => n >= target);
  else throw Error('Current duration limits are unknown; inspect before choosing');
  if (actual === undefined) throw Error('Target exceeds the current duration range; do not silently shorten it');
  return {targetSeconds:target,actualSeconds:actual,adapted:actual!==target,
    reason:actual===target?'exact':'next supported duration; preserve the requested action and pacing'};
}

export function validatePromptParts(parts, references) {
  if (!Array.isArray(parts) || !parts.length) throw Error('Prompt parts are required');
  const byId = new Map(references.map(r=>[r.id,r]));
  if(byId.size!==references.length)throw Error('Reference IDs must be unique');
  const mentioned = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.includes('@')) throw Error('Use a mention part rather than literal @ text');
    } else if (part && Object.keys(part).length===1 && typeof part.mention==='string' && byId.has(part.mention)) {
      mentioned.push(part.mention);
    } else throw Error('Every mention must identify one of the bound references');
  }
  const missing=references.filter(r=>!mentioned.includes(r.id));
  if (missing.length) throw Error('Reference prompt must mention every bound source: '+missing.map(r=>r.title).join(', '));
  return mentioned;
}

export function comparisonRequests(shared, cases) {
  if (!cases?.length || new Set(cases.map(c=>c.model)).size!==cases.length) throw Error('Choose distinct exact model names');
  const sharedKeys=['kind','prompt','promptParts','references','first','last','targetSeconds','duration','audio'];
  if (cases.some(c=>!c.model?.trim() || sharedKeys.some(key=>Object.hasOwn(c,key))))
    throw Error('Comparison cases may change model and supported parameters, not the shared task or assets');
  return cases.map(c=>({...shared,...c,audio:shared.audio===true,prepareOnly:true}));
}
