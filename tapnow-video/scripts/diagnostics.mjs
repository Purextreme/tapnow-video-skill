import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readdir, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';

// The CUA runtime may omit Node's process global.
const env = typeof process === 'undefined' ? {} : process.env;
const directory = env.TAPNOW_LOG_DIR || (platform() === 'win32'
  ? join(homedir(), 'Documents', 'Codex', '.tapnow-skill', 'logs')
  : join(homedir(), '.local', 'state', 'tapnow-skill', 'logs'));
const maxBytes = 128 * 1024, maxFiles = 12, maxAgeMs = 14 * 86400000;
const logName = /^tapnow-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[\da-f-]{36}\.jsonl$/;
const stamp = time => new Date(time).toISOString().replace(/[:.]/g, '-');
const operations = ['prepare', 'upload', 'layout', 'download', 'generate', 'session'];
const routes = ['mcp', 'dom', 'chooser', 'browser-api', 'local-api', 'position-api', 'visual'];
const stages = ['preflight', 'chooser', 'set-files', 'verify', 'canvas-read', 'configure', 'audit',
  'init', 'transfer', 'complete', 'original', 'node-create', 'batch', 'position-api', 'control', 'submit', 'result'];
const outcomes = ['failed', 'uncertain', 'fallback', 'slow', 'recovered'];
const reasons = ['timeout', 'unverified', 'upload-terminal', 'network-or-page', 'browser-session',
  'control-or-readiness', 'unknown', 'budget', 'rate-or-service-stop', 'access-denied', 'api-stopped'];
let segment, lastSweepDay, pending = Promise.resolve();

function enqueue(work) {
  if (!isAbsolute(directory)) return Promise.resolve(false);
  pending = pending.then(work).catch(() => false);
  return pending;
}

async function prune(now) {
  const root = await lstat(directory).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!root?.isDirectory()) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const names = entries.filter(entry => entry.isFile() && logName.test(entry.name)).map(entry => entry.name).sort().reverse();
  const cutoff = `tapnow-${stamp(now - maxAgeMs)}-`;
  for (const [index, name] of names.entries()) {
    if (name < cutoff || index >= maxFiles) {
      // Only unlink this logger's ordinary files. A busy file can be retried on the next sweep.
      await unlink(join(directory, name)).catch(() => {});
      if (segment?.name === name) segment = undefined;
    }
  }
  lastSweepDay = stamp(now).slice(0, 10);
}

export function maintainTapnowLogs() {
  return enqueue(async () => {
    const now = Date.now();
    if (stamp(now).slice(0, 10) !== lastSweepDay) await prune(now);
    return true;
  });
}

export function recordTapnowEvent({ operation, route, stage, outcome, reason, elapsedMs, httpStatus, mutationMayBeInFlight } = {}) {
  if (!operations.includes(operation) || !routes.includes(route) || !stages.includes(stage) || !outcomes.includes(outcome))
    return Promise.resolve(false);
  return enqueue(async () => {
    const now = Date.now(), day = stamp(now).slice(0, 10);
    const event = { time: new Date(now).toISOString(), operation, route, stage, outcome };
    if (reasons.includes(reason)) event.reason = reason;
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) event.elapsedMs = Math.round(elapsedMs);
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) event.httpStatus = httpStatus;
    if (typeof mutationMayBeInFlight === 'boolean') event.mutationMayBeInFlight = mutationMayBeInFlight;
    const line = JSON.stringify(event) + '\n';

    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) return false;
    // A different worker may have pruned our old segment. Check before reusing it.
    const info = segment?.day === day ? await lstat(join(directory, segment.name)).catch(() => null) : null;
    const rotate = !info?.isFile() || info.size + Buffer.byteLength(line) > maxBytes;
    if (rotate) segment = { day, name: `tapnow-${stamp(now)}-${randomUUID()}.jsonl` };
    await appendFile(join(directory, segment.name), line, { encoding: 'utf8', mode: 0o600, flag: rotate ? 'ax' : 'a' });
    if (rotate || lastSweepDay !== day) await prune(now);
    return true;
  });
}
