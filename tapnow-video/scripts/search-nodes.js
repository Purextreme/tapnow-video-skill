// Run this declaration in the existing cua_repl session after UI discovery.
// Uses only documented browser methods; no credentials, network or submission.
async function searchTapnowNodes(tab, { kind = "All", query = "" } = {}) {
  const kinds = ["All", "Image", "Video", "Text", "Audio", "World", "Group"];
  if (!kinds.includes(kind) || typeof query !== "string") {
    throw new Error("Expected an observed node kind and a string query.");
  }
  const dialog = tab.playwright.getByRole("dialog", {
    name: "Node search", exact: true,
  });
  if (!(await dialog.isVisible())) {
    const open = tab.playwright.getByRole("button", {
      name: "Node search", exact: true,
    });
    if (await open.count() !== 1 || !(await open.isVisible())) {
      throw new Error("Node search opener missing or ambiguous; inspect the page.");
    }
    await open.click({ timeoutMs: 5000 });
    await dialog.waitFor({ state: "visible", timeoutMs: 5000 });
  }
  const filter = dialog.getByRole("button", { name: kind, exact: true });
  const input = dialog.getByRole("textbox", {
    name: "Search nodes...", exact: true,
  });
  if (await dialog.count() !== 1 || await filter.count() !== 1 ||
      await input.count() !== 1 || !(await filter.isVisible()) ||
      !(await input.isVisible())) {
    throw new Error("Search controls changed or are ambiguous; inspect the dialog.");
  }
  if (await filter.getAttribute("aria-pressed") !== "true") {
    await filter.click({ timeoutMs: 5000 });
    // A filter change can rerender the controlled textbox before fill completes.
    await tab.getAXState({ emit: false });
  }
  // Explicit replacement avoids residual/composed text in controlled inputs.
  await input.press("ControlOrMeta+A", { timeoutMs: 5000 });
  if (query) {
    await tab.paste(null, query, { format: "text" });
  } else {
    await input.press("Backspace", { timeoutMs: 5000 });
  }
  // Let the supported observation wait settle the UI without a model round trip.
  await tab.getAXState({ emit: false });
  const actual = await input.evaluate(el => el.value);
  if (actual !== query || await filter.getAttribute("aria-pressed") !== "true") {
    throw new Error("Search state differs from the requested values; stop and inspect.");
  }
  const resultText = await dialog.innerText({ timeoutMs: 5000 });
  return {
    kind, query,
    resultText: resultText.slice(0, 1600),
    truncated: resultText.length > 1600,
  };
}
