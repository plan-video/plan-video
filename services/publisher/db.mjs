// Runs with the service role, which passes row-level security. Filters are equality only.

import { PublishError } from "./errors.mjs";

/** Only plain ids go into a filter's list, where a comma or bracket would end it. */
const plain = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export function without(skip) {
  const users = (skip?.users ?? []).filter(plain);
  const lanes = (skip?.lanes ?? []).filter((lane) => plain(lane.user_id) && plain(lane.platform) && (lane.connection_id === undefined || plain(lane.connection_id)));
  const leaveOut = (lane) => `not.and(user_id.eq.${lane.user_id},platform.eq.${lane.platform}${lane.connection_id === undefined ? "" : `,connection_id.eq.${lane.connection_id}`})`;
  return (users.length ? `&user_id=not.in.(${users.join(",")})` : "") + (lanes.length ? `&and=(${lanes.map(leaveOut).join(",")})` : "");
}

const notIds = (ids) => {
  const list = (ids ?? []).filter(plain);
  return list.length ? `&id=not.in.(${list.join(",")})` : "";
};

export function createDb({ url, serviceKey, fetch: send = fetch }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const query = (filter = {}) =>
    Object.entries(filter)
      .map(([key, value]) => `${encodeURIComponent(key)}=${Array.isArray(value) ? `in.(${value.map((item) => `"${item}"`).join(",")})` : `eq.${encodeURIComponent(value)}`}`)
      .join("&");

  async function call(method, path, { body, prefer, timeout = 15_000 } = {}) {
    let response;
    try {
      response = await send(`${url}/rest/v1/${path}`, {
        method,
        headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new PublishError("The database didn't answer.", { retry: true });
    }
    const text = await response.text();
    if (!response.ok) throw new PublishError(`The database refused ${method} ${path.split("?")[0]}: ${text.slice(0, 300)}`, { retry: response.status >= 500 });
    return text ? JSON.parse(text) : null;
  }

  return {
    call,
    async select(table, filter, columns = "*", extra = "") {
      return (await call("GET", `${table}?select=${columns}${Object.keys(filter).length ? `&${query(filter)}` : ""}${extra}`)) ?? [];
    },
    async selectOne(table, filter, columns = "*") {
      const rows = await call("GET", `${table}?select=${columns}&${query(filter)}&limit=1`);
      return rows?.[0] ?? null;
    },
    async insertNew(table, rows, conflict) {
      if (!rows.length) return [];
      return (await call("POST", `${table}?on_conflict=${conflict}`, { body: rows, prefer: "return=representation,resolution=ignore-duplicates" })) ?? [];
    },
    async insert(table, rows) {
      await call("POST", table, { body: rows, prefer: "return=minimal" });
    },
    async upsert(table, row, conflict) {
      await call("POST", `${table}?on_conflict=${conflict}`, { body: row, prefer: "return=minimal,resolution=merge-duplicates" });
    },
    /** An empty list means none matched. */
    async update(table, filter, values) {
      return (await call("PATCH", `${table}?${query(filter)}`, { body: values, prefer: "return=representation" })) ?? [];
    },
    async delete(table, filter) {
      await call("DELETE", `${table}?${query(filter)}`, { prefer: "return=minimal" });
    },
    async due(states, at, limit, skip) {
      return (await call("GET", `post_deliveries?select=*&state=in.(${states.join(",")})&next_at=lte.${at}${without(skip)}&order=next_at.asc&limit=${limit}`)) ?? [];
    },
    async repliesDue(at, limit, skip) {
      return (await call("GET", `post_replies?select=*&state=eq.queued&next_at=lte.${at}${without(skip)}&order=next_at.asc&limit=${limit}`)) ?? [];
    },
    /** Cut off by a restart (not those in `going`); they may have gone out, so they fail with a note to check. */
    async abandonStaleReplies(before, at, going) {
      await call("PATCH", `post_replies?state=eq.sending&updated_at=lt.${before}${notIds(going)}`, {
        body: { state: "failed", updated_at: at, error: "The follow-up was cut off, so it may have gone out. Check the network, and post it there if it isn't." },
        prefer: "return=minimal",
      });
    },
    async plugsDue(checks, at, limit, skip) {
      return (await call("GET", `post_deliveries?select=*&state=eq.sent&plug_checks=lt.${checks}&next_at=lte.${at}${without(skip)}&order=next_at.asc&limit=${limit}`)) ?? [];
    },
    /**
     * Cut off by a restart (not those in `going`): an upload the network can carry on with is queued again;
     * anything else may have reached the network, so it fails with a note to check there.
     */
    async abandonStale(before, at, going) {
      const left = notIds(going);
      await call("PATCH", `post_deliveries?state=eq.sending&updated_at=lt.${before}${left}&publish_id=like.upload:*`, {
        body: { state: "queued", next_at: at, error: "The upload was interrupted. Carrying on." },
        prefer: "return=minimal",
      });
      // A TikTok upload that kept its id asks TikTok how far it got before anything is sent again.
      await call("PATCH", `post_deliveries?state=eq.sending&updated_at=lt.${before}${left}&platform=eq.tiktok&publish_id=not.is.null`, {
        body: { state: "queued", next_at: at, error: "The upload was interrupted. Carrying on." },
        prefer: "return=minimal",
      });
      return (await call("PATCH", `post_deliveries?state=eq.sending&updated_at=lt.${before}${left}`, {
        body: { state: "failed", updated_at: at, error: "The send was cut off, so it may have gone out. Check the network, and post it again if it isn't there." },
        prefer: "return=representation",
      })) ?? [];
    },
    async sealedSample(table, columns, limit) {
      const oldest = (await call("GET", `${table}?select=${columns}&order=updated_at.asc&limit=${limit}`)) ?? [];
      const newest = (await call("GET", `${table}?select=${columns}&order=updated_at.desc&limit=${limit}`)) ?? [];
      const seen = new Set();
      return [...oldest, ...newest].filter((row) => {
        const key = row.sealed;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    async overdue(before) {
      return ((await call("GET", `post_deliveries?select=id&state=in.(queued,processing)&next_at=lt.${before}&limit=1`)) ?? []).length > 0;
    },
    async outcomesSince(since) {
      const failed = (await call("GET", `post_deliveries?select=user_id&state=eq.failed&attempts=gt.0&updated_at=gte.${since}&limit=1000`)) ?? [];
      const sent = (await call("GET", `post_deliveries?select=id&state=eq.sent&updated_at=gte.${since}&limit=1`)) ?? [];
      return { failed: failed.length, people: new Set(failed.map((row) => row.user_id)).size, sent: sent.length > 0 };
    },
    async uploadsSince(userId, platform, since, limit) {
      return (await call("GET", `publisher_uploads?select=at&user_id=eq.${encodeURIComponent(userId)}&platform=eq.${encodeURIComponent(platform)}&at=gte.${since}&order=at.asc&limit=${limit}`)) ?? [];
    },
    async noticesDue(before, after, tries, limit) {
      return (await call("GET", `publisher_notices?select=*&sent_at=is.null&created_at=lte.${before}&created_at=gte.${after}&attempts=lt.${tries}&order=created_at.asc&limit=${limit}`)) ?? [];
    },
    async pruneNotices(before) {
      await call("DELETE", `publisher_notices?created_at=lt.${before}`, { prefer: "return=minimal" });
    },
    async pruneUploads(before, platforms) {
      await call("DELETE", `publisher_uploads?at=lt.${before}&platform=in.(${platforms.map(encodeURIComponent).join(",")})`, { prefer: "return=minimal" });
    },
    async youtubeHeld(after, limit) {
      const from = after ? `&id=gt.${encodeURIComponent(after)}` : "";
      return (await call(
        "GET",
        `post_deliveries?select=id,user_id,connection_id,state,publish_id,url,error,updated_at&platform=eq.youtube&connection_id=neq.none&state=in.(sent,failed)&or=(publish_id.not.is.null,url.not.is.null,error.not.is.null)${from}&order=id.asc&limit=${limit}`,
      )) ?? [];
    },
    /** Only if nothing saved it since `revision`. */
    async replaceAccountState(userId, revision, payload, at) {
      const rows = await call("PATCH", `account_state?select=user_id&user_id=eq.${encodeURIComponent(userId)}&payload->>revision=eq.${encodeURIComponent(revision)}`, {
        body: { payload, updated_at: at },
        prefer: "return=representation",
        timeout: 30_000,
      });
      return (rows ?? []).length > 0;
    },
    async oldChats(before, after, limit) {
      const from = after ? `&id=gt.${encodeURIComponent(after)}` : "";
      return (await call("GET", `agent_chats?select=id,messages&updated_at=lt.${before}${from}&order=id.asc&limit=${limit}`, { timeout: 30_000 })) ?? [];
    },
    /** Only those still not changed since `before`. */
    async deleteOldChats(ids, before) {
      if (!ids.length) return;
      await call("DELETE", `agent_chats?id=in.(${ids.map(encodeURIComponent).join(",")})&updated_at=lt.${before}`, { prefer: "return=minimal" });
    },
    async rpc(name, args = {}) {
      return call("POST", `rpc/${name}`, { body: args, timeout: 30_000 });
    },
  };
}
