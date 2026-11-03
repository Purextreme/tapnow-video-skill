// Import this module in the existing cua_repl after discovering the upload control.
// This helper uploads once. A timeout stops observation; it does not cancel the browser action.
import { recordTapnowEvent } from './diagnostics.mjs';

async function uploadTapnowFiles(tab, {
  files, uploadControl, verifyUpload, onProgress,
  chooserTimeoutMs = 30000, setFilesTimeoutMs = 15000, completionTimeoutMs = 45000,
} = {}) {
  const startedAt = Date.now();
  let stage = "preflight";
  let filesMayBeSet = false;
  let deliveryTimedOut = false;
  let chooserClickTimedOut = false;
  const report = async state => {
    // Reporting failures must not interrupt an in-flight file transfer.
    try { await onProgress?.({ stage, state, fileCount: files?.length || 0 }); } catch (_) {}
  };
  const fail = async message => {
    await report("failed");
    await recordTapnowEvent({ operation: "upload", route: "chooser", stage,
      outcome: filesMayBeSet ? "uncertain" : "failed",
      reason: /timed out|deadline/i.test(message) ? "timeout" : "unverified",
      elapsedMs: Date.now() - startedAt, mutationMayBeInFlight: filesMayBeSet });
    return {
      ok: false, status: "stopped", stage, filesMayBeSet, message,
      nextAction: filesMayBeSet
        ? "Inspect the original nodes and transfer before retrying; a timeout does not cancel the upload."
        : "Inspect the upload control and chooser before starting another attempt.",
    };
  };
  // Attach rejection handling immediately, including to operations that settle after timeout.
  const bounded = (run, timeoutMs, label) => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ timedOut: true, error: new Error(`${label} timed out after ${timeoutMs}ms`) }), timeoutMs);
    let operation;
    try { operation = run(); } catch (error) { operation = Promise.reject(error); }
    Promise.resolve(operation).then(
      value => { clearTimeout(timer); resolve({ value }); },
      error => { clearTimeout(timer); resolve({ error }); },
    );
  });
  try {
    const absolute = path => typeof path === "string" && /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(path);
    if (!Array.isArray(files) || !files.length || !files.every(absolute)) {
      return await fail("Expected a non-empty array of absolute file paths.");
    }
    if (verifyUpload !== undefined && typeof verifyUpload !== "function" ||
        onProgress !== undefined && typeof onProgress !== "function") {
      return await fail("verifyUpload and onProgress must be functions when provided.");
    }
    if (![chooserTimeoutMs, setFilesTimeoutMs, completionTimeoutMs].every(ms => Number.isSafeInteger(ms) && ms > 0 && ms <= 60000)) {
      return await fail("Each stage timeout must be an integer between 1 and 60000ms.");
    }
    if (!uploadControl) return await fail("Expected an observed upload control.");
    const [count, visible, enabled] = await Promise.all([
      uploadControl.count(), uploadControl.isVisible(), uploadControl.isEnabled(),
    ]);
    if (count !== 1 || !visible || !enabled) {
      return await fail("Expected one observed, visible, enabled upload control; inspect the current menu.");
    }
    stage = "chooser";
    await report("started");
    const pending = bounded(() => tab.playwright.waitForEvent("filechooser", {
      timeoutMs: chooserTimeoutMs,
    }), chooserTimeoutMs, "File chooser");
    const clicked = await bounded(() => uploadControl.click({
      timeoutMs: Math.min(5000, chooserTimeoutMs),
    }), Math.min(5000, chooserTimeoutMs), "Upload control click");
    // Drain the listener even when click fails. Never leave a rejecting promise behind.
    const opened = await pending;
    if (opened.error || clicked.error && !clicked.timedOut) {
      return await fail(String(clicked.error?.message || opened.error?.message || clicked.error || opened.error));
    }
    // The matching chooser proves the click took effect, even if its acknowledgment was late.
    chooserClickTimedOut = Boolean(clicked.timedOut);
    if (chooserClickTimedOut) {
      await report("uncertain");
      await recordTapnowEvent({ operation: "upload", route: "chooser", stage,
        outcome: "recovered", reason: "timeout", elapsedMs: Date.now() - startedAt });
    }
    await report("completed");
    stage = "set-files";
    await report("started");
    const chooser = opened.value;
    if (files.length > 1 && !chooser.isMultiple()) {
      return await fail("The observed chooser does not accept multiple files; no files were set.");
    }
    // A rejected/timed-out call can still have delivered files. Never repeat it automatically.
    filesMayBeSet = true;
    const selected = await bounded(() => chooser.setFiles(files, {
      timeoutMs: setFilesTimeoutMs,
    }), setFilesTimeoutMs, "Setting files");
    if (selected.error) {
      if (!selected.timedOut || !verifyUpload) return await fail(String(selected.error.message || selected.error));
      deliveryTimedOut = true;
      await report("uncertain");
    } else {
      await report("completed");
    }
    if (!verifyUpload) {
      return { ok: true, status: "files-set", stage, filesMayBeSet, chooserClickTimedOut };
    }
    stage = "verify";
    await report("started");
    const checked = await bounded(() => verifyUpload({ tab, files, timeoutMs: completionTimeoutMs }),
      completionTimeoutMs, "Upload verification");
    if (checked.error) return await fail(String(checked.error.message || checked.error));
    if (checked.value?.complete !== true || typeof checked.value.evidence !== "string" || !checked.value.evidence.trim()) {
      return await fail("Files were set, but upload completion was not verified from the original nodes.");
    }
    await report("completed");
    if (deliveryTimedOut) await recordTapnowEvent({ operation: "upload", route: "chooser", stage: "set-files",
      outcome: "recovered", reason: "timeout", elapsedMs: Date.now() - startedAt });
    return { ok: true, status: "uploaded", stage, filesMayBeSet, chooserClickTimedOut, deliveryTimedOut, evidence: checked.value.evidence };
  } catch (error) {
    return await fail(String(error?.message || error));
  }
}
export { uploadTapnowFiles };
