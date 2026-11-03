const test = require('node:test');
const assert = require('node:assert/strict');
const helper = import('./download-result.js');

function fixture({scoped = false, count = 1, visible = true, enabled = true, localPath = 'C:\\test\\original.mp4', clickError = false} = {}) {
  const calls = [];
  const button = {count: async () => count, isVisible: async () => visible, isEnabled: async () => enabled,
    click: async () => {calls.push('click'); if (clickError) throw Error('click unavailable');}};
  const tab = {playwright: {
    getByRole(role, options) {
      assert.equal(scoped, false); assert.equal(role, 'button');
      assert.equal(options.name, 'Download'); assert.equal(options.exact, true); return button;
    },
    waitForEvent: async name => {
      assert.equal(name, 'download'); calls.push('listen');
      return {path: async () => {calls.push('path'); return localPath;}};
    },
  }};
  return {calls, run: async () => (await helper).downloadTapnowResult(tab, scoped ? {downloadControl: button} : {})};
}

test('scoped toolbar download bypasses global lookup and listens before one click', async () => {
  const f = fixture({scoped: true}), result = await f.run();
  assert.equal(result.method, 'scoped-download-button');
  assert.equal(result.path, 'C:\\test\\original.mp4');
  assert.deepEqual(f.calls, ['listen', 'click', 'path']);
});

test('default unique Download still works', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.method, 'detail-download-button');
  assert.deepEqual(f.calls, ['listen', 'click', 'path']);
});

test('ambiguous, hidden or disabled targets stop before starting a download', async () => {
  for (const options of [{count: 2}, {visible: false}, {enabled: false}]) {
    const f = fixture({scoped: true, ...options});
    await assert.rejects(f.run(), /Expected one visible, enabled Download/);
    assert.deepEqual(f.calls, []);
  }
});

test('missing path and failed click do not automatically repeat the download', async () => {
  const noPath = fixture({scoped: true, localPath: ''});
  await assert.rejects(noPath.run(), /inspect transfer status before retrying/);
  assert.deepEqual(noPath.calls, ['listen', 'click', 'path']);
  const failedClick = fixture({scoped: true, clickError: true});
  await assert.rejects(failedClick.run(), /click unavailable/);
  assert.deepEqual(failedClick.calls, ['listen', 'click']);
});
