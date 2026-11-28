// The welcome email, sent once after someone's first sign-in, through Resend. Its pictures are served by the
// website from /email/welcome (apps/web/public), so they follow PUBLIC_URL.

const DAY = 24 * 60 * 60_000;
/** Accounts made longer ago than this get no welcome, so turning it on doesn't email everyone who signed up before. */
export const WITHIN_MS = 2 * DAY;
export const MAX_TRIES = 5;
const BATCH = 50;

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#0a0a0a";
const BODY = "#3f3f46";
const MUTED = "#a1a1aa";

const STEPS = [
  {
    pill: "Step 1",
    title: "Connect your accounts",
    line: "YouTube, TikTok, Instagram, X and five more. Add the ones you post to, in a couple of clicks each.",
    image: "connect.jpg",
    alt: "The networks to post to in plan.video, with TikTok, Instagram and YouTube picked",
    color: "#d4c2ff",
    text: "#2e2640",
  },
  {
    pill: "Step 2",
    title: "Write it once",
    line: "Add your video or pictures and one caption. The preview shows how it looks on each network before it goes out.",
    image: "compose.jpg",
    alt: "A post's preview on a phone, as it will look on TikTok",
    color: "#ffbb8a",
    text: "#40291a",
  },
  {
    pill: "Step 3",
    title: "Pick a time",
    line: "Choose one yourself, or set your weekly posting times once in Auto-schedule and every new post fills the next one.",
    image: "time.jpg",
    alt: "The list of times to schedule a post",
    color: "#addaff",
    text: "#1a3040",
  },
];

const EDITOR = {
  pill: "Video editor",
  title: "Edit in your browser",
  line: "Cut clips, add captions and effects, then schedule straight from the editor. Nothing to install.",
  image: "edit.jpg",
  alt: "The plan.video video editor",
  color: "#f3bdff",
  text: "#3b1f40",
};

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const pill = (label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="border-radius:999px;padding:5px 12px;font-size:13px;line-height:18px;font-weight:500;color:${INK};">${escape(label)}</td></tr></table>`;

const cardText = (card, radius) => `
            <tr>
              <td class="pad" bgcolor="${card.color}" style="background-color:${card.color};border-radius:${radius};padding:36px 40px ${card.image ? 4 : 36}px 40px;">
                ${pill(card.pill)}
                <div class="card-title" style="padding-top:16px;font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.03em;color:${INK};">${escape(card.title)}</div>
                <div style="padding-top:8px;font-size:16px;line-height:25px;color:${card.text};">${card.html ?? escape(card.line)}</div>
              </td>
            </tr>`;

const picture = (src, alt, radius) => `
            <tr>
              <td style="padding:0;"><img src="${src}" width="600" alt="${escape(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:${radius};" /></td>
            </tr>`;

const card = (item, images) => cardText(item, "24px 24px 0 0") + picture(`${images}/${item.image}`, item.alt, "0 0 24px 24px");

const gap = `
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>`;

const button = (href, label, { background, color }) => `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="${background}" style="border-radius:999px;">
                      <a href="${escape(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${color};text-decoration:none;border-radius:999px;">${escape(label)}</a>
                    </td>
                  </tr>
                </table>`;

const heading = (first, second, top) => `
            <tr>
              <td class="pad section-title" style="padding:${top}px 40px 24px 40px;text-align:center;font-size:30px;line-height:36px;font-weight:600;letter-spacing:-0.03em;color:${INK};">
                ${escape(first)}<br /><span style="color:${MUTED};">${escape(second)}</span>
              </td>
            </tr>`;

export function composeWelcome({ publicUrl = "https://plan.video" } = {}) {
  const site = publicUrl.replace(/\/+$/, "");
  const images = `${site}/email/welcome`;
  const dashboard = `${site}/dashboard`;
  const mcp = `${site}/mcp`;
  const mcpLabel = mcp.replace(/^https?:\/\//, "");
  const subject = "Welcome to plan.video";
  const intro = "Thanks for joining. plan.video is built to stay simple: you plan a post once, and it goes out everywhere you post, right on time. Here's how to get your first one out.";
  const agentsLine = `Use Claude, Codex or Cursor? Connect it at ${mcpLabel} and ask it to plan your week. It schedules the posts on your calendar.`;
  const agents = {
    pill: "AI agents",
    title: "Let your AI post for you",
    html: `Use Claude, Codex or Cursor? Connect it at <a href="${escape(mcp)}" target="_blank" style="color:#2f6ff0;font-weight:500;text-decoration:none;">${escape(mcpLabel)}</a> and ask it to plan your week. It schedules the posts on your calendar.`,
    color: "#f4f4f5",
    text: BODY,
  };

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escape(subject)}</title>
    <style>
      @media (max-width: 620px) {
        .pad { padding-left: 24px !important; padding-right: 24px !important; }
        .hero-title { font-size: 34px !important; line-height: 38px !important; }
        .card-title { font-size: 24px !important; line-height: 30px !important; }
        .section-title { font-size: 26px !important; line-height: 32px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your first post, in three steps. It takes about two minutes.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:24px 12px 48px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};">
            <tr>
              <td class="pad" bgcolor="#2563eb" style="background-color:#2563eb;border-radius:24px 24px 0 0;padding:36px 48px 0 48px;text-align:center;">
                <img src="${images}/wordmark-white.png" width="131" height="26" alt="plan.video" style="display:block;width:131px;height:26px;margin:0 auto;border:0;color:#ffffff;font-size:19px;font-weight:600;" />
                <div class="hero-title" style="padding-top:40px;font-size:44px;line-height:48px;font-weight:600;letter-spacing:-0.035em;color:#ffffff;">${escape(subject)}</div>
                <div style="padding:16px 12px 0 12px;font-size:17px;line-height:26px;color:#dbe6ff;">Plan every post on one calendar. We send it to every network, on time.</div>
                <div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>${button(dashboard, "Open your dashboard", { background: "#ffffff", color: "#1d4ed8" })}
                <div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>
              </td>
            </tr>${picture(`${images}/hero.jpg`, "The plan.video calendar with a month of posts", "0 0 24px 24px")}
            <tr>
              <td class="pad" style="padding:56px 64px 0 64px;text-align:center;font-size:17px;line-height:28px;color:${BODY};">
                ${escape(intro)}
              </td>
            </tr>${heading("Your first post.", "About two minutes.", 56)}${STEPS.map((step) => card(step, images)).join(gap)}
            <tr>
              <td align="center" style="padding:36px 0 0 0;">${button(dashboard, "Schedule your first post", { background: "#2f6ff0", color: "#ffffff" })}
              </td>
            </tr>${heading("When you're ready.", "Two more things to try.", 72)}${card(EDITOR, images)}${gap}${cardText(agents, "24px")}
            <tr>
              <td align="center" style="padding:72px 40px 0 40px;">
                <img src="${images}/squirrel.png" width="44" alt="" style="display:block;width:44px;height:auto;margin:0 auto;border:0;" />
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
