const SWEEP_MS = 60_000;

/** Only ended counters are let go: anything that clears live ones lets strangers reset every limit by filling the map. */
export function createWindows(now = () => Date.now()) {
  const windows = new Map();
  let sweepAt = 0;
  return {
    allowed(key, max, ms) {
      const at = now();
      if (at >= sweepAt) {
        sweepAt = at + SWEEP_MS;
        for (const [name, entry] of windows) if (entry.reset <= at) windows.delete(name);
      }
      const entry = windows.get(key);
      if (!entry || entry.reset <= at) {
        windows.set(key, { count: 1, reset: at + ms });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
    size: () => windows.size,
  };
}
