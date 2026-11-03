// Verify the intended node toolbar or result detail before calling this helper.
// A returned path is a transfer result; verify the file and media locally.
import { recordTapnowEvent } from './diagnostics.mjs';

export async function downloadTapnowResult(tab, { timeoutMs = 45000, downloadControl } = {}) {
  const startedAt = Date.now();
  let stage = 'control';
  try {
    const button = downloadControl || tab.playwright.getByRole("button", {
      name: "Download", exact: true,
    });
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
      throw new Error("Expected one visible, enabled Download button for the verified result.");
    }
    const pending = tab.playwright.waitForEvent("download", { timeoutMs });
    // Observe event rejection even if the click itself fails first.
    pending.catch(() => {});
    stage = 'transfer';
    await button.click({ timeoutMs });
    const transfer = await pending;
    const path = await transfer.path({ timeoutMs });
    if (!path) {
      throw new Error("Download completed without a local path; inspect transfer status before retrying.");
    }
    return { path, method: downloadControl ? "scoped-download-button" : "detail-download-button" };
  } catch (error) {
    await recordTapnowEvent({ operation: 'download', route: 'dom', stage,
      outcome: stage === 'transfer' ? 'uncertain' : 'failed',
      reason: 'unverified', elapsedMs: Date.now() - startedAt });
    throw error;
  }
}
