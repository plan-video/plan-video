/** `paused()` holds everything back, as a key that opens no login does. */
export function startLoops({ worker, paused = () => false, passed = () => {}, afterPass = async () => {}, passMs, dispatchMs, wakeAfterMs, now = () => Date.now(), log = console }) {
  let wake;
  let soon;
  let stopping = false;

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
    kick() {
      clearTimeout(soon);
      if (!stopping) soon = setTimeout(dispatch, 200);
    },
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
