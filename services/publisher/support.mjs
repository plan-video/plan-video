// Anyone can send a report, signed in or not, so nothing is ever emailed to the address someone typed
// (it's only the Reply-To), a hidden field bots fill in is thanked and dropped, and each address, each
// network and the whole site have hourly and daily limits.

import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const SUPPORT_PATH = "/api/publisher/support";

export const KINDS = { bug: "Bug", feature: "Feature request", other: "Question" };

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,255}\.[^\s@<>()",;:]{2,63}$/;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;
const BODY_MAX = 16 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const LIMITS = [
  { scope: "ip", max: 5, ms: HOUR },
  { scope: "ip", max: 15, ms: DAY },
  { scope: "email", max: 10, ms: DAY },
  { scope: "site", max: 300, ms: DAY },
];

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const line = (value, max) =>
  typeof value === "string"
    ? [...value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()].slice(0, max).join("")
    : "";

/** The last X-Forwarded-For hop, the one the reverse proxy appended. IPv6 counts by its /64 (as services/agent does). */
export function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  let ip = (forwarded.at(-1) ?? req.socket?.remoteAddress ?? "").split("%")[0];
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  if (isIP(ip) !== 6) return ip || "unknown";
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

export function parseReport(body) {
  if (!body || typeof body !== "object") return { error: "That request isn't a report." };
  // The hidden field: people never see it, form-filling bots fill it in.
  if (typeof body.website === "string" && body.website.trim()) return { trap: true };
  const kind = Object.hasOwn(KINDS, body.kind) ? body.kind : "other";
  const email = line(body.email, 320).toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter the email address we should reply to." };
  const message = typeof body.message === "string" ? body.message.replace(/\r\n?/g, "\n").trim() : "";
  if ([...message].length < MESSAGE_MIN) return { error: "Tell us a little more, so we can help." };
  if ([...message].length > MESSAGE_MAX) return { error: `Keep it under ${MESSAGE_MAX} characters.` };
  return {
    report: {
      kind,
      email,
      message,
      page: line(body.page, 300),
      browser: line(body.browser, 300),
      language: line(body.language, 20),
    },
  };
}

export function composeReport(report, { account, at }) {
  const firstLine = line(report.message.split("\n")[0], 80);
  const subject = `[${KINDS[report.kind]}] ${firstLine}`;
  const facts = [
    ["From", report.email],
    ["Account", account ? `${account.email || "no email"} (${account.id})` : "Not signed in"],
    ["Page", report.page],
    ["Browser", report.browser],
    ["Language", report.language],
    ["Sent", new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
  ].filter(([, value]) => value);
  const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html =
    `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#111;max-width:640px">` +
    `<p style="margin:0 0 16px;white-space:pre-wrap">${escape(report.message)}</p>` +
    `<table style="border-collapse:collapse;font-size:13px;color:#555">` +
    facts.map(([label, value]) => `<tr><td style="padding:2px 16px 2px 0;color:#888">${escape(label)}</td><td style="padding:2px 0">${escape(value)}</td></tr>`).join("") +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:13px;color:#888">Reply to this email to answer ${escape(report.email)}.</p>` +
    `</div>`;
  const text = `${report.message}\n\n${facts.map(([label, value]) => `${label}: ${value}`).join("\n")}\n`;
  return { subject, html, text };
}

/** Without `mailer` or `to`, the form says to email instead. */
export function createSupport({ mailer, to, supabaseUrl, anonKey, readBody, json, now = () => Date.now(), fetch: call = fetch, log = console }) {
  const windows = new Map();

  function allowed(key, max, ms) {
    const at = now();
    const entry = windows.get(key);
    if (!entry || entry.reset <= at) {
      if (windows.size > 20_000) windows.clear();
      windows.set(key, { count: 1, reset: at + ms });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  }

  async function accountOf(req) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token.length > 4096 || !supabaseUrl || !anonKey) return null;
    try {
      const response = await call(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const user = await response.json();
      return typeof user?.id === "string" ? { id: user.id, email: typeof user.email === "string" ? user.email : "" } : null;
    } catch {
      return null;
    }
  }

  return async function handle(req, res) {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!mailer || !to) return json(res, 503, { error: "The form isn't available right now. Email hello@plan.video instead." });
    const body = await readBody(req, BODY_MAX);
    const parsed = parseReport(body);
    // A bot is told it worked, so it has no reason to try again.
    if (parsed.trap) return json(res, 200, { sent: true });
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const { report } = parsed;

    const ip = clientIp(req);
    const keys = { ip: `ip:${ip}`, email: `email:${report.email}`, site: "site" };
    for (const { scope, max, ms } of LIMITS) {
      if (!allowed(`${keys[scope]}:${ms}`, max, ms)) {
        return json(res, 429, { error: "That's a lot of reports at once. Try again later, or email hello@plan.video." });
      }
    }

    const account = await accountOf(req);
    const at = now();
    const email = composeReport(report, { account, at });
    // The same report sent twice within the day, as from a double click, is emailed once.
    const key = `support-${createHash("sha256").update(`${report.email}\n${report.kind}\n${report.message}\n${new Date(at).toISOString().slice(0, 10)}`).digest("hex").slice(0, 40)}`;
    const outcome = await mailer.send({ to, replyTo: report.email, key, ...email });
    if (outcome !== "sent") {
      log.error("[publisher] support report not emailed", outcome);
      return json(res, 503, { error: "Your message couldn't be sent right now. Try again in a minute, or email hello@plan.video." });
    }
    return json(res, 200, { sent: true });
  };
}
