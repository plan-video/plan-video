// When the publisher plans and sends (worker.mjs). Planning reads every
// scheduled post, so it runs every `passMs` and the moment a run the last
// pass saw coming is due. Sending asks only for what's due, so it looks every
// `dispatchMs`, and in a moment after a "Post now" (kick).

/**
 * `paused()` holds everything back, as a key that opens no login does.
 * `passed(planned)` hears how each pass went; `afterPass` runs after each,
 * as emailing notices does.
 */
export function startLoops({ worker, paused = () => false, passed = () => {}, afterPass = async () => {}, passMs, dispatchMs, wakeAfterMs, now = () => Date.now(), log = console }) {
  let wake;
  let soon;
  let stopping = false;

  /** A pass when the soonest run the last one saw coming is due, rather than at the next interval. */
  function wakeForNext() {
    clearTimeout(wake);
    const next = worker.nextRun();
    if (next !== null && !stopping) wake = setTimeout(pass, Math.max(0, next - now()) + wakeAfterMs);
  }

  const pass = () =>
    (paused() ? Promise.resolve(false) : worker.pass())
      .then((planned) => passed(planned))
      .catch((error) => log.error("[publisher] pass failed", error))
      .then(wakeForNext)
      .then(afterPass)
      .catch((error) => log.error("[publisher] after a pass", error));

  const dispatch = () => (paused() ? Promise.resolve() : worker.dispatch()).catch((error) => log.error("[publisher] sending failed", error));

  const passing = setInterval(pass, passMs);
  const sending = setInterval(dispatch, dispatchMs);

  return {
    pass,
    dispatch,
    /** Sending in a moment, for a "Post now" that shouldn't wait for the next look. */
    kick() {
      clearTimeout(soon);
      if (!stopping) soon = setTimeout(dispatch, 200);
    },
    /** Starts nothing more, and resolves to whether the sends going finished within `ms`. */
    stop(ms) {
      stopping = true;
      clearInterval(passing);
      clearInterval(sending);
      clearTimeout(wake);
      clearTimeout(soon);
      return worker.stop(ms);
    },
  };
}
