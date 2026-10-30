// Each lane runs one thing at a time: an account, so a login is used by one send at a time. YouTube's lane
// is all of a person's YouTube accounts, so their daily uploads are never counted by two at once. A person has
// at most `perUser` lanes, so one agency can't hold up everyone. The memory gate holds back sends keeping large
// files in memory while others hold too much, so a busy minute can't take the publisher past its memory limit.

/** A row's lane: the person's account, or every YouTube account of theirs. */
export function laneOf(row) {
  return row.platform === "youtube" ? { user_id: row.user_id, platform: row.platform } : { user_id: row.user_id, platform: row.platform, connection_id: row.connection_id };
}

const keyOf = (lane) => `${lane.user_id}|${lane.platform}|${lane.connection_id ?? "*"}`;

export function createPool({ size, perUser, onFree = () => {} }) {
  const lanes = new Map();
  const users = new Map();
  const ids = new Map();
  const running = new Set();

  const canTake = (table, row) => lanes.size < size && !lanes.has(keyOf(laneOf(row))) && (users.get(row.user_id) ?? 0) < perUser && !ids.get(table)?.has(row.id);

  return {
    get free() {
      return size - lanes.size;
    },
    get going() {
      return running.size > 0;
    },
    busy() {
      return {
        users: [...users].filter(([, count]) => count >= perUser).map(([user]) => user),
        lanes: [...lanes.values()],
      };
    },
    goingIn(table) {
      return [...(ids.get(table) ?? [])];
    },
    canTake,
    /** A `work` that throws still lets its lane go. */
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
    async idle(more = () => null) {
      for (;;) {
        const pending = [...running, more()].filter(Boolean);
        if (!pending.length) return;
        await Promise.allSettled(pending);
      }
    },
  };
}

/** One send over the budget alone waits until nothing else is held, then goes on its own. First come, first served. */
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
    async hold(bytes) {
      if (!(bytes > 0)) return () => {};
      if (!waiting.length && fits(bytes)) return grant(bytes);
      return new Promise((resolve) => waiting.push({ bytes, resolve }));
    },
  };
}
