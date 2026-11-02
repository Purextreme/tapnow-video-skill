// Pure geometry: world units in, world units out. Never sends input to a page.
const valid = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
export function bounds(nodes) {
  if (!nodes.length || !nodes.every(valid)) throw Error('Expected finite nonempty node rectangles.');
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y));
  return { x, y, width: Math.max(...nodes.map(n => n.x + n.width)) - x,
    height: Math.max(...nodes.map(n => n.y + n.height)) - y };
}
export function collisionPairs(nodes, gap = 0) {
  if (!nodes.every(valid)) throw Error('Invalid node geometry.');
  const out = [];
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    if (sorted[j].x >= sorted[i].x + sorted[i].width + gap) break;
    if (overlaps(sorted[i], sorted[j], gap)) out.push([sorted[i].id, sorted[j].id]);
  }
  return out;
}
export function planFreeSpace(nodes, selectedIds, { gap = 80, paddingTop = 70, paddingBottom = 180, area = null } = {}) {
  if (!Number.isFinite(gap) || gap < 0 || !nodes.every(valid)) throw Error('Invalid geometry or gap.');
  const ids = new Set(selectedIds), moving = nodes.filter(n => ids.has(n.id));
  if (ids.size !== selectedIds.length || moving.length !== ids.size || !moving.length) throw Error('Missing or duplicate selection IDs.');
  const box = bounds(moving);
  const reserved = n => ({...n, y: n.y - paddingTop, height: n.height + paddingTop + paddingBottom});
  const obstacles = nodes.filter(n => !ids.has(n.id)).map(reserved);
  const footprint = reserved(box);
  const xs = new Set([footprint.x]), ys = new Set([footprint.y]);
  if (area) {
    if (!valid(area)) throw Error('Invalid visible world area');
    xs.add(area.x); xs.add(area.x+area.width-footprint.width);
    ys.add(area.y); ys.add(area.y+area.height-footprint.height);
  }
  for (const r of obstacles) {
    xs.add(r.x + r.width + gap); xs.add(r.x - footprint.width - gap);
    ys.add(r.y + r.height + gap); ys.add(r.y - footprint.height - gap);
  }
  const candidates = [];
  for (const x of xs) for (const y of ys) candidates.push({x, y, width: footprint.width, height: footprint.height,
    distance: Math.hypot(x - footprint.x, y - footprint.y)});
  candidates.sort((a,b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const target = candidates.find(c => (!area || (c.x>=area.x && c.y>=area.y && c.x+c.width<=area.x+area.width && c.y+c.height<=area.y+area.height)) &&
    obstacles.every(r => !overlaps(c, r, gap)));
  if (!target) throw Error('No empty zone found.');
  const dx = target.x - footprint.x, dy = target.y - footprint.y;
  return {selectedIds, dx, dy, target: {...box, x: box.x + dx, y: box.y + dy},
    reserved: target, gap, paddingTop, paddingBottom};
}
export function compareCanvas(before, after, movedIds = []) {
  const allowed = new Set(movedIds), prior = new Map(before.nodes.map(n => [n.id,n]));
  const issues = [], moved = [];
  if (before.nodes.length !== after.nodes.length) issues.push('node-count');
  for (const n of after.nodes) {
    const p = prior.get(n.id);
    if (!p) { issues.push('new-node:' + n.id); continue; }
    // Expanded editors contain source thumbnails and mention chips. Compare the
    // node's own media, not those temporary children. Old snapshots may omit it.
    const mediaKey = node => {
      const media=node.primaryMedia || node.media || [];
      const own=media.some(m=>m.tag==='VIDEO')?media.filter(m=>m.tag==='VIDEO'):media;
      return [...new Set(own.map(m=>m.src?.match(/\/uploads\/([\w-]+)/)?.[1] || m.src?.replace(/[?&]variant_name=[^&]*/,'')))].sort();
    };
    const oldMedia=mediaKey(p), newMedia=mediaKey(n);
    if (n.title !== p.title || (oldMedia.length && newMedia.length && JSON.stringify(oldMedia)!==JSON.stringify(newMedia))) issues.push('identity:' + n.id);
    if (Math.abs(n.x-p.x) > .1 || Math.abs(n.y-p.y) > .1) {
      moved.push(n.id); if (!allowed.has(n.id)) issues.push('unselected-moved:' + n.id);
    }
  }
  const edges = s => JSON.stringify(s.edges.map(e => [e.id,e.label]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  if (edges(before) !== edges(after)) issues.push('edges-changed');
  const cross = s => new Set(collisionPairs(s.nodes).filter(([a,b])=>allowed.has(a)!==allowed.has(b)).map(p=>p.sort().join('|')));
  const oldCross = cross(before), newCross = [...cross(after)].filter(k=>!oldCross.has(k));
  if (newCross.length) issues.push('new-cross-collisions');
  return {ok: !issues.length, issues, moved, newCross};
}
