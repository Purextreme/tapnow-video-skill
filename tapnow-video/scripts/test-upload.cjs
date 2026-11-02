const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = process.argv[2] || path.join(__dirname, 'upload-files.js');
const scenario = process.argv[3];
const cases = ['success', 'early-chooser-error', 'click-error', 'missing-event',
  'ambiguous-control', 'single-only', 'relative-path', 'set-error', 'set-hang',
  'verify-error', 'verify-hang-late-error', 'unverified', 'files-set-only', 'reporter-error', 'late-set-ui-success', 'click-timeout-chooser-open', 'click-error-chooser-open'];
if (!scenario) {
  let failed = 0;
  for (const name of cases) {
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', __filename, script, name],
      { encoding: 'utf8', timeout: 1500 });
    const ok = result.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ': ' + (result.stderr || result.error?.message || result.stdout).split('\n').slice(0, 3).join(' ')}`);
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
} else {
  const watchdog = setTimeout(() => { console.error('Helper did not return within the bounded test window'); process.exit(1); }, 350);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const delay = (ms, value, reject = false) => new Promise((resolve, fail) => setTimeout(() => reject ? fail(new Error(value)) : resolve(value), ms));
  const calls = [];
  const progress = [];
  let selectionCount = 0;
  let verifyCount = 0;
  const chooser = {
    isMultiple() { return scenario !== 'single-only'; },
    setFiles(files) {
      calls.push('set'); selectionCount++;
      if (scenario === 'set-error') return Promise.reject(new Error('File delivery failed'));
      if (['set-hang', 'late-set-ui-success'].includes(scenario)) return new Promise(() => {});
      assert.equal(files.length, 2);
      return Promise.resolve();
    },
  };
  const tab = { playwright: {
    waitForEvent(name) {
      assert.equal(name, 'filechooser'); calls.push('listen');
      if (['early-chooser-error', 'click-error'].includes(scenario)) return delay(2, 'chooser failed', true);
      if (scenario === 'missing-event') return new Promise(() => {});
      return delay(1, chooser);
    },
  }};
  const control = {
    count: async () => scenario === 'ambiguous-control' ? 2 : 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    click() {
      calls.push('click');
      if (scenario === 'click-error') return Promise.reject(new Error('click failed'));
      if (scenario === 'click-error-chooser-open') return Promise.reject(new Error('click failed with chooser'));
      if (scenario === 'click-timeout-chooser-open') return new Promise(() => {});
      return sleep(scenario === 'early-chooser-error' ? 20 : 1);
    },
  };
  const options = {
    files: scenario === 'relative-path' ? ['relative.png'] : ['C:\\test\\alpha.txt', 'C:\\test\\beta.txt'],
    uploadControl: control,
    chooserTimeoutMs: 25, setFilesTimeoutMs: 25, completionTimeoutMs: 25,
    onProgress(event) { progress.push(event); if (scenario === 'reporter-error') return Promise.reject(new Error('reporter unavailable')); },
    async verifyUpload() {
      calls.push('verify'); verifyCount++;
      if (scenario === 'verify-error') throw new Error('page failed');
      if (scenario === 'verify-hang-late-error') return delay(55, 'late page error', true);
      if (['unverified', 'set-hang'].includes(scenario)) return { complete: false, evidence: 'still uploading' };
      return { complete: true, evidence: 'two original nodes ready and media checked' };
    },
  };
  if (scenario === 'files-set-only') delete options.verifyUpload;
  const context = vm.createContext({ setTimeout, clearTimeout, Promise });
  vm.runInContext(fs.readFileSync(script, 'utf8'), context);
  (async () => {
    const result = await context.uploadTapnowFiles(tab, options);
    if (['success', 'reporter-error', 'late-set-ui-success', 'click-timeout-chooser-open'].includes(scenario)) {
      assert.equal(result.ok, true); assert.equal(result.status, 'uploaded');
      assert.ok(result.evidence); assert.equal(selectionCount, 1); assert.equal(verifyCount, 1);
      assert.deepEqual(progress.filter(x => x.state === 'started').map(x => x.stage), ['chooser', 'set-files', 'verify']);
      assert.ok(calls.indexOf('listen') < calls.indexOf('click'));
      if (scenario === 'late-set-ui-success') {
        assert.equal(result.deliveryTimedOut, true);
        assert.ok(progress.some(x => x.stage === 'set-files' && x.state === 'uncertain'));
      }
      if (scenario === 'click-timeout-chooser-open') assert.equal(result.chooserClickTimedOut, true);
    } else if (scenario === 'files-set-only') {
      assert.equal(result.status, 'files-set'); assert.equal(verifyCount, 0);
    } else {
      const expectedStage = {
        'early-chooser-error':'chooser', 'click-error':'chooser', 'missing-event':'chooser',
        'click-error-chooser-open':'chooser',
        'ambiguous-control':'preflight', 'relative-path':'preflight', 'single-only':'set-files',
        'set-error':'set-files', 'set-hang':'verify', 'verify-error':'verify',
        'verify-hang-late-error':'verify', 'unverified':'verify',
      }[scenario];
      assert.equal(result.ok, false); assert.equal(result.stage, expectedStage);
      assert.ok(result.message);
      assert.equal(selectionCount, ['set-error','set-hang','verify-error','verify-hang-late-error','unverified'].includes(scenario) ? 1 : 0);
      assert.equal(result.filesMayBeSet, selectionCount > 0);
      if (['ambiguous-control', 'relative-path'].includes(scenario)) assert.equal(calls.length, 0);
    }
    // Late rejections must remain handled after the helper returns.
    await sleep(65);
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
}
