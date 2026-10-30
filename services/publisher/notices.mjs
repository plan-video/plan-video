// Notices wait a few minutes in publisher_notices and go out in one email per person; one fixed meanwhile
// (a post sent again, an account reconnected) isn't emailed. Sent through Resend.

import { createHash } from "node:crypto";

/** Notices wait this long before they're emailed, so a burst goes in one email and one fixed meanwhile in none. */
export const HOLD_MS = 10 * 60_000;
/** Older than this, a notice isn't emailed any more: it would come too late to help. */
export const STALE_MS = 24 * 60 * 60_000;
/** A LinkedIn login that can't renew itself is flagged this long before it runs out, like the dashboard's notice. */
export const LOGIN_AHEAD_MS = 7 * 24 * 60 * 60_000;
const MAX_TRIES = 5;
/** Sent notices are kept this long, so the same thing isn't noted again. */
const KEEP_MS = 30 * 24 * 60 * 60_000;
const BATCH = 200;
const PAGE = 500;

const NAMES = { tiktok: "TikTok", youtube: "YouTube", bluesky: "Bluesky", linkedin: "LinkedIn", x: "X", instagram: "Instagram", facebook: "Facebook", threads: "Threads" };
const networkName = (platform) => NAMES[platform] ?? platform;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function createMailer({ apiKey, from, fetch: send = fetch, log = console }) {
  return {
    /** "sent"; "retry" when Resend may take it later; "refused" when it never will. */
    async send({ to, subject, html, text, key, replyTo }) {
      let response;
      try {
        response = await send("https://api.resend.com/emails", {
          method: "POST",
          // The same key within a day sends once, so a retry after a cut-off answer doesn't email twice.
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        log.error("[publisher] email failed", error instanceof Error ? error.message : error);
        return "retry";
      }
      if (response.ok) return "sent";
      log.error("[publisher] email refused", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return response.status === 409 || response.status === 429 || response.status >= 500 ? "retry" : "refused";
    },
  };
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const clip = (text, max) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
};

export function postName(post) {
  const title = typeof post?.title === "string" ? post.title.trim() : "";
  const caption = typeof post?.description === "string" ? (post.description.trim().split("\n")[0] ?? "") : "";
  return clip(title || caption, 80);
}

function format(at, options, zone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone || "UTC" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(at);
  }
}

const when = (iso, zone) => format(new Date(iso), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, zone);
const dayOf = (time) => format(new Date(time), { day: "numeric", month: "long" }, "UTC");

export function compose(notices, { accounts = new Map(), publicUrl = "https://plan.video" } = {}) {
  // A send that failed again since is listed once, as it failed last.
  const byDelivery = new Map();
  for (const notice of notices.filter((item) => item.kind === "failed")) byDelivery.set(notice.detail.delivery ?? notice.id, notice);
  const failed = [...byDelivery.values()].sort((a, b) => String(a.detail.due).localeCompare(String(b.detail.due)));
  // An account whose login ran out is listed once, as ran out rather than running out.
  const byAccount = new Map();
  for (const notice of notices.filter((item) => item.kind !== "failed")) {
    const kept = byAccount.get(notice.detail.connection);
    if (!kept || (kept.kind === "login-soon" && notice.kind === "login")) byAccount.set(notice.detail.connection, notice);
  }
  const logins = [...byAccount.values()];
  const account = (platform, connection) => [networkName(platform), accounts.get(connection)].filter(Boolean).join(" · ");

  const posts = new Set(failed.map((notice) => notice.detail.post_id ?? notice.id)).size;
  const only = failed[0]?.detail.post;
  // Follow-ups of a thread whose post went out: there's nothing to post again from Failed.
  const followUps = posts > 0 && failed.every((notice) => notice.detail.reply);
  const expired = logins.filter((notice) => notice.kind === "login");
  let subject;
  if (followUps) subject = posts === 1 && only ? `Part of the thread under “${only}” didn't go out` : "Part of a thread didn't go out";
  else if (posts === 1) subject = only ? `“${only}” didn't go out` : `A post didn't go out to ${networkName(failed[0].detail.platform)}`;
  else if (posts > 1) subject = `${posts} posts didn't go out`;
  else if (logins.length > 1) subject = expired.length ? `${logins.length} accounts need connecting again` : `${logins.length} LinkedIn logins run out soon`;
  else if (expired.length) subject = `Your ${networkName(logins[0].detail.platform)} login ran out`;
  else subject = `Your ${networkName(logins[0].detail.platform)} login runs out on ${dayOf(logins[0].detail.expires)}`;

  const intro = followUps
    ? "The post went out, but plan.video couldn't send what's below under it, or anything after it in the thread. Add it there yourself if you still want it."
    : posts
    ? `plan.video couldn't send ${failed.length === 1 ? "this post at its time" : "these at their time"}. Once you've fixed what's below, post ${failed.length === 1 ? "it" : "them"} again from Failed.`
    : "LinkedIn logins last 60 days and can't renew themselves. Connect the account again in Connections so its posts keep going out.";
  const link = followUps ? `${publicUrl}/dashboard?dashboard=posts` : posts ? `${publicUrl}/dashboard?dashboard=failed` : `${publicUrl}/dashboard?dashboard=connections`;
  const button = followUps ? "See your posts" : posts ? "See failed posts" : "Open Connections";
  const settings = `${publicUrl}/dashboard?dashboard=account`;

  const items = [
    ...failed.map((notice) => ({
      title: notice.detail.post || "Untitled post",
      meta: [account(notice.detail.platform, notice.detail.connection), notice.detail.due ? when(notice.detail.due, notice.detail.zone) : ""].filter(Boolean).join(" · "),
      reason: notice.detail.error || "It didn't go out.",
    })),
    ...logins.map((notice) => ({
      title: account(notice.detail.platform, notice.detail.connection),
      meta: "",
      reason:
        notice.kind === "login"
          ? `Its login ran out on ${dayOf(notice.detail.expires)}. Connect it again in Connections to keep posting.`
          : `Its login runs out on ${dayOf(notice.detail.expires)}. Connect it again in Connections before then to keep posting.`,
    })),
  ];

  const text = [
    subject,
    "",
    intro,
    "",
    ...items.flatMap((item) => [item.title, ...(item.meta ? [item.meta] : []), item.reason, ""]),
    `${button}: ${link}`,
    "",
    "You get these emails when something you scheduled on plan.video needs you.",
    `Turn them off in your account settings: ${settings}`,
  ].join("\n");

  const row = (item, first) => `
            <tr>
              <td style="padding:${first ? 24 : 16}px 40px 0 40px;font-family:${FONT};">
                <div style="font-size:15px;line-height:22px;font-weight:600;color:#0a0a0a;">${escape(item.title)}</div>${item.meta ? `
                <div style="font-size:13px;line-height:20px;color:#8a8a8a;">${escape(item.meta)}</div>` : ""}
                <div style="padding-top:4px;font-size:14px;line-height:22px;color:#525252;">${escape(item.reason)}</div>
              </td>
            </tr>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escape(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f5f5;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;">
      <tr>
        <td align="center" style="padding:48px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e8e8e8;border-radius:8px;">
            <tr>
              <td style="padding:40px 40px 0 40px;">
                <img src="${publicUrl}/apple-touch-icon.png" width="40" height="40" alt="plan.video" style="display:block;width:40px;height:40px;border:0;border-radius:8px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px 0 40px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#0a0a0a;">
                ${escape(subject)}
              </td>
            </tr>
            <tr>
              <td style="padding:12px 40px 0 40px;font-family:${FONT};font-size:15px;line-height:24px;color:#525252;">
                ${escape(intro)}
              </td>
            </tr>${items.map((item, index) => row(item, index === 0)).join("")}
            <tr>
              <td style="padding:28px 40px 40px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#2f6ff0" style="border-radius:8px;">
                      <a href="${escape(link)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escape(button)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
            <tr>
              <td align="center" style="padding:24px 40px 0 40px;font-family:${FONT};font-size:12px;line-height:18px;color:#a3a3a3;">
                You get these emails when something you scheduled on plan.video needs you.<br />
                <a href="${escape(settings)}" target="_blank" style="color:#a3a3a3;text-decoration:underline;">Turn them off</a> in your account settings.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
  return { subject, html, text };
}

export function createNotices({ db, vault, mailer, publicUrl = "https://plan.video", now = () => Date.now(), log = console }) {
  const iso = (time) => new Date(time).toISOString();
  let quietUntil = 0;
  /** A table that isn't there yet is said once an hour, not every tick. */
  const complain = (what, error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/PGRST205|PGRST202/.test(message)) {
      if (now() < quietUntil) return;
      quietUntil = now() + 60 * 60_000;
    }
    log.error(`[publisher] ${what}`, message);
  };

  async function note(userId, key, kind, detail) {
    try {
      await db.insertNew("publisher_notices", [{ user_id: userId, key, kind, detail, created_at: iso(now()) }], "user_id,key");
    } catch (error) {
      complain("couldn't note a notice", error);
    }
  }

  async function stillSo(userId, notices) {
    const sendsOf = (reply) => notices.filter((item) => item.kind === "failed" && !!item.detail.reply === reply).map((item) => item.detail.delivery);
    const deliveries = sendsOf(false);
    const replies = sendsOf(true);
    const connections = [...new Set(notices.filter((item) => item.kind !== "failed").map((item) => item.detail.connection))];
    const [sends, followUps, logins] = await Promise.all([
      deliveries.length ? db.select("post_deliveries", { id: deliveries }, "id,state") : [],
      replies.length ? db.select("post_replies", { id: replies }, "id,state") : [],
      connections.length ? db.select("social_tokens", { user_id: userId, connection_id: connections }, "connection_id,updated_at") : [],
    ]);
    const failed = new Set([...sends, ...followUps].filter((row) => row.state === "failed").map((row) => row.id));
    const kept = new Map(logins.map((row) => [row.connection_id, row.updated_at]));
    return notices.filter((item) =>
      item.kind === "failed" ? failed.has(item.detail.delivery) : kept.has(item.detail.connection) && Date.parse(kept.get(item.detail.connection)) === Date.parse(item.detail.updated),
    );
  }

  async function accountsOf(userId, notices) {
    const accounts = new Map();
    for (const connection of new Set(notices.map((item) => item.detail.connection))) {
      if (!connection || connection === "none") continue;
      const found = await db.rpc("publisher_account", { owner: userId, connection }).catch(() => null);
      if (typeof found?.handle === "string" && found.handle) accounts.set(connection, clip(found.handle, 60));
    }
    return accounts;
  }

  async function sendTo(userId, notices) {
    const mark = (list, values) => (list.length ? db.update("publisher_notices", { id: list.map((item) => item.id) }, values) : null);
    const still = await stillSo(userId, notices);
    await mark(notices.filter((item) => !still.includes(item)), { sent_at: iso(now()) });
    if (!still.length) return false;
    const to = await db.rpc("publisher_recipient", { person: userId });
    if (typeof to?.email !== "string" || !to.email || to.alerts === false) {
      await mark(still, { sent_at: iso(now()) });
      return false;
    }
    const email = compose(still, { accounts: await accountsOf(userId, still), publicUrl });
    const key = `notices-${createHash("sha256").update(still.map((item) => item.id).join(",")).digest("hex").slice(0, 40)}`;
    const outcome = await mailer.send({ to: to.email, ...email, key });
    if (outcome === "sent") {
      await mark(still, { sent_at: iso(now()) });
      return true;
    }
    const tries = Math.max(...still.map((item) => item.attempts ?? 0)) + 1;
    await mark(still, { attempts: outcome === "refused" ? MAX_TRIES : tries });
    return false;
  }

  let sending = false;

  return {
    /** Not when the person was watching: a Post now that fails on its first try fails in front of them. */
    async failed(row, { post, zone, message, reply = false } = {}) {
      if (row.requested && row.attempts <= 1) return;
      await note(row.user_id, `failed:${row.id}:${iso(now())}`, "failed", {
        delivery: row.id,
        ...(reply ? { reply: true } : {}),
        post_id: row.post_id,
        post: postName(post),
        platform: row.platform,
        connection: row.connection_id,
        due: row.due_at,
        zone: typeof zone === "string" && zone ? zone : "UTC",
        error: typeof message === "string" ? clip(message, 400) : "",
      });
    },

    /**
     * Only partner apps get LinkedIn refresh tokens; without one, the member has to connect again every
     * 60 days. Other networks' logins renew themselves.
     */
    async watchLogins() {
      const at = now();
      let noted = 0;
      for (let offset = 0; ; offset += PAGE) {
        const rows = await db.select("social_tokens", { platform: "linkedin" }, "user_id,connection_id,platform,updated_at", `&order=user_id,connection_id&limit=${PAGE}&offset=${offset}`);
        for (const row of rows) {
          try {
            const session = (await vault.read(row.user_id, row.connection_id))?.session;
            const expiresAt = session?.expiresAt;
            // Flagged from a week before it runs out to a week after, so one left for good isn't flagged again and again.
            if (!expiresAt || session.refreshToken || Math.abs(expiresAt - at) > LOGIN_AHEAD_MS) continue;
            // A login still kept for an account since removed needs no one.
            if (!(await db.rpc("publisher_account", { owner: row.user_id, connection: row.connection_id }))) continue;
            const kind = expiresAt <= at ? "login" : "login-soon";
            await note(row.user_id, `${kind}:${row.connection_id}:${expiresAt}`, kind, {
              connection: row.connection_id,
              platform: row.platform,
              expires: expiresAt,
              updated: row.updated_at,
            });
            noted++;
          } catch (error) {
            complain("couldn't check a login", error);
          }
        }
        if (rows.length < PAGE) return noted;
      }
    },

    async send() {
      if (sending) return 0;
      sending = true;
      try {
        const at = now();
        let due;
        try {
          due = await db.noticesDue(iso(at - HOLD_MS), iso(at - STALE_MS), MAX_TRIES, BATCH);
        } catch (error) {
          complain("couldn't read notices", error);
          return 0;
        }
        const byUser = new Map();
        for (const notice of due) byUser.set(notice.user_id, [...(byUser.get(notice.user_id) ?? []), notice]);
        let sent = 0;
        for (const [userId, notices] of byUser) {
          try {
            if (await sendTo(userId, notices)) sent++;
          } catch (error) {
            complain("couldn't email notices", error);
          }
        }
        return sent;
      } finally {
        sending = false;
      }
    },

    async prune() {
      await db.pruneNotices(iso(now() - KEEP_MS));
    },
  };
}
