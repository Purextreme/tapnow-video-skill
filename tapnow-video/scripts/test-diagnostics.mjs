import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const event = { operation: 'upload', route: 'chooser', stage: 'verify', outcome: 'uncertain' };
const filename = time => `tapnow-${new Date(time).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.jsonl`;
const logFiles = async directory => (await readdir(directory)).filter(name => name.startsWith('tapnow-'));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tapnow-diagnostics-'));
  const previous = process.env.TAPNOW_LOG_DIR;
  process.env.TAPNOW_LOG_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.TAPNOW_LOG_DIR;
    else process.env.TAPNOW_LOG_DIR = previous;
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  });
  return { directory, logger: await import('./diagnostics.mjs?' + randomUUID()) };
}

test('concurrent diagnostic records only persist allowlisted data', async t => {
  const { directory, logger } = await fixture(t);
  assert.equal(await logger.recordTapnowEvent({ ...event, outcome: 'success' }), false);
  assert.deepEqual(await logFiles(directory), []);
  const writes = await Promise.all(Array.from({ length: 30 }, () => logger.recordTapnowEvent({
    ...event, reason: 'private filename.png', elapsedMs: 32.7, httpStatus: 429,
    mutationMayBeInFlight: true, url: 'https://example.test/?token=secret',
    message: 'authorization: secret', canvasId: 'private-canvas',
  })));
  assert.ok(writes.every(Boolean));
  const files = await logFiles(directory);
  assert.equal(files.length, 1);
  const data = await readFile(join(directory, files[0]), 'utf8');
  const lines = data.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 30);
  for (const { time, ...rest } of lines) {
    assert.ok(Number.isFinite(Date.parse(time)));
    assert.deepEqual(rest, { ...event, elapsedMs: 33, httpStatus: 429, mutationMayBeInFlight: true });
  }
  assert.doesNotMatch(data, /secret|private|https:/);
});

test('maintenance drops expired and excess segments while preserving unrelated files', async t => {
  const { directory, logger } = await fixture(t);
  const now = Date.now();
  const recent = Array.from({ length: 14 }, (_, i) => filename(now - (i + 1) * 60000)).sort().reverse();
  const expired = filename(now - 15 * 86400000);
  const unrelated = 'other-app.jsonl';
  await Promise.all([expired, unrelated].map(name => writeFile(join(directory, name), '{}\n')));
  assert.equal(await logger.maintainTapnowLogs(), true);
  assert.deepEqual(await logFiles(directory), []);
  assert.equal(await readFile(join(directory, unrelated), 'utf8'), '{}\n');
  await Promise.all(recent.map(name => writeFile(join(directory, name), '{}\n')));
  assert.equal(await logger.recordTapnowEvent(event), true);
  const remaining = (await logFiles(directory)).sort().reverse();
  assert.equal(remaining.length, 12);
  assert.deepEqual(remaining.slice(1), recent.slice(0, 11));
});

test('new segments roll on size and UTC date', async t => {
  const { directory, logger } = await fixture(t);
  let now = Date.UTC(2026, 10, 3, 23, 58);
  t.mock.method(Date, 'now', () => now);
  assert.equal(await logger.recordTapnowEvent(event), true);
  const [first] = await logFiles(directory);
  await writeFile(join(directory, first), Buffer.alloc(128 * 1024));
  now += 60000;
  assert.equal(await logger.recordTapnowEvent(event), true);
  assert.equal((await logFiles(directory)).length, 2);
  assert.equal((await stat(join(directory, first))).size, 128 * 1024);
  now += 60000;
  assert.equal(await logger.recordTapnowEvent(event), true);
  const files = await logFiles(directory);
  assert.equal(files.length, 3);
  assert.ok(files.some(name => name.startsWith('tapnow-2026-11-04T')));
});

test('normal preparation stays quiet, while failures and slow runs are logged', async t => {
  const { directory } = await fixture(t);
  const { runPreparedFlow } = await import('./preparation.mjs');
  const controller = {
    readCanvas: async () => ({ nodes: [], edges: [] }),
    collapseChat: async () => {},
    prepareFrames: async () => ({}),
  };
  assert.equal((await runPreparedFlow({ controller, request: {} })).ok, true);
  assert.deepEqual(await logFiles(directory), []);
  assert.equal((await runPreparedFlow({ controller, request: {}, startMs: Date.now() - 21000 })).ok, true);
  const original = new Error('connection unavailable for https://example.test/?token=secret');
  controller.readCanvas = async () => { throw original; };
  await assert.rejects(runPreparedFlow({ controller, request: {} }), error => error === original);
  const [name] = await logFiles(directory);
  const data = await readFile(join(directory, name), 'utf8');
  const [slow, failed] = data.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(slow.outcome, 'slow');
  assert.equal(failed.stage, 'canvas-read');
  assert.equal(failed.reason, 'network-or-page');
  assert.doesNotMatch(data, /secret|https:/);
});

test('a blocked log directory is a harmless failure', async t => {
  const { directory } = await fixture(t);
  const blocked = join(directory, 'blocked');
  await writeFile(blocked, 'unrelated content');
  process.env.TAPNOW_LOG_DIR = blocked;
  const { recordTapnowEvent, maintainTapnowLogs } = await import('./diagnostics.mjs?' + randomUUID());
  await maintainTapnowLogs();
  assert.equal(await recordTapnowEvent(event), false);
  assert.equal(await readFile(blocked, 'utf8'), 'unrelated content');
});
