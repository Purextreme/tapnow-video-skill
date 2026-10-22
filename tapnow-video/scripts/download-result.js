// Open and verify the intended result detail before calling this helper.
// A returned path is a transfer result; verify the file and media locally.
async function downloadTapnowResult(tab, { timeoutMs = 45000 } = {}) {
  const button = tab.playwright.getByRole("button", {
    name: "Download", exact: true,
  });
  if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
    throw new Error("Expected one visible, enabled Download button in the verified result detail.");
  }
  const pending = tab.playwright.waitForEvent("download", { timeoutMs });
  // Observe event rejection even if the click itself fails first.
  pending.catch(() => {});
  await button.click({ timeoutMs });
  const transfer = await pending;
  const path = await transfer.path({ timeoutMs });
  if (!path) {
    throw new Error("Download completed without a local path; inspect transfer status before retrying.");
  }
  return { path, method: "detail-download-button" };
}
