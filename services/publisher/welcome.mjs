// The welcome email, sent once after someone's first sign-in, through Resend. Its pictures are served by the
// website from /email/welcome (apps/web/public), so they follow PUBLIC_URL.
//
// Gmail's dark mode recolours an email's backgrounds and words but never its pictures, so every coloured
// area is a picture and the words sit on the plain page, which it darkens cleanly.

const DAY = 24 * 60 * 60_000;
/** Accounts made longer ago than this get no welcome, so turning it on doesn't email everyone who signed up before. */
export const WITHIN_MS = 2 * DAY;
export const MAX_TRIES = 5;
const BATCH = 50;
/**
 * The pictures' folder in /email/welcome. A changed picture goes in a new folder: Gmail keeps its own copy of each
 * address, and emails already sent still load the old ones.
 */
const PICTURES = 3;

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#0a0a0a";
const BODY = "#3f3f46";
const MUTED = "#a1a1aa";
const BLUE = "#2f6ff0";

const HERO_ALT = "Welcome to plan.video. Plan every post on one calendar. We send it to every network, on time.";

const STEPS = [
  {
    pill: "Step 1",
    title: "Connect your accounts",
    line: "YouTube, TikTok, Instagram, X and five more. Add the ones you post to, in a couple of clicks each.",
    image: "connect.jpg",
    alt: "The networks to post to in plan.video, with TikTok, Instagram and YouTube picked",
    color: "#d4c2ff",
  },
  {
    pill: "Step 2",
    title: "Write it once",
    line: "Add your video or pictures and one caption. The preview shows how it looks on each network before it goes out.",
    image: "compose.jpg",
    alt: "A post's preview on a phone, as it will look on TikTok",
    color: "#ffbb8a",
  },
  {
    pill: "Step 3",
    title: "Pick a time",
    line: "Choose one yourself, or set your weekly posting times once in Auto-schedule and every new post fills the next one.",
    image: "time.jpg",
    alt: "The list of times to schedule a post",
    color: "#addaff",
  },
];

const EDITOR = {
  pill: "Video editor",
  title: "Edit in your browser",
  line: "Cut clips, add captions and effects, then schedule straight from the editor. Nothing to install.",
  image: "edit.jpg",
  alt: "The plan.video video editor",
  color: "#f3bdff",
};

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const spacer = (height) => `
            <tr><td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td></tr>`;

const picture = (src, alt, href) => {
  const img = `<img src="${src}" width="600" alt="${escape(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:24px;" />`;
  return `
            <tr>
              <td style="padding:0;">${href ? `<a href="${escape(href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}</td>
            </tr>`;
};

// The background-image keeps the blue in Gmail's dark mode, and the two blend layers keep the words white there.
const button = (href, label) => `
            <tr>
              <td align="center" style="padding:0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="${BLUE}" style="border-radius:999px;background-color:${BLUE};background-image:linear-gradient(${BLUE},${BLUE});">
                      <a href="${escape(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;"><span class="gmail-screen"><span class="gmail-difference">${escape(label)}</span></span></a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;

const heading = (first, second) => `
            <tr>
              <td class="pad section-title" style="padding:0 40px;text-align:center;font-size:30px;line-height:36px;font-weight:600;letter-spacing:-0.03em;color:${INK};">
                ${escape(first)}<br /><span style="color:${MUTED};">${escape(second)}</span>
              </td>
            </tr>`;

const section = (item, images) => `
            <tr>
              <td align="center" style="padding:0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${item.color}" style="border-radius:999px;background-color:${item.color};padding:5px 12px;font-size:13px;line-height:18px;font-weight:500;color:${INK};">${escape(item.pill)}</td></tr></table>
              </td>
            </tr>
            <tr>
              <td class="pad card-title" style="padding:14px 40px 0 40px;text-align:center;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.03em;color:${INK};">${escape(item.title)}</td>
            </tr>
            <tr>
              <td class="pad" style="padding:8px 56px 0 56px;text-align:center;font-size:16px;line-height:25px;color:${BODY};">${item.html ?? escape(item.line)}</td>
            </tr>${item.image ? spacer(24) + picture(`${images}/${item.image}`, item.alt) : ""}`;

export function composeWelcome({ publicUrl = "https://plan.video" } = {}) {
  const site = publicUrl.replace(/\/+$/, "");
  const images = `${site}/email/welcome/${PICTURES}`;
  const dashboard = `${site}/dashboard`;
  const mcp = `${site}/mcp`;
  const mcpLabel = mcp.replace(/^https?:\/\//, "");
  const subject = "Welcome to plan.video";
  const intro = "Thanks for joining. plan.video is built to stay simple: you plan a post once, and it goes out everywhere you post, right on time. Here's how to get your first one out.";
  const agentsLine = `Use Claude, Codex or Cursor? Connect it at ${mcpLabel} and ask it to plan your week. It schedules the posts on your calendar.`;
  const agents = {
    pill: "AI agents",
    title: "Let your AI post for you",
    html: `Use Claude, Codex or Cursor? Connect it at <a href="${escape(mcp)}" target="_blank" style="color:${BLUE};font-weight:500;text-decoration:none;">${escape(mcpLabel)}</a> and ask it to plan your week. It schedules the posts on your calendar.`,
    color: "#e4e4e7",
  };

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${escape(subject)}</title>
    <style>
      :root { color-scheme: light only; }
      u + .body .gmail-screen { background: #000; mix-blend-mode: screen; }
      u + .body .gmail-difference { background: #000; mix-blend-mode: difference; }
      @media (max-width: 620px) {
        .pad { padding-left: 20px !important; padding-right: 20px !important; }
        .card-title { font-size: 24px !important; line-height: 30px !important; }
        .section-title { font-size: 26px !important; line-height: 32px !important; }
      }
    </style>
  </head>
  <body class="body" style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your first post, in three steps. It takes about two minutes.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:24px 12px 48px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};">${picture(`${images}/hero.jpg`, HERO_ALT, dashboard)}${spacer(28)}${button(dashboard, "Open your dashboard")}${spacer(48)}
            <tr>
              <td class="pad" style="padding:0 64px;text-align:center;font-size:17px;line-height:28px;color:${BODY};">
                ${escape(intro)}
              </td>
            </tr>${spacer(56)}${heading("Your first post.", "About two minutes.")}${spacer(40)}${STEPS.map((step) => section(step, images)).join(spacer(56))}${spacer(40)}${button(dashboard, "Schedule your first post")}${spacer(72)}${heading("When you're ready.", "Two more things to try.")}${spacer(40)}${section(EDITOR, images)}${spacer(56)}${section(agents, images)}${spacer(72)}
            <tr>
              <td align="center" style="padding:0;">
                <img src="${images}/mark-tile.png" width="44" height="44" alt="" style="display:block;width:44px;height:44px;margin:0 auto;border:0;border-radius:12px;" />
              </td>
            </tr>
            <tr>
              <td class="pad" style="padding:20px 64px 0 64px;text-align:center;font-size:17px;line-height:28px;color:${BODY};">
                If anything's unclear, just reply to this email. I read every one.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 0 40px;text-align:center;font-size:15px;line-height:22px;color:${INK};font-weight:500;">
                Cihan Kat<br /><span style="color:${MUTED};font-weight:400;">Founder, plan.video · <a href="https://x.com/lightaims" target="_blank" style="color:${MUTED};text-decoration:underline;">@lightaims</a> on X</span>
              </td>
            </tr>
            <tr>
              <td style="padding:56px 40px 0 40px;"><div style="height:1px;line-height:1px;font-size:0;background-color:#ececee;">&nbsp;</div></td>
            </tr>
            <tr>
              <td class="pad" style="padding:24px 40px 0 40px;text-align:center;font-size:12px;line-height:19px;color:${MUTED};">
                <a href="${escape(site)}/docs" target="_blank" style="color:#71717a;text-decoration:none;">Docs</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${escape(site)}/support" target="_blank" style="color:#71717a;text-decoration:none;">Support</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${escape(site)}/changelog" target="_blank" style="color:#71717a;text-decoration:none;">What's new</a><br /><br />
                You got this email because you created a plan.video account.<br />
                plan.video · Salland 1, 1948 RE Beverwijk, the Netherlands
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const text = [
    subject,
    "",
    intro,
    "",
    ...STEPS.flatMap((step) => [`${step.pill}: ${step.title}`, step.line, ""]),
    `Open your dashboard: ${dashboard}`,
    "",
    `${EDITOR.title}: ${EDITOR.line}`,
    "",
    `Let your AI post for you: ${agentsLine}`,
    "",
    "If anything's unclear, just reply to this email. I read every one.",
    "",
    "Cihan Kat",
    "Founder, plan.video · @lightaims on X",
    "",
    "You got this email because you created a plan.video account.",
    "plan.video · Salland 1, 1948 RE Beverwijk, the Netherlands",
  ].join("\n");

  return { subject, html, text };
}

export function createWelcomes({ db, mailer, publicUrl = "https://plan.video", now = () => Date.now(), log = console }) {
  const email = composeWelcome({ publicUrl });
  const iso = (time) => new Date(time).toISOString();
  let quietUntil = 0;
  /** A function that isn't there yet is said once an hour, not every pass. */
  const complain = (what, error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/PGRST20[25]/.test(message)) {
      if (now() < quietUntil) return;
      quietUntil = now() + 60 * 60_000;
    }
    log.error(`[publisher] ${what}`, message);
  };

  let sending = false;

  return {
    async send() {
      if (sending) return 0;
      sending = true;
      try {
        let due;
        try {
          due = await db.rpc("publisher_welcomes_due", { since: iso(now() - WITHIN_MS), max_attempts: MAX_TRIES, size: BATCH });
        } catch (error) {
          complain("couldn't read welcomes", error);
          return 0;
        }
        let sent = 0;
        for (const person of due ?? []) {
          try {
            // One key per person: if noting it fails after Resend took it, the next pass's try is the same email and isn't sent again.
            const outcome = await mailer.send({ to: person.email, ...email, key: `welcome-${person.user_id}` });
            const attempts = outcome === "refused" ? MAX_TRIES : (person.attempts ?? 0) + 1;
            const done = outcome === "sent" || attempts >= MAX_TRIES;
            await db.upsert("welcome_emails", { user_id: person.user_id, attempts, sent_at: done ? iso(now()) : null }, "user_id");
            if (outcome === "sent") sent++;
          } catch (error) {
            complain("couldn't send a welcome", error);
          }
        }
        return sent;
      } finally {
        sending = false;
      }
    },
  };
}
