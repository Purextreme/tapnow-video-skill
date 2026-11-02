async function setTapnowCanvasZoom(tab, target) {
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
    throw new Error('Use a positive zoom ratio: 1 means 100%.');
  }
  // The playback seek bar is an input[type=range] with an implicit slider role.
  // The observed canvas zoom thumb has an explicit role; retain the unique/range checks.
  const slider = tab.playwright.getByRole('slider').and(tab.playwright.locator('[role="slider"]'));
  const epsilon = 0.0001;
  const read = async () => {
    const states = await slider.evaluateAll(elements => elements.map(e => ({
      raw: e.getAttribute('aria-valuenow'),
      min: e.getAttribute('aria-valuemin'),
      max: e.getAttribute('aria-valuemax'),
    })));
    if (states.length !== 1) throw new Error('Expected one canvas zoom slider.');
    const state = states[0];
    const value = Number(state.raw), min = Number(state.min), max = Number(state.max);
    if ([state.raw, state.min, state.max].some(v => v === null || v.trim() === '') ||
        ![value, min, max].every(Number.isFinite) || min <= 0 || max <= min ||
        value < min - epsilon || value > max + epsilon) {
      throw new Error('Invalid canvas zoom slider state.');
    }
    return { raw: state.raw, value, min, max };
  };
  let state = await read();
  if (target < state.min - epsilon || target > state.max + epsilon) {
    throw new Error(`Target ${target} is outside [${state.min}, ${state.max}].`);
  }
  const initial = state.value;
  let keyCount = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (Math.abs(target - state.value) <= epsilon) {
      return { initial, target, actual: state.value, keyCount };
    }
    const difference = target - state.value;
    const key = Math.abs(difference) >= 0.1 - epsilon
      ? (difference > 0 ? 'PageUp' : 'PageDown')
      : (difference > 0 ? 'ArrowRight' : 'ArrowLeft');
    const previous = state;
    await slider.press(key);
    keyCount++;
    await slider.and(tab.playwright.locator(
      `[role="slider"]:not([aria-valuenow="${previous.raw}"])`
    )).waitFor({ state: 'visible', timeoutMs: 3000 });
    state = await read();
    if (Math.abs(target - state.value) >= Math.abs(difference) - epsilon) {
      throw new Error(`Zoom did not approach target after ${key}; current=${state.value}. Stop and inspect focus, step size or view animation.`);
    }
  }
  throw new Error(`Zoom did not settle at ${target}; current=${state.value}.`);
}
export { setTapnowCanvasZoom };
