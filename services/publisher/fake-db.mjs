const UNIQUE = {
  post_deliveries: ["user_id", "post_id", "occurrence", "platform", "connection_id"],
  social_tokens: ["user_id", "connection_id"],
  bluesky_sessions: ["user_id", "did"],
  publisher_waiting: ["user_id", "workspace_id", "post_id", "connection_id"],
  publisher_notices: ["user_id", "key"],
  post_replies: ["delivery_id", "step"],
};

export function fakeDb({ posts = [], users = [], recipients = {}, accounts = {} } = {}) {
  const tables = { post_deliveries: [], social_tokens: [], bluesky_sessions: [], publisher_waiting: [], publisher_uploads: [], publisher_notices: [], post_replies: [], user_data: users, account_state: [], agent_chats: [] };
  let serial = 0;
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
  const keyOf = (table, row) => (UNIQUE[table] ?? ["id"]).map((key) => row[key]).join("|");
  const copy = (row) => structuredClone(row);
  const defaults = { attempts: 0, requested: false, error: null, publish_id: null, url: null, plug_checks: 0, plugs_done: [] };
  /**
   * Like the database's triggers: a post new or changed since last seen (tests change posts in place) gets
   * a new version and is due a look at once; one gone from `posts` is due a look as deleted.
   */
  const rowsOf = new Map();
  const EARLY = new Date(0).toISOString();
  const postKey = (item) => `${item.user_id}|${item.post?.id}`;
  function seen() {
    const here = new Set();
    for (const item of posts) {
      const key = postKey(item);
      here.add(key);
      const text = JSON.stringify(item.post);
      const row = rowsOf.get(key);
      if (!row) rowsOf.set(key, { item, text, version: 1, deleted: false, next_run_at: EARLY, planned_through: null });
      else if (row.text !== text || row.deleted || row.item !== item) Object.assign(row, { item, text, version: row.version + 1, deleted: false, next_run_at: EARLY });
    }
    for (const [key, row] of rowsOf) {
      if (!here.has(key) && !row.deleted) Object.assign(row, { deleted: true, version: row.version + 1, next_run_at: EARLY });
    }
  }
  const withLook = (item) => {
    const row = rowsOf.get(postKey(item));
    return { ...copy(item), version: row?.version ?? 1, next_run_at: row?.next_run_at ?? null };
  };

  /** Whether a look for due rows leaves the row out, as db.mjs's `without` does. */
  const skipped = (row, skip) =>
    Boolean(skip?.users?.includes(row.user_id) || skip?.lanes?.some((lane) => lane.user_id === row.user_id && lane.platform === row.platform && (lane.connection_id === undefined || lane.connection_id === row.connection_id)));

  return {
    tables,
    posts,
    failNextUpdate: false,
    /** Like a database from before the paged functions. */
    withoutPages: false,
    async select(table, filter) {
      return tables[table].filter((row) => matches(row, filter)).map(copy);
    },
    async selectOne(table, filter) {
      const row = tables[table].find((item) => matches(item, filter));
      return row ? copy(row) : null;
    },
    async insertNew(table, rows) {
      const made = [];
      for (const row of rows) {
        if (tables[table].some((item) => keyOf(table, item) === keyOf(table, row))) continue;
        const stamp = new Date().toISOString();
        const extra =
          table === "post_deliveries"
            ? defaults
            : table === "publisher_notices"
              ? { sent_at: null, attempts: 0 }
              : table === "post_replies"
                ? { attempts: 0, error: null, publish_id: null, url: null }
                : {};
        const next = { id: `row-${++serial}`, ...extra, created_at: stamp, updated_at: stamp, ...copy(row) };
        tables[table].push(next);
        made.push(copy(next));
      }
      return made;
    },
    async insert(table, rows) {
      tables[table].push(...rows.map((row) => ({ id: `row-${++serial}`, ...copy(row) })));
    },
    async upsert(table, given) {
      for (const row of Array.isArray(given) ? given : [given]) {
        const index = tables[table].findIndex((item) => keyOf(table, item) === keyOf(table, row));
        if (index === -1) tables[table].push(copy(row));
        else tables[table][index] = { ...tables[table][index], ...copy(row) };
      }
    },
    async update(table, filter, values) {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        throw new Error("connection lost");
      }
      const changed = [];
      for (const row of tables[table]) {
        if (!matches(row, filter)) continue;
        Object.assign(row, copy(values));
        changed.push(copy(row));
      }
      return changed;
    },
    async delete(table, filter) {
      tables[table] = tables[table].filter((row) => !matches(row, filter));
    },
    looks: [],
    schedules: [],
    look(userId, postId) {
      seen();
      const row = rowsOf.get(`${userId}|${postId}`);
      return row && { version: row.version, next_run_at: row.next_run_at, planned_through: row.planned_through, deleted: row.deleted };
    },
    async due(states, at, limit, skip) {
      this.looks.push({ table: "post_deliveries", skip: copy(skip ?? null) });
      return tables.post_deliveries.filter((row) => states.includes(row.state) && row.next_at <= at && !skipped(row, skip)).sort((a, b) => a.next_at.localeCompare(b.next_at)).slice(0, limit).map(copy);
    },
    async repliesDue(at, limit, skip) {
      this.looks.push({ table: "post_replies", skip: copy(skip ?? null) });
      return tables.post_replies.filter((row) => row.state === "queued" && row.next_at <= at && !skipped(row, skip)).sort((a, b) => a.next_at.localeCompare(b.next_at)).slice(0, limit).map(copy);
    },
    async abandonStaleReplies(before, at, going = []) {
      for (const row of tables.post_replies) if (row.state === "sending" && row.updated_at < before && !going.includes(row.id)) Object.assign(row, { state: "failed", updated_at: at, error: "The follow-up was cut off, so it may have gone out." });
    },
    async plugsDue(checks, at, limit, skip) {
      return tables.post_deliveries.filter((row) => row.state === "sent" && row.plug_checks < checks && row.next_at <= at && !skipped(row, skip)).slice(0, limit).map(copy);
    },
    async abandonStale(before, at, going = []) {
      const failed = [];
      for (const row of tables.post_deliveries) {
        if (row.state !== "sending" || row.updated_at >= before || going.includes(row.id)) continue;
        if (row.publish_id?.startsWith("upload:") || (row.platform === "tiktok" && row.publish_id)) Object.assign(row, { state: "queued", next_at: at });
        else {
          Object.assign(row, { state: "failed", updated_at: at, error: "The send was cut off, so it may have gone out." });
          failed.push(copy(row));
        }
      }
      return failed;
    },
    async sealedSample(table, _columns, limit) {
      const rows = tables[table];
      return [...new Set([...rows.slice(0, limit), ...rows.slice(-limit)])].map(copy);
    },
    async overdue(before) {
      return tables.post_deliveries.some((row) => ["queued", "processing"].includes(row.state) && row.next_at < before);
    },
    async outcomesSince(since) {
      const failed = tables.post_deliveries.filter((row) => row.state === "failed" && row.attempts > 0 && row.updated_at >= since);
      return { failed: failed.length, people: new Set(failed.map((row) => row.user_id)).size, sent: tables.post_deliveries.some((row) => row.state === "sent" && row.updated_at >= since) };
    },
    async noticesDue(before, after, tries, limit) {
      return tables.publisher_notices
        .filter((row) => row.sent_at === null && row.created_at <= before && row.created_at >= after && row.attempts < tries)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map(copy);
    },
    async pruneNotices(before) {
      tables.publisher_notices = tables.publisher_notices.filter((row) => row.created_at >= before);
    },
    async uploadsSince(userId, platform, since, limit) {
      return tables.publisher_uploads.filter((row) => row.user_id === userId && row.platform === platform && row.at >= since).sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit).map(copy);
    },
    async pruneUploads(before, platforms) {
      tables.publisher_uploads = tables.publisher_uploads.filter((row) => row.at >= before || !platforms.includes(row.platform));
    },
    async youtubeHeld(after, limit) {
      const holds = (row) => row.publish_id !== null || row.url !== null || row.error !== null;
      return tables.post_deliveries
        .filter((row) => row.platform === "youtube" && row.connection_id !== "none" && ["sent", "failed"].includes(row.state) && holds(row) && (!after || row.id > after))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(copy);
    },
    async replaceAccountState(userId, revision, payload, at) {
      const row = tables.account_state.find((item) => item.user_id === userId && item.payload?.revision === revision);
      if (!row) return false;
      Object.assign(row, { payload: copy(payload), updated_at: at });
      return true;
    },
    async oldChats(before, after, limit) {
      return tables.agent_chats
        .filter((row) => row.updated_at < before && (!after || row.id > after))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((row) => copy({ id: row.id, messages: row.messages }));
    },
    async deleteOldChats(ids, before) {
      tables.agent_chats = tables.agent_chats.filter((row) => !(ids.includes(row.id) && row.updated_at < before));
    },
    async rpc(name, args) {
      const scheduled = (item) => item.post.status === "scheduled" && !item.post.paused;
      if (name.startsWith("publisher_posts") || ["publisher_due", "publisher_schedule", "publisher_next_due", "publisher_look_again"].includes(name)) seen();
      if (name === "publisher_posts") return posts.filter(scheduled).map(withLook);
      if (this.withoutPages && name.endsWith("_after")) throw new Error(`The database refused POST rpc/${name}: {"code":"PGRST202"}`);
      if (name === "publisher_posts_after") {
        const keyOf = (item) => [item.user_id, item.workspace_id, item.post.id ?? ""];
        const after = [args.after_user ?? "", args.after_workspace ?? "", args.after_post ?? ""];
        const text = (item) => keyOf(item).join("\u0000");
        return posts
          .filter((item) => scheduled(item) && text(item) > after.join("\u0000"))
          .sort((a, b) => (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0))
          .slice(0, args.size)
          .map(withLook);
      }
      if (name === "publisher_due") {
        return [...rowsOf.values()]
          .filter((row) => row.next_run_at !== null && row.next_run_at <= args.before)
          .sort((a, b) => a.next_run_at.localeCompare(b.next_run_at) || postKey(a.item).localeCompare(postKey(b.item)))
          .slice(0, args.size ?? 500)
          .map((row) => ({
            user_id: row.item.user_id,
            workspace_id: row.item.workspace_id,
            post_id: row.item.post?.id,
            version: row.version,
            next_run_at: row.next_run_at,
            planned_through: row.planned_through,
            time_zone: row.item.time_zone,
            connections: copy(row.item.connections ?? []),
            post: row.deleted ? null : copy(row.item.post),
          }));
      }
      if (name === "publisher_schedule") {
        this.schedules.push(copy(args.items));
        let kept = 0;
        for (const look of args.items ?? []) {
          const row = rowsOf.get(`${look.user_id}|${look.post_id}`);
          if (!row || row.version !== look.version) continue;
          row.next_run_at = look.next_run_at;
          row.planned_through = look.planned_through ?? row.planned_through;
          kept++;
        }
        return kept;
      }
      if (name === "publisher_next_due") {
        const times = [...rowsOf.values()].map((row) => row.next_run_at).filter(Boolean).sort();
        return times[0] ?? null;
      }
      if (name === "publisher_mark_posted") {
        const item = posts.find((entry) => entry.user_id === args.owner && entry.post.id === args.post);
        if (!item || !["scheduled", "draft"].includes(item.post.status) || item.post.recurrence) return false;
        item.post.status = "posted";
        return true;
      }
      if (name === "publisher_prune_deleted") return 0;
      if (name === "publisher_look_again") {
        seen();
        let looked = 0;
        for (const row of rowsOf.values()) if (row.item.user_id === args.owner && !row.deleted) (row.next_run_at = EARLY), looked++;
        return looked;
      }
      if (name === "publisher_post") {
        return posts
          .filter((item) => item.user_id === args.owner && item.post.id === args.post && (args.workspace == null || item.workspace_id === args.workspace))
          .map(copy);
      }
      if (name === "publisher_recipient") return recipients[args.person] ?? null;
      if (name === "publisher_account") return accounts[`${args.owner}:${args.connection}`] ?? null;
      if (name === "publisher_plugs") return posts.find((item) => item.user_id === args.owner)?.plugs ?? [];
      throw new Error(`unknown rpc ${name}`);
    },
  };
}
