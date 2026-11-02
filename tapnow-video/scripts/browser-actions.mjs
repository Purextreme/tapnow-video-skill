// CUA controller module. No browser connection, private API, injected event or generation call.
// Supply handles already bound through cua_repl; page evaluation only reads visible DOM.
import {planFreeSpace, compareCanvas, collisionPairs} from './canvas-geometry.mjs';
import {chooseDuration, validatePromptParts} from './workflow-policy.mjs';
export class TapnowPreparation {
  constructor({tab, native, setZoom, geometry = {planFreeSpace,compareCanvas}}) {
    this.tab = tab; this.native = native; this.setZoom = setZoom; this.geometry=geometry;
    this.keyboardSteps={};
  }
  node(id) {
    if (!/^[a-z]+-[\w-]+$/.test(id)) throw Error('Invalid node ID');
    return this.tab.playwright.getByTestId('rf__node-' + id);
  }
  async unique(locator, label) {
    let n = await locator.count();
    if (n===0) {
      await locator.waitFor({state:'visible',timeoutMs:2500});
      n=await locator.count();
    }
    if (n !== 1) throw Error('Ambiguous or missing ' + label + ': ' + n);
    return locator;
  }
  async activate(locator) {
    await this.unique(locator, 'control');
    const info = await locator.evaluate(e => ({name:e.getAttribute('aria-label') || e.textContent?.trim(),
      testid:e.getAttribute('data-testid'), disabled:e.matches(':disabled,[aria-disabled="true"]')}));
    if (info.testid === 'canvas-node-generate-btn' || /^(Generate(?: \d+ variations)?|Confirm(?: and generate)?|Send|Video Upscale|Run Group)$/i.test(info.name || ''))
      throw Error('Final submission controls are excluded from preparation scripts');
    if (info.disabled) throw Error('Control disabled: ' + info.name);
    await locator.press('Enter', {timeoutMs:3000});
  }
  async observedClick(locator, {nodeBody = false, modifiers = [], nativeInput = false} = {}) {
    await this.unique(locator, 'click target');
    const deadline=Date.now()+2500; let prior=null, stableSince=0, settled=false;
    while (Date.now()<deadline) {
      const rect=await locator.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
      if (prior && ['x','y','width','height'].every(k=>Math.abs(rect[k]-prior[k])<.25)) {
        if (!stableSince) stableSince=Date.now();
        if (Date.now()-stableSince>=100) {settled=true;break;}
      } else stableSince=0;
      prior=rect;
    }
    if (!settled) throw Error('Click target animation did not settle');
    let point;const hitDeadline=Date.now()+1500;
    while(!point && Date.now()<hitDeadline)point = await locator.evaluate((e, nodeBody) => {
      const r = e.getBoundingClientRect();
      for (const fy of [.5,.25,.75,.1,.9]) for (const fx of [.5,.15,.85,.05,.95]) {
        const x = r.x+r.width*fx, y = r.y+r.height*fy;
        if (x < (nodeBody?75:4) || y < (nodeBody?75:4) || x > innerWidth-(nodeBody?30:4) || y > innerHeight-(nodeBody?70:4)) continue;
        const hit = document.elementFromPoint(x,y);
        if (hit && (nodeBody ? hit.closest('.react-flow__node') === e : e.contains(hit))) return {xy:[x,y],center:fx===.5&&fy===.5};
      }
      return null;
    }, nodeBody);
    if (!point) throw Error('Target is offscreen or occluded; navigate or move the covering node first');
    // Semantic clicks use the browser's current viewport mapping. Only a target
    // whose center is occluded needs the freshly observed alternate point.
    if (point.center && !modifiers.length && !nodeBody && !nativeInput) await locator.click({modifiers,timeoutMs:3000});
    else {
      // Native coordinates must use a current mapping, including after F11 or resize.
      await this.native.getScreenshot({emit:false});
      await this.native.click(point.xy, modifiers.length ? {key:modifiers.join('+')} : {});
    }
    return point.xy;
  }
  async readCanvas() {
    const state=await this.tab.playwright.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport');
      const tr = viewport?.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)\s*scale\(([-.\d]+)\)/);
      const nodes = [...document.querySelectorAll('.react-flow__node[data-id]')].map(e => {
        const p = e.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
        const r = e.getBoundingClientRect();
        const primaryMedia=[...e.querySelectorAll('img,video')].filter(m=>
          !['referenceImage','firstFrame','lastFrame'].includes(m.getAttribute('alt')) &&
          !m.closest('[data-testid="canvas-node-prompt-textarea"]'));
        return {id:e.getAttribute('data-id'), title:e.querySelector('input[data-testid="canvas-node-title"]')?.value ||
          e.querySelector('.canvas-node-title > span.truncate')?.textContent?.trim() ||
          e.querySelector('.canvas-node-title span.whitespace-pre')?.textContent?.trim() || '',
          x:p ? Number(p[1]) : NaN, y:p ? Number(p[2]) : NaN,
          width:Number(e.style.width.replace('px','')), height:Number(e.style.height.replace('px','')), selected:e.classList.contains('selected'),
          screen:{x:r.x,y:r.y,width:r.width,height:r.height},
          primaryMedia:primaryMedia.map(m=>({tag:m.tagName,src:(m.getAttribute('src')||'').replace(/[?&]variant_name=[^&]*/,'')})).filter(m=>/^https?:/.test(m.src)),
          media:[...e.querySelectorAll('img,video')].map(m=>({tag:m.tagName,alt:m.getAttribute('alt')||'',src:m.getAttribute('src')||''}))
            .filter(m=>/^https?:/.test(m.src)).map(m=>({...m,src:m.src.replace(/[?&]variant_name=[^&]*/,'')}))};
      });
      return {nodes,edges:[...document.querySelectorAll('.react-flow__edge')].map(e=>({id:e.getAttribute('data-id'),label:e.getAttribute('aria-label')})),
        viewport:tr ? {x:+tr[1],y:+tr[2],scale:+tr[3],width:innerWidth,height:innerHeight}:null};
    });
    const signature=state.viewport && state.viewport.width+'x'+state.viewport.height;
    if (this.viewportSignature && this.viewportSignature!==signature) this.dragGain=null;
    this.viewportSignature=signature;
    const keySignature=signature+'@'+state.viewport?.scale;
    if(this.keySignature!==keySignature)this.keyboardSteps={};
    this.keySignature=keySignature;
    return state;
  }
  async setPrompt(editor, text) {
    if (!text?.trim()) throw Error('Prompt must be nonempty');
    if (await editor.textContent()===text) return;
    // ProseMirror may append on fill. Focus only the editor before selecting its text.
    await editor.press('Control+A'); await editor.press('Backspace'); await editor.fill(text);
    if (await editor.textContent()!==text) throw Error('Prompt replacement not verified');
  }
  async renameCanvas(title) {
    if (!title?.trim()) throw Error('Canvas title is required');
    const button=this.tab.playwright.getByRole('button',{name:'Rename canvas',exact:true});
    const before=(await button.innerText()).trim();
    if(before===title)return {before,title,changed:false};
    await this.activate(button);
    const input=this.tab.playwright.getByRole('textbox',{name:'Rename canvas',exact:true});
    await input.fill(title); await input.press('Enter');
    const end=Date.now()+5000;
    while(Date.now()<end) {
      if ((await button.innerText()).trim()===title && await button.isEnabled()) return {before,title,changed:true};
    }
    throw Error('Canvas rename not confirmed; inspect the existing title before retrying');
  }
  async dismissKnownOverlay() {
    const hotkeys=this.tab.playwright.getByRole('heading',{name:'Basic',exact:true});
    if(await hotkeys.count()===1 && await hotkeys.isVisible()) {
      const close=hotkeys.locator('../../..').getByRole('button');
      await this.activate(close);
      await hotkeys.waitFor({state:'hidden',timeoutMs:1500});
    }
  }
  async setMentionPrompt(id, parts, references) {
    const mentioned=validatePromptParts(parts,references);
    const editor=this.node(id).locator('[data-testid="canvas-node-prompt-textarea"] [contenteditable="true"]');
    const expected=new Map();
    for(const source of references)expected.set(source.id,{...source,src:await this.sourceImage(source.id)});
    await editor.press('Control+A'); await editor.press('Backspace');
    for(const part of parts) {
      if(typeof part==='string') {if(part)await editor.type(part);continue;}
      const source=expected.get(part.mention);
      // type() pastes text and does not consistently open Tiptap suggestions.
      // A sequential @ key invokes the real linked-node menu; never inject HTML.
      await editor.pressSequentially('@');
      const menu=this.tab.playwright.getByRole('tooltip').filter({has:this.tab.playwright.getByText('Linked node',{exact:true})});
      await this.unique(menu,'linked-node mention menu');
      const option=menu.getByRole('button',{name:source.title,exact:true});
      if(!await option.count()) {
        const more=menu.getByRole('button',{name:/^\d+ more results$/});
        if(await more.count()===1)await this.activate(more);
      }
      await this.unique(option,'exact linked source');
      const beforeCount=await editor.locator('[data-mention-node-view]').count();
      await this.activate(option);
      let verified=false;const end=Date.now()+3000;
      while(Date.now()<end) {
        const chips=await editor.locator('[data-mention-node-view]').evaluateAll(es=>es.map(e=>({text:e.textContent,src:e.querySelector('img')?.getAttribute('src')})));
        const chip=chips[chips.length-1];
        if(chips.length===beforeCount+1 && chip.text===source.title && chip.src?.replace(/[?&]variant_name=[^&]*/,'')===source.src) {verified=true;break;}
      }
      if(!verified)throw Error('Mention chip media identity mismatch');
    }
    const evidence=await editor.evaluate(e=>({text:e.textContent,mentions:[...e.querySelectorAll('[data-mention-node-view]')].map(m=>({title:m.textContent,src:m.querySelector('img')?.getAttribute('src')}))}));
    const normalize=s=>s.replace(/\s+/g,' ').trim();
    const wantedText=parts.map(p=>typeof p==='string'?p:expected.get(p.mention).title+' ').join('');
    if(evidence.mentions.length!==mentioned.length || evidence.text.includes('@') || normalize(evidence.text)!==normalize(wantedText))
      throw Error('Prompt text or mention chips do not match the requested parts');
    return evidence;
  }
  async collapseChat() {
    // Collapsed chat is aria-hidden, so role locators intentionally omit it.
    // Read its public DOM marker to confirm the already-collapsed condition.
    const more = this.tab.playwright.locator('button[aria-label="More options"]');
    const state = await more.evaluateAll(es=>es.map(e=>{
      let p=e; while(p && !(p.style?.width === '0px')) p=p.parentElement;
      const r=e.getBoundingClientRect(); return {collapsed:!!p,onscreen:r.x>=0 && r.right<=innerWidth};
    }));
    if (state.length !== 1) throw Error('Cannot identify chat panel');
    if (state[0].collapsed) return {collapsed:true,changed:false};
    if (!state[0].onscreen) throw Error('Chat control outside viewport');
    await this.activate(more);
    await this.activate(this.tab.playwright.getByRole('menuitem',{name:'Collapse chat',exact:true}));
    const final = await more.evaluate(e=>{
      let p=e; while(p && !(p.style?.width === '0px')) p=p.parentElement;return !!p;
    });
    if (!final) throw Error('Chat did not collapse');
    return {collapsed:true,changed:true};
  }
  async navigate({id,title}) {
    await this.ensureCanvasTools();
    await this.activate(this.tab.playwright.getByRole('button',{name:'Node search',exact:true}));
    const dialog = this.tab.playwright.getByRole('dialog').filter({visible:true}).filter({has:this.tab.playwright.getByRole('textbox',{name:'Search nodes...',exact:true})});
    await this.unique(dialog,'node search dialog');
    await dialog.getByRole('textbox',{name:'Search nodes...',exact:true}).fill(title);
    const result = dialog.getByRole('button').filter({has:this.tab.playwright.getByText(title,{exact:true})});
    await this.activate(result);
    await this.node(id).and(this.tab.playwright.locator('.selected')).waitFor({state:'visible',timeoutMs:5000});
    const end = Date.now()+5000; let previous, stableSince=0;
    while (Date.now()<end) {
      const r = await this.node(id).evaluate(e=>{
        const r=e.getBoundingClientRect(),f=document.querySelector('.react-flow')?.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,centered:!!f && Math.abs(r.x+r.width/2-f.x-f.width/2)<4 && Math.abs(r.y+r.height/2-f.y-f.height/2)<4};
      });
      if (r.centered && previous && ['x','y','width','height'].every(k=>Math.abs(r[k]-previous[k])<.25)) {
        if (!stableSince) stableSince=Date.now();
        if (Date.now()-stableSince>=100) return {id,title,screen:r};
      } else stableSince=0;
      previous=r;
    }
    throw Error('Canvas navigation did not settle');
  }
  paramButton(id) {
    return this.node(id).locator('button[aria-haspopup="dialog"]:not([data-testid]):not([aria-label])').filter({hasText:/\d+:\d+|Adaptive|Auto|Frames|Reference/});
  }
  async openParams(id) {
    const button = this.paramButton(id);
    if (await button.getAttribute('aria-expanded') !== 'true') await this.activate(button);
    const dialog=this.tab.playwright.getByRole('dialog').filter({visible:true}).filter({has:this.tab.playwright.getByText('Resolution',{exact:true})});
    return this.unique(dialog,'parameter dialog');
  }
  async choose(dialog, name) {
    const choices=await dialog.locator('button').evaluateAll(es=>es.map((e,index)=>({index,text:e.textContent?.trim()})));
    const matches=choices.filter(e=>e.text?.toLowerCase()===name?.toLowerCase());
    if(matches.length!==1)throw Error('Parameter missing or ambiguous: '+name);
    const button=dialog.locator('button').nth(matches[0].index);
    const already=await button.evaluate(e=>e.classList.contains('text-foreground') || e.getAttribute('aria-pressed')==='true' || e.getAttribute('data-state')==='on');
    if (!already) await this.activate(button);
    const selected=await button.evaluate(e=>e.classList.contains('text-foreground') || e.getAttribute('aria-pressed')==='true' || e.getAttribute('data-state')==='on');
    if (!selected) throw Error('Cannot confirm selected parameter: '+name);
  }
  async closeParams(id) {
    const button=this.paramButton(id);
    if (await button.getAttribute('aria-expanded')==='true') await this.activate(button);
    if (await button.getAttribute('aria-expanded')!=='false') throw Error('Parameters did not close');
  }
  async setModel(id, name) {
    const button=this.node(id).getByTestId(id.startsWith('image-')?'canvas-node-image-model-select':'canvas-node-video-model-select');
    if ((await button.innerText()).trim()===name) return;
    await this.activate(button);
    const dialog=this.tab.playwright.getByRole('dialog').filter({visible:true}).filter({has:this.tab.playwright.getByText(name,{exact:true})});
    const item=dialog.locator('.tap-model-picker-item').filter({has:this.tab.playwright.getByText(name,{exact:true})});
    await this.unique(item,'exact model card');
    // Scroll the menu itself, then click its whole observed card. A semantic
    // click on offscreen text may hit a different card after hover/layout changes.
    for(let attempt=0;attempt<8;attempt++) {
      const state=await item.evaluate(e=>{
        const r=e.getBoundingClientRect();let p=e.parentElement;
        while(p && !(p.scrollHeight>p.clientHeight+5 && /auto|scroll/.test(getComputedStyle(p).overflowY)))p=p.parentElement;
        const a=p?.getBoundingClientRect();
        const top=Math.max(4,a?.top||4),bottom=Math.min(innerHeight-4,a?.bottom||innerHeight-4);
        const delta=r.top+r.height/2-(top+bottom)/2;
        return {visible:r.top>=top && r.bottom<=bottom,direction:delta<0?'up':'down',
          pages:Math.min(.35,Math.max(.02,Math.abs(delta)/innerHeight)),y:r.y,point:a?[a.x+a.width/2,(top+bottom)/2]:null};
      });
      if(state.visible)break;
      if(!state.point || attempt===7)throw Error('Exact model card cannot be brought into view');
      await this.native.getScreenshot({emit:false}); await this.native.scroll(state.point,state.direction,state.pages);
      let previous=state.y,stableSince=0;const end=Date.now()+2000;
      while(Date.now()<end) {
        const y=await item.evaluate(e=>e.getBoundingClientRect().y);
        if(Math.abs(y-state.y)>1 && Math.abs(y-previous)<.25) {
          if(!stableSince)stableSince=Date.now();
          if(Date.now()-stableSince>=60)break;
        } else stableSince=0;
        previous=y;
      }
    }
    await this.native.getScreenshot({emit:false});
    await this.observedClick(item,{nativeInput:true});
    if ((await button.innerText()).trim()!==name) throw Error('Exact model was not selected');
  }
  async createVideoDraft(title) {
    return this.createDraft(title,'video');
  }
  async createImageDraft(title) {
    return this.createDraft(title,'image');
  }
  async createDraft(title,kind) {
    if(!['video','image'].includes(kind)||!title?.trim())throw Error('A draft type and title are required');
    const dock=this.tab.playwright.getByTestId('canvas-dockbar-add-node-btn');
    if(!await dock.count()) await this.ensureCanvasTools();
    const before=await this.readCanvas();
    await this.observedClick(dock);
    const option=this.tab.playwright.getByTestId('canvas-dockbar-add-'+kind+'-node-btn');
    await this.observedClick(option);
    // Creation and menu teardown can finish in different frames. Observe the new ID
    // first; never interpret a slow-closing menu as permission to create again.
    const old=new Set(before.nodes.map(n=>n.id)); let added=[]; const deadline=Date.now()+5000;
    while (!added.length && Date.now()<deadline) added=(await this.readCanvas()).nodes.filter(n=>!old.has(n.id));
    if (added.length!==1 || !added[0].id.startsWith(kind+'-')) throw Error('Draft creation outcome ambiguous; do not create again');
    const menuDeadline=Date.now()+3000;
    while (await option.count() && await option.isVisible()) {
      if(Date.now()>menuDeadline)throw Error('Draft exists but creation menu remains open; do not create again');
    }
    const id=added[0].id, input=this.node(id).getByPlaceholder('Please enter a title',{exact:true});
    this.lastDraft={id,title};
    await input.fill(title); await input.press('Enter');
    return {id,title};
  }
  async ensureCanvasTools() {
    if(await this.tab.playwright.getByRole('button',{name:'Node search',exact:true}).count())return;
    // A real outside pointer action closes the editor's temporary focus mode;
    // merely focusing another control or pressing Escape does not restore it.
    await this.observedClick(this.tab.playwright.getByRole('button',{name:'Rename canvas',exact:true}));
    await this.tab.playwright.getByRole('textbox',{name:'Rename canvas',exact:true}).press('Escape');
    await this.tab.playwright.getByRole('button',{name:'Node search',exact:true}).waitFor({state:'visible',timeoutMs:2500});
  }
  async bindFrames(id, first, last) {
    const sources=[first,last], roles=['firstFrame','lastFrame'];
    for (let i=0;i<2;i++) {
      const expected=await this.sourceImage(sources[i].id);
      const key=src=>src?.replace(/[?&]variant_name=[^&]*/,'');
      const existing=this.node(id).locator('img[alt="'+roles[i]+'"]');
      if (await existing.count()) {
        if (key(await existing.getAttribute('src'))!==expected) throw Error('Existing input does not match role '+roles[i]);
        continue;
      }
      const empty=this.node(id).locator('button').filter({has:this.tab.playwright.locator('svg.lucide-plus')});
      if (await empty.count()!==2-i) throw Error('Unexpected frame slot count');
      await this.activate(empty.nth(0));
      await this.bindCanvasSource(id,sources[i].id);
      await this.waitSourcePickerClosed();
      if (!(await this.readCanvas()).nodes.find(n=>n.id===id)?.selected) await this.selectNodes([id]);
      await existing.waitFor({state:'visible',timeoutMs:3000});
      if (key(await existing.getAttribute('src'))!==expected) throw Error('Frame role mismatch: '+roles[i]);
    }
    for (const source of sources) await this.tab.playwright.locator('.react-flow__edge[aria-label="Edge from '+source.id+' to '+id+'"]').waitFor({state:'attached',timeoutMs:3000});
    return {first:first.id,last:last.id};
  }
  async sourceImage(id) {
    const images=this.node(id).locator('img[src^="http"]');
    // After unstack/Undo the card can exist before its lazy preview is restored.
    if (!await images.count()) await images.waitFor({state:'visible',timeoutMs:3000});
    const urls=await images.evaluateAll(es=>es.map(e=>e.getAttribute('src')));
    const assets=[...new Set(urls.map(src=>src.replace(/[?&]variant_name=[^&]*/,'')))];
    if(assets.length!==1)throw Error('Source media identity ambiguous');
    return assets[0];
  }
  async chooseCanvasSource(id,{nativeInput=false}={}) {
    // Reference mode installs its own click surface. Wait for that public DOM
    // element rather than clicking the ordinary node before the mode is ready.
    const surface=this.node(id).locator('div.z-30.pointer-events-auto.cursor-pointer');
    await surface.waitFor({state:'visible',timeoutMs:3000});
    // Refresh the native tab's current screenshot mapping locally. This does not
    // send an image for model recognition and avoids stale mapping after pan/zoom.
    if(nativeInput)await this.native.getScreenshot({emit:false});
    await this.observedClick(surface,{nativeInput});
  }
  async waitSourcePickerClosed() {
    const exit=this.tab.playwright.getByRole('button',{name:'Exit',exact:true}),deadline=Date.now()+3000;
    while(await exit.count() && await exit.isVisible()) {
      if(Date.now()>deadline)throw Error('Reference edge exists but picker remains open; inspect before continuing');
    }
  }
  async bindCanvasSource(draftId,sourceId) {
    const edge=this.tab.playwright.locator('.react-flow__edge[aria-label="Edge from '+sourceId+' to '+draftId+'"]');
    await this.chooseCanvasSource(sourceId);
    const deadline=Date.now()+700;
    while(!await edge.count() && Date.now()<deadline)await this.readCanvas();
    if(!await edge.count()){
      const exit=this.tab.playwright.getByRole('button',{name:'Exit',exact:true});
      if(await exit.count()!==1 || !await exit.isVisible())throw Error('Input outcome unknown; inspect before repeating');
      // The same picker is still active and the exact link is absent. Refresh
      // native coordinate mapping once, then correct this unconsumed UI click.
      // Never retry if the picker closed or an edge already exists.
      await this.chooseCanvasSource(sourceId,{nativeInput:true});
      this.recoveredInputClicks=(this.recoveredInputClicks||0)+1;
    }
    await edge.waitFor({state:'attached',timeoutMs:3000});
  }
  async placeDraft(id) {
    const beforeMove=await this.readCanvas(), v=beforeMove.viewport;
    const area={x:(75-v.x)/v.scale,y:(75-v.y)/v.scale,width:(v.width-105)/v.scale,height:(v.height-145)/v.scale};
    const plan=this.geometry.planFreeSpace(beforeMove.nodes,[id],{area});
    if (Math.abs(plan.dx)+Math.abs(plan.dy)>.1) {
      const afterMove=await this.moveSelected([id],plan), check=this.geometry.compareCanvas(beforeMove,afterMove,[id]);
      if (!check.ok || collisionPairs(afterMove.nodes).some(p=>p.includes(id))) throw Error('Draft placement not verified: '+JSON.stringify(check));
    }
  }
  async bindReferences(id, sources) {
    if (!sources.length || new Set(sources.map(s=>s.id)).size!==sources.length) throw Error('Invalid reference list');
    const key=src=>src?.replace(/[?&]variant_name=[^&]*/,'');
    const expected=[];
    for (const source of sources) {
      expected.push(await this.sourceImage(source.id));
    }
    const refs=this.node(id).locator('img[alt="referenceImage"]');
    let actual=await refs.evaluateAll(es=>es.map(e=>e.getAttribute('src')));
    if (actual.length>expected.length || actual.some((src,i)=>key(src)!==expected[i])) throw Error('Existing reference order differs; preserve it and inspect');
    for (let i=actual.length;i<sources.length;i++) {
      await this.activate(this.node(id).locator('button').filter({has:this.tab.playwright.locator('svg.lucide-plus')}));
      await this.bindCanvasSource(id,sources[i].id);
      await this.waitSourcePickerClosed();
      if (!(await this.readCanvas()).nodes.find(n=>n.id===id)?.selected) await this.selectNodes([id]);
      await refs.nth(i).waitFor({state:'visible',timeoutMs:3000});
      if (key(await refs.nth(i).getAttribute('src'))!==expected[i]) throw Error('Reference order mismatch');
    }
    for (const source of sources) await this.tab.playwright.locator('.react-flow__edge[aria-label="Edge from '+source.id+' to '+id+'"]').waitFor({state:'attached',timeoutMs:3000});
    return expected;
  }
  parameterGroup(dialog,label) {
    return dialog.locator('div.p-2').filter({has:this.tab.playwright.getByText(label,{exact:true})});
  }
  async parameterState(dialog) {
    return dialog.locator('div.p-2').evaluateAll(es=>es.map(g=>({
      label:g.firstElementChild?.textContent?.trim(),
      options:[...g.querySelectorAll('button')].map(b=>({value:b.textContent?.trim(),
        selected:b.classList.contains('text-foreground'),disabled:b.disabled||b.getAttribute('aria-disabled')==='true'})),
      limits:[...g.querySelectorAll('input')].map(i=>({min:Number(i.min),max:Number(i.max),step:Number(i.step),value:i.value}))
    })));
  }
  async configureParameters(id,request) {
    const dialog=await this.openParams(id), switches={};
    for(const [label,value] of [['Aspect Ratio',request.aspect],['Resolution',request.resolution]])
      if(value)await this.choose(this.parameterGroup(dialog,label),value);
    let duration;
    if(id.startsWith('video-')) {
      const groups=await this.parameterState(dialog), group=groups.find(g=>g.label==='Duration');
      if(!group)throw Error('Current model duration control missing');
      const values=group.options.filter(o=>!o.disabled && /^\d+(?:\.\d+)?s$/.test(o.value)).map(o=>Number(o.value.slice(0,-1)));
      duration=chooseDuration(request.targetSeconds??parseFloat(request.duration),{values,...group.limits[0]});
      const durationGroup=this.parameterGroup(dialog,'Duration');
      if(values.includes(duration.actualSeconds))await this.choose(durationGroup,duration.actualSeconds+'s');
      else {
        const input=durationGroup.locator('input');
        await this.unique(input,'numeric duration input');
        await input.fill(String(duration.actualSeconds));await input.press('Tab');
        if(Number(await input.evaluate(e=>e.value))!==duration.actualSeconds)
          throw Error('Numeric duration was not accepted');
      }
      for(const [label,enabled] of [['Generate Audio',request.audio===true],['Turbo',request.turbo===true]]) {
        const group=this.parameterGroup(dialog,label);
        if(!await group.count()) {
          if(enabled)throw Error(label+' is not exposed by this model');
          switches[label]='not exposed';continue;
        }
        await this.choose(group,enabled?'On':'Off'); switches[label]=enabled?'On':'Off';
      }
    }
    if(request.quality)await this.choose(this.parameterGroup(dialog,'Quality'),request.quality);
    const state=await this.parameterState(dialog);
    await this.closeParams(id);
    return {state,duration,switches};
  }
  async readyEvidence(id) {
    return this.node(id).evaluate(e=>({
      model:e.querySelector('[data-testid$="-model-select"]')?.textContent?.trim(),
      prompt:e.querySelector('[contenteditable="true"]')?.textContent,
      inputs:[...e.querySelectorAll('img[alt="firstFrame"],img[alt="lastFrame"],img[alt="referenceImage"]')].map(i=>({role:i.alt,src:i.getAttribute('src')})),
      mentions:[...e.querySelectorAll('[data-mention-node-view]')].map(m=>({title:m.textContent,src:m.querySelector('img')?.getAttribute('src')})),
      variations:e.querySelector('button[aria-label^="Generate "]')?.getAttribute('aria-label'),
      ready:!!e.querySelector('[data-testid="canvas-node-generate-btn"]:not(:disabled)')
    }));
  }
  async prepareFrames(request) {return this.prepareNode(request,'frames');}
  async prepareReference(request) {return this.prepareNode(request,'reference');}
  async prepareImage(request) {return this.prepareNode(request,'image');}
  async prepareNode(request,kind) {
    const references=request.references||[], source=kind==='frames'?request.first:references[0];
    if(kind==='reference'&&!references.length)throw Error('Reference sources required');
    if(!request.draft && source)await this.navigate(source);
    const draft=request.draft || await this.createDraft(request.title,kind==='image'?'image':'video');
    this.lastDraft=draft;
    if(!(await this.readCanvas()).nodes.find(n=>n.id===draft.id)?.selected)await this.selectNodes([draft.id]);
    await this.setModel(draft.id,request.model);
    let mode;
    if(kind!=='image') {
      const dialog=await this.openParams(draft.id), methods=this.parameterGroup(dialog,'Generate method');
      const state=await this.parameterState(dialog), choices=state.find(g=>g.label==='Generate method')?.options||[];
      const available=choices.filter(o=>!o.disabled && (kind==='frames'?o.value==='Frames':/^(Omni )?Reference$/.test(o.value)));
      if(available.length!==1)throw Error('Requested generation mode missing or ambiguous');
      mode=available[0].value;await this.choose(methods,mode); await this.closeParams(draft.id);
    }
    if(this.setZoom && Math.abs((await this.readCanvas()).viewport.scale-(request.zoom||.5))>.0001)
      await this.setZoom(this.tab,request.zoom||.5);
    await this.placeDraft(draft.id);
    if(kind==='frames')await this.bindFrames(draft.id,request.first,request.last);
    else if(references.length)await this.bindReferences(draft.id,references);
    const parameters=await this.configureParameters(draft.id,request);
    const editor=this.node(draft.id).locator('[data-testid="canvas-node-prompt-textarea"] [contenteditable="true"]');
    const editingRoom=await editor.evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=75&&r.y>=75&&r.right<=innerWidth-30&&r.bottom<=innerHeight-85;});
    // A card can fit while its expanded editor is clipped. Center the existing
    // draft after binding; do not drag original sources to make room for menus.
    if(!editingRoom)await this.navigate(draft);
    if(kind==='reference' || request.promptParts) {
      const parts=request.promptParts||[request.prompt,...references.flatMap(r=>[' ',{mention:r.id}])];
      await this.setMentionPrompt(draft.id,parts,references);
    } else await this.setPrompt(editor,request.prompt);
    const evidence=await this.readyEvidence(draft.id);
    evidence.parameters=parameters; evidence.mode=mode; evidence.summary=await this.paramButton(draft.id).innerText();
    if(evidence.model!==request.model || !evidence.ready || evidence.variations!=='Generate 1 variations' ||
      evidence.inputs.length!==(kind==='frames'?2:references.length) || (mode&&!evidence.summary.includes(mode)))
      throw Error('Final preparation verification failed: '+JSON.stringify(evidence));
    return {draft,evidence,generationCalled:false};
  }
  async prepareUpscale(request) {
    let draft=request.draft;
    if(!draft) {
      await this.navigate(request.source);
      const before=await this.readCanvas();
      const icon=this.node(request.source.id).locator('button').filter({has:this.tab.playwright.locator('svg path[d^="M16.1113 4.02734"]')});
      await this.activate(icon);
      const old=new Set(before.nodes.map(n=>n.id)),end=Date.now()+5000;let added=[];
      while(!added.length&&Date.now()<end)added=(await this.readCanvas()).nodes.filter(n=>!old.has(n.id));
      if(added.length!==1||!added[0].id.startsWith('video-'))throw Error('Upscale draft creation ambiguous; do not replay');
      draft={id:added[0].id,title:request.title};this.lastDraft=draft;
      const input=this.node(draft.id).getByPlaceholder('Please enter a title',{exact:true});
      await input.fill(request.title);await input.press('Enter');
    } else await this.selectNodes([draft.id]);
    this.lastDraft=draft;
    const node=this.node(draft.id);
    const labels=[['Model',request.model],['Video HD Resolution',request.resolution],
      ['Video Frame Rate (Optional)',request.frameRate||'Adaptive'],['Video Slow Motion Rate (Optional)',request.slowMotion||'Adaptive']];
    const values={};
    for(const [label,value] of labels) {
      const combo=node.locator('div.mb-6').filter({has:this.tab.playwright.getByText(label,{exact:true})}).getByRole('combobox');
      const end=Date.now()+5000;
      while(!await combo.isEnabled())if(Date.now()>end)throw Error('Upscale options still loading; preserve the existing draft');
      if((await combo.innerText()).trim()!==value) {
        await this.activate(combo);
        await this.activate(this.tab.playwright.getByRole('listbox').getByRole('option',{name:value,exact:true}));
      }
      values[label]=(await combo.innerText()).trim();
      if(values[label]!==value)throw Error('Upscale parameter mismatch: '+label);
    }
    const edge=this.tab.playwright.locator('.react-flow__edge[aria-label="Edge from '+request.source.id+' to '+draft.id+'"]');
    if(await edge.count()!==1)throw Error('Upscale source edge mismatch');
    const sourceAssets=(await this.readCanvas()).nodes.find(n=>n.id===request.source.id)?.media||[];
    const thumbnail=await node.locator('img[alt="Video thumbnail"]').getAttribute('src');
    if(!sourceAssets.some(m=>m.src===thumbnail?.replace(/[?&]variant_name=[^&]*/,'')))throw Error('Upscale source thumbnail mismatch');
    const ready=await node.getByRole('button',{name:'Video Upscale',exact:true}).isEnabled();
    if(!ready)throw Error('Upscale quotation not ready');
    return {draft,evidence:{source:request.source,values,thumbnail,ready},generationCalled:false};
  }
  async prepareExtend(request) {
    await this.navigate(request.source);
    const icon=this.node(request.source.id).locator('button').filter({has:this.tab.playwright.locator('svg.tabler-icon-time-duration-30')});
    await this.activate(icon);
    const region=this.tab.playwright.getByRole('region',{name:'Video Creation Beta',exact:true});
    await region.waitFor({state:'visible',timeoutMs:3000});
    const opener=region.getByRole('button',{name:'Continue video (Beta)',exact:true});
    await this.activate(opener);
    const dialog=this.tab.playwright.getByRole('dialog').filter({visible:true}).filter({has:this.tab.playwright.getByRole('button',{name:'Add prologue',exact:true})});
    for (const value of [request.operation,request.duration,request.continuity]) await this.activate(dialog.getByRole('button',{name:value,exact:true}));
    await this.activate(opener);
    await this.setPrompt(region.locator('[contenteditable="true"]'),request.prompt);
    const evidence={source:request.source,summary:await region.innerText(),
      prompt:await region.locator('[contenteditable="true"]').textContent(),
      ready:await region.getByRole('button',{name:'Confirm and generate',exact:true}).isEnabled()};
    for (const value of [request.operation,request.duration,request.continuity])
      if (!evidence.summary.includes(value)) throw Error('Extension summary mismatch: '+value);
    if (!evidence.ready || evidence.prompt!==request.prompt) throw Error('Extension draft not ready');
    return {...evidence,generationCalled:false};
  }
  async selectNodes(ids) {
    const canvas=await this.readCanvas();
    if (!ids.length || new Set(ids).size!==ids.length) throw Error('Invalid node selection');
    const wanted=[...ids].sort();
    if (JSON.stringify(canvas.nodes.filter(n=>n.selected).map(n=>n.id).sort())===JSON.stringify(wanted)) return canvas;
    if(ids.length===canvas.nodes.length && canvas.nodes.every(n=>ids.includes(n.id)))
      throw Error('Whole-canvas selection is not verified; use a confirmed workset or the current UI selection tool');
    // The node's documented Enter action selects it without needing its body to
    // be visible. This app adds nodes through Shift-click, not Shift+Enter.
    const ordered=ids.map(id=>canvas.nodes.find(n=>n.id===id));
    if (ordered.some(n=>!n)) throw Error('Selection IDs missing');
    ordered.sort((a,b)=>a.screen.y-b.screen.y);
    for (let i=0;i<ordered.length;i++) {
      if(i===0)await this.node(ordered[i].id).press('Enter');
      else await this.observedClick(this.node(ordered[i].id),{nodeBody:true,modifiers:['Shift']});
      await this.node(ordered[i].id).and(this.tab.playwright.locator('.selected')).waitFor({state:'visible',timeoutMs:1500});
    }
    const deadline=Date.now()+1500;
    while(Date.now()<deadline){
      const after=await this.readCanvas(), selected=after.nodes.filter(n=>n.selected).map(n=>n.id).sort();
      if(JSON.stringify(selected)===JSON.stringify(wanted))return after;
    }
    throw Error('Selection identity mismatch');
  }
  async arrangeSelected(ids, kind='Grid Layout') {
    if (!['Grid Layout','Horizontal Layout'].includes(kind)) throw Error('Unsupported layout');
    await this.selectNodes(ids);
    await this.activate(this.tab.playwright.getByRole('button',{name:'Layout',exact:true}));
    await this.activate(this.tab.playwright.getByRole('menuitem',{name:kind,exact:true}));
    return this.readCanvas();
  }
  async archiveSelected(ids, kind) {
    if(!['Group','Stack'].includes(kind)||ids.length<2)throw Error('Group/Stack requires at least two exact nodes');
    const before=await this.selectNodes(ids), wanted=new Set(ids);
    if(ids.some(id=>!before.nodes.find(n=>n.id===id)||!/^(image|video)-/.test(id)))
      throw Error('Nested containers require separate structure verification');
    const expected=before.nodes.filter(n=>wanted.has(n.id));
    if(kind==='Stack' && expected.some(n=>!n.media.length))throw Error('Load source previews before stacking');
    await this.activate(this.tab.playwright.getByRole('button',{name:kind,exact:true}));
    let after,added;const deadline=Date.now()+3000;
    do {after=await this.readCanvas();added=after.nodes.filter(n=>!before.nodes.some(b=>b.id===n.id));}
    while(!added.length&&Date.now()<deadline);
    if(added.length!==1||!added[0].id.startsWith(kind==='Group'?'group-':'pile-'))
      throw Error('Container creation outcome ambiguous; inspect before repeating');
    const unchangedBefore={nodes:before.nodes.filter(n=>!wanted.has(n.id)),edges:before.edges};
    const unchangedAfter={nodes:after.nodes.filter(n=>!wanted.has(n.id)&&n.id!==added[0].id),edges:after.edges};
    const audit=this.geometry.compareCanvas(unchangedBefore,unchangedAfter,[]);
    if(!audit.ok || ids.some(id=>!after.nodes.some(n=>n.id===id)))throw Error('Archive changed outside nodes or removed members');
    if(kind==='Group'){
      if(!this.geometry.compareCanvas(before,{nodes:after.nodes.filter(n=>n.id!==added[0].id),edges:after.edges},[]).ok)
        throw Error('Grouping changed source identities or positions');
      await this.tab.playwright.getByRole('button',{name:'Ungroup',exact:true}).waitFor({state:'visible',timeoutMs:2000});
    }else{
      const pile=this.node(added[0].id).getByRole('button',{name:'Pile, node count: '+ids.length,exact:true});
      await pile.waitFor({state:'visible',timeoutMs:2000});
      const members=await pile.locator('img').evaluateAll(es=>es.map(e=>({title:e.alt,src:e.getAttribute('src')?.replace(/[?&]variant_name=[^&]*/,'')})));
      if(members.length!==ids.length || expected.some(n=>!members.some(m=>m.title===n.title&&n.media.some(a=>a.src===m.src))))
        throw Error('Pile members do not match selected source identities');
    }
    return {kind,container:added[0],memberIds:ids,before,after,audit};
  }
  async moveSelected(ids, plan) {
    let canvas=await this.readCanvas();
    const wanted=[...ids].sort();
    if (!ids.length || JSON.stringify(canvas.nodes.filter(n=>n.selected).map(n=>n.id).sort())!==JSON.stringify(wanted)) throw Error('Select exact nodes before moving');
    const initial=canvas.nodes.find(n=>n.id===ids[0]), goal={x:initial.x+plan.dx,y:initial.y+plan.dy};
    const snap=this.tab.playwright.getByRole('button',{name:'Snap to Grid',exact:true});
    const restoreSnap=await snap.count()===1 && await snap.getAttribute('data-active')==='true';
    if (restoreSnap) await this.activate(snap);
    try {
      for (let attempt=0;attempt<80;attempt++) {
        const current=canvas.nodes.find(n=>n.id===ids[0]), dx=goal.x-current.x,dy=goal.y-current.y;
        if (Math.abs(dx)<=3 && Math.abs(dy)<=3) return canvas;
        const horizontal=Math.abs(dx)>=Math.abs(dy), distance=horizontal?dx:dy;
        const arrow=horizontal?(distance>0?'ArrowRight':'ArrowLeft'):(distance>0?'ArrowDown':'ArrowUp');
        const mode=Math.abs(distance)>24?'shift':'normal', step=this.keyboardSteps?.[mode];
        // Learn the actual step once at this viewport/zoom, then batch a bounded
        // number of identical keys. Verify the resulting displacement each batch.
        const count=step?Math.max(1,Math.min(20,Math.floor(Math.abs(distance)/step))):1;
        for(let i=0;i<count;i++)await this.node(ids[0]).press((mode==='shift'?'Shift+':'')+arrow);
        let previous=null,stable=0,settled=false; const deadline=Date.now()+1500;
        while (Date.now()<deadline) {
          const next=await this.readCanvas(), n=next.nodes.find(n=>n.id===ids[0]);
          if (!n || JSON.stringify(next.nodes.filter(n=>n.selected).map(n=>n.id).sort())!==JSON.stringify(wanted)) throw Error('Keyboard move lost selection');
          if (previous && n.x===previous.x && n.y===previous.y && (n.x!==current.x || n.y!==current.y)) {
            if (!stable) stable=Date.now();
            if (Date.now()-stable>=50) {canvas=next;settled=true;break;}
          } else stable=0;
          previous=n;
        }
        if (!settled) throw Error('Keyboard movement not observed; inspect focus before using drag fallback');
        const n=canvas.nodes.find(n=>n.id===ids[0]);
        if ((horizontal?n.x-current.x:n.y-current.y)*distance<=0) throw Error('Keyboard move went in the wrong direction');
        const observed=Math.abs(horizontal?n.x-current.x:n.y-current.y)/count;
        if(step && Math.abs(observed-step)>Math.max(1,step*.15))throw Error('Keyboard step changed; inspect current view before continuing');
        this.keyboardSteps[mode]=observed;
      }
      throw Error('Move needs too many key steps; choose a nearer workspace or a new canvas');
    } finally {if(restoreSnap)await this.activate(snap);}
  }
  // Explicit fallback after current UI verification; not automatically replayed on failure.
  async dragSelected(ids, plan) {
    let canvas=await this.readCanvas(); const selected=canvas.nodes.filter(n=>n.selected).map(n=>n.id).sort();
    if (JSON.stringify(selected)!==JSON.stringify([...ids].sort())) throw Error('Select exact nodes before moving');
    const initial=canvas.nodes.find(n=>n.id===ids[0]), goal={x:initial.x+plan.dx,y:initial.y+plan.dy};
    const snap=this.tab.playwright.getByRole('button',{name:'Snap to Grid',exact:true});
    const restoreSnap=await snap.count()===1 && await snap.getAttribute('data-active')==='true';
    if (restoreSnap) await this.activate(snap);
    try {
      for (let attempt=0;attempt<3;attempt++) {
        const current=canvas.nodes.find(n=>n.id===ids[0]), dx=goal.x-current.x,dy=goal.y-current.y;
        // Very short drags may become clicks. Accept an already non-overlapping position;
        // the caller still checks outside collisions before considering placement complete.
        if (Math.hypot(dx,dy)*canvas.viewport.scale<16) return canvas;
        let point=null; const readyDeadline=Date.now()+2500;
        while (!point && Date.now()<readyDeadline) point=await this.node(ids[0]).evaluate(e=>{
          const r=e.getBoundingClientRect();
          // Prefer the plain card edge. The center may hit an SVG/play surface
          // that selects the node but does not start a canvas drag.
          for (const [fx,fy] of [[.03,.05],[.97,.5],[.5,.5]]) {
            const x=r.x+r.width*fx,y=r.y+r.height*fy,h=document.elementFromPoint(x,y);
            if (h?.closest('.react-flow__node')===e && !h.closest('button,input,textarea,[contenteditable="true"],.nodrag')) return [x,y];
          }
          return null;
        });
        if (!point || !canvas.viewport) throw Error('No unoccluded drag handle');
        const gain=this.dragGain || 1;
        const target=[point[0]+dx*canvas.viewport.scale/gain,point[1]+dy*canvas.viewport.scale/gain];
        if (target[0]<75 || target[0]>canvas.viewport.width-30 || target[1]<75 || target[1]>canvas.viewport.height-70)
          throw Error('Planned zone is outside viewport; pan/zoom or choose a fresh canvas before dragging');
        await this.native.drag(point,target);
        const next=await this.readCanvas(), actual=next.nodes.find(n=>n.id===ids[0]);
        if (!actual?.selected) throw Error('Drag lost node selection');
        const observedGain=((actual.x-current.x)*dx+(actual.y-current.y)*dy)/(dx*dx+dy*dy)*gain;
        if (observedGain<.4 || observedGain>1.3) throw Error('Drag did not move the expected node');
        this.dragGain=observedGain; canvas=next;
      }
      const final=canvas.nodes.find(n=>n.id===ids[0]);
      if (Math.hypot(final.x-goal.x,final.y-goal.y)>4) throw Error('Drag did not reach planned zone');
    }
    finally { if (restoreSnap) await this.activate(snap); }
    return canvas;
  }
}
