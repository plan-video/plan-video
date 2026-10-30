// Sends run several at once, so one person's long upload holds up nobody
// else's. Each runs in a lane, which runs one thing at a time: an account,
// so a login is used by one send at a time and a post's networks go at once.
// YouTube's lane is all of a person's YouTube accounts, so their daily share
// of uploads is never counted by two at once (X's posts are counted under a
// lock of their own, in networks/x.mjs). A person has at most `perUser` lanes
// going, so an agency posting for every client at nine leaves room for others.
//
// The memory gate holds back sends that keep a large file in memory, like a
// Bluesky video, while others hold too much already, so a busy minute can't
// take the publisher past its memory limit and cut every send it has going.

/** A row's lane: the person's account, or every YouTube account of theirs. */
export function laneOf(row) {
  return row.platform === "youtube" ? { user_id: row.user_id, platform: row.platform } : { user_id: row.user_id, platform: row.platform, connection_id: row.connection_id };
}

const keyOf = (lane) => `${lane.user_id}|${lane.platform}|${lane.connection_id ?? "*"}`;

/**
 * `size` lanes at once, `perUser` of them one person's. `take` runs `work`
 * in the row's lane, or says it can't; `busy` is what a look for due rows
 * should leave out. `onFree` is called each time a lane is let go.
 */
export function createPool({ size, perUser, onFree = () => {} }) {
  /** The lanes going, by key. */
  const lanes = new Map();
  /** Lanes going, by person. */
  const users = new Map();
  /** Ids of the rows going, by table. */
  const ids = new Map();
  const running = new Set();

  const canTake = (table, row) => lanes.size < size && !lanes.has(keyOf(laneOf(row))) && (users.get(row.user_id) ?? 0) < perUser && !ids.get(table)?.has(row.id);

  return {
    /** Lanes free. */
    get free() {
      return size - lanes.size;
    },
    /** Whether anything is going. */
    get going() {
      return running.size > 0;
    },
    /** People with no lane left, and the lanes going: a look for due rows leaves out what couldn't start now. */
    busy() {
      return {
        users: [...users].filter(([, count]) => count >= perUser).map(([user]) => user),
        lanes: [...lanes.values()],
      };
    },
    /** Ids of the rows of `table` going. */
    goingIn(table) {
      return [...(ids.get(table) ?? [])];
    },
    /** Whether a row of `table` could start now. */
    canTake,
    /** Runs `work` in the row's lane, or returns false when the lane, the person or the pool is full. A `work` that throws still lets its lane go. */
    take(table, row, work) {
      if (!canTake(table, row)) return false;
      const lane = laneOf(row);
      lanes.set(keyOf(lane), lane);
      users.set(row.user_id, (users.get(row.user_id) ?? 0) + 1);
      if (!ids.has(table)) ids.set(table, new Set());
      ids.get(table).add(row.id);
      const done = Promise.resolve()
        .then(work)
        .catch(() => undefined)
        .finally(() => {
          lanes.delete(keyOf(lane));
          const left = users.get(row.user_id) - 1;
          if (left) users.set(row.user_id, left);
          else users.delete(row.user_id);
          ids.get(table).delete(row.id);
          running.delete(done);
          onFree();
        });
      running.add(done);
      return true;
    },
    /** Resolves once nothing is going, `more()` included: what may start more as it ends. */
    async idle(more = () => null) {
      for (;;) {
        const pending = [...running, more()].filter(Boolean);
        if (!pending.length) return;
        await Promise.allSettled(pending);
      }
    },
  };
}

/**
 * At most `budget` bytes held at once by the sends that hold whole files or
 * large parts of them. One over the budget alone waits until nothing else is
 * held, then goes on its own. Waits are first come, first served.
 */
export function createMemoryGate(budget) {
  let held = 0;
  const waiting = [];

  const fits = (bytes) => held === 0 || held + Math.min(bytes, budget) <= budget;

  function next() {
    while (waiting.length && fits(waiting[0].bytes)) {
      const { bytes, resolve } = waiting.shift();
      resolve(grant(bytes));
    }
  }

  function grant(bytes) {
    const taken = Math.min(bytes, budget);
    held += taken;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held -= taken;
      next();
    };
  }

  return {
    get held() {
      return held;
    },
    /** Holds `bytes` once there's room, and resolves to what lets them go. */
    async hold(bytes) {
      if (!(bytes > 0)) return () => {};
      if (!waiting.length && fits(bytes)) return grant(bytes);
      return new Promise((resolve) => waiting.push({ bytes, resolve }));
    },
  };
}
