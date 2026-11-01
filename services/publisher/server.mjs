// node-fetch.mjs must stay the first import (see why there).

import { keepNodeFetch } from "./node-fetch.mjs";

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { createAccountDeletion } from "./account-deletion.mjs";
import { createApi, createUsers, json, readBody, revoke } from "./api.mjs";
import { createAccountLimits } from "./accounts.mjs";
import { createConnectLinks } from "./connect-links.mjs";
import { SENDER_PORT, onlyFromGateway } from "./gateway-link.mjs";
import { createDb } from "./db.mjs";
import { PublishError, Refused } from "./errors.mjs";
import { createHealth } from "./health.mjs";
import { createInviteMailer } from "./invites.mjs";
import { createMedia } from "./media.mjs";
import { createMailer, createNotices } from "./notices.mjs";
import { blueskyNodeProblem, createBlueskyOAuth } from "./bluesky-oauth.mjs";
import { createBluesky, useBlueskyOAuth } from "./networks/bluesky.mjs";
import { createFacebook } from "./networks/facebook.mjs";
import { createInstagram } from "./networks/instagram.mjs";
import { linkedin } from "./networks/linkedin.mjs";
import { createThreads } from "./networks/threads.mjs";
import { createTikTok } from "./networks/tiktok.mjs";
import { createX } from "./networks/x.mjs";
import { youtube } from "./networks/youtube.mjs";
import { META_NETWORKS, configured } from "./meta.mjs";
import { createMetaLogins } from "./meta-logins.mjs";
import { createPhotoMaker } from "./photo-maker.mjs";
import { PHOTO_PATH, VIDEO_PATH, createPhotos } from "./photos.mjs";
import { X_LINK_POSTS_BY_LEVEL, X_POSTS_BY_LEVEL, byLevel, createPlanLimits, uploadsPerDay } from "./plans.mjs";
import { plugs } from "./plugs.mjs";
import { startLoops } from "./loops.mjs";
import { SUPPORT_PATH, createSupport } from "./support.mjs";
import { createVault } from "./vault.mjs";
import { createWorker } from "./worker.mjs";
import { createLinkedInLogins } from "./linkedin-logins.mjs";
import { createTikTokLogins } from "./tiktok-logins.mjs";
import { createXLogins } from "./x-logins.mjs";
import { createYouTubeLogins } from "./youtube-logins.mjs";
import { createYouTubeCheck } from "./youtube-check.mjs";

keepNodeFetch();

const HOST = "127.0.0.1";
const PASS_MS = 30_000;
const DISPATCH_MS = 5_000;
/** A run is planned this long after its moment, so the clock is surely past it. */
const WAKE_AFTER_MS = 250;
/** A stop gives the sends going this long to finish, inside systemd's 90 seconds. */
const DRAIN_MS = 30_000;
/** Without a finished pass for this long, the sending is stuck and health says so (services/monitor watches it). */
const STUCK_MS = 15 * 60_000;

function loadEnv(path) {
  const env = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const dir = process.env.PLAN_VIDEO_ENV_DIR || "/etc/plan-video";
const shared = loadEnv(`${dir}/r2.env`);
const own = loadEnv(process.env.PUBLISHER_ENV || `${dir}/publisher.env`);
const tiktokEnv = loadEnv(`${dir}/tiktok.env`);
const youtubeEnv = loadEnv(`${dir}/youtube.env`);
const linkedinEnv = loadEnv(`${dir}/linkedin.env`);
const xEnv = loadEnv(`${dir}/x.env`);
const metaEnv = loadEnv(`${dir}/meta.env`);

const supabaseUrl = own.SUPABASE_URL || shared.SUPABASE_URL;
const serviceKey = own.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey || !own.TOKEN_KEY) {
  console.error("publisher: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TOKEN_KEY are needed in publisher.env");
  process.exit(1);
}

const publicUrl = own.PUBLIC_URL || "https://plan.video";
const networkEnv = {
  tiktok: { publicUrl, clientKey: tiktokEnv.TIKTOK_CLIENT_KEY || "", clientSecret: tiktokEnv.TIKTOK_CLIENT_SECRET || "", readVideos: tiktokEnv.TIKTOK_READ_VIDEOS === "true" },
  youtube: { publicUrl, clientId: youtubeEnv.YOUTUBE_CLIENT_ID || "", clientSecret: youtubeEnv.YOUTUBE_CLIENT_SECRET || "" },
  linkedin: { publicUrl, clientId: linkedinEnv.LINKEDIN_CLIENT_ID || "", clientSecret: linkedinEnv.LINKEDIN_CLIENT_SECRET || "" },
  x: { publicUrl, clientId: xEnv.X_CLIENT_ID || "", clientSecret: xEnv.X_CLIENT_SECRET || "" },
  // Instagram's and Threads' logins have app ids of their own, apart from the Facebook app's.
  instagram: { appId: metaEnv.INSTAGRAM_APP_ID || "", appSecret: metaEnv.INSTAGRAM_APP_SECRET || "" },
  facebook: { appId: metaEnv.FACEBOOK_APP_ID || "", appSecret: metaEnv.FACEBOOK_APP_SECRET || "", configId: metaEnv.FACEBOOK_CONFIG_ID || "" },
  threads: { appId: metaEnv.THREADS_APP_ID || "", appSecret: metaEnv.THREADS_APP_SECRET || "" },
};

// Runs that came due before this aren't sent, so posts that waited in the
// calendar from before the publisher existed don't all go out on its first day.
const sendFrom = Date.parse(own.SEND_FROM || "") || Date.now();
if (!own.SEND_FROM) console.warn("[publisher] SEND_FROM isn't set, so runs that came due while the service was down won't be sent");

// Without it nothing can reach the API and networks can't pull files, though other sends go on: health says so.
const senderSecret = own.SENDER_SECRET || "";
if (!senderSecret) console.error("[publisher] SENDER_SECRET isn't set, so the gateway can't reach it. services/deploy.sh makes one");

const db = createDb({ url: supabaseUrl, serviceKey });
const vault = createVault({ db, key: own.TOKEN_KEY, env: networkEnv });
const media = createMedia(shared);
// TikTok pulls a photo post's pictures from here. Its app has to have this domain verified.
const maker = createPhotoMaker({ url: (own.PHOTOS_URL || "http://127.0.0.1:8793").replace(/\/$/, "") });
const photos = createPhotos({ key: own.TOKEN_KEY, publicUrl, media, maker });
const accountLimits = createAccountLimits(db);
const planLimits = createPlanLimits({
  db,
  youtube: uploadsPerDay(own.YOUTUBE_UPLOADS_PER_DAY),
  x: { posts: byLevel(own.X_POSTS_PER_MONTH, X_POSTS_BY_LEVEL), links: byLevel(own.X_LINK_POSTS_PER_MONTH, X_LINK_POSTS_BY_LEVEL) },
});
// Meta's networks join once their apps are set up in meta.env.
const metaNetworks = { instagram: createInstagram({ photos }), facebook: createFacebook({ photos }), threads: createThreads({ photos }) };
const networks = {
  youtube,
  tiktok: createTikTok({ photos }),
  linkedin,
  bluesky: createBluesky({ maker }),
  ...(networkEnv.x.clientId ? { x: createX({ limits: planLimits }) } : {}),
  ...Object.fromEntries(META_NETWORKS.filter((network) => configured(network, networkEnv)).map((network) => [network, metaNetworks[network]])),
};
// Failed posts and LinkedIn logins running out are emailed through Resend, once its key is set.
const notices = own.RESEND_API_KEY
  ? createNotices({ db, vault, publicUrl, mailer: createMailer({ apiKey: own.RESEND_API_KEY, from: own.NOTICE_FROM || "plan.video <hello@plan.video>" }) })
  : null;
if (!notices) console.warn("[publisher] RESEND_API_KEY isn't set, so failed posts and expiring logins aren't emailed");
// The site's support form emails each report to SUPPORT_TO, with the sender as Reply-To (support.mjs).
const support = createSupport({
  mailer: own.RESEND_API_KEY ? createMailer({ apiKey: own.RESEND_API_KEY, from: own.SUPPORT_FROM || "plan.video support <hello@plan.video>" }) : null,
  to: own.SUPPORT_TO,
  supabaseUrl,
  anonKey: shared.SUPABASE_ANON_KEY || own.SUPABASE_ANON_KEY,
  readBody,
  json,
});
if (!own.SUPPORT_TO) console.warn("[publisher] SUPPORT_TO isn't set, so the support form asks people to email instead");
const worker = createWorker({ db, vault, media, networks, plugs, accountLimits, planLimits, notices, sendFrom });

const health = createHealth({ db, key: own.TOKEN_KEY });
let lastPass = Date.now();
let loops = null;
const kick = () => loops?.kick();

// "Sign in with Bluesky" on the server, once its key is set. Without it, Bluesky connects with app passwords.
const blueskyOAuth = own.BLUESKY_OAUTH_JWK
  ? await createBlueskyOAuth({ db, sealKey: own.TOKEN_KEY, privateJwk: own.BLUESKY_OAUTH_JWK, publicUrl })
  : null;
useBlueskyOAuth(blueskyOAuth);
// Started by the wrong Node (the unit and its drop-in run the official build), so health says so.
const nodeProblem = blueskyOAuth && blueskyNodeProblem();
if (nodeProblem) console.error(`[publisher] ${nodeProblem}: ${process.execPath}`);

const deletion = createAccountDeletion({
  db,
  vault,
  media,
  bluesky: blueskyOAuth,
  revoke,
  env: networkEnv,
  supabaseUrl,
  serviceKey,
  billingUrl: (own.BILLING_URL || "http://127.0.0.1:8799").replace(/\/$/, ""),
});

const logins = {
  youtube: createYouTubeLogins({ key: own.TOKEN_KEY, env: networkEnv.youtube }),
  x: createXLogins({ key: own.TOKEN_KEY, env: networkEnv.x }),
  tiktok: createTikTokLogins({ key: own.TOKEN_KEY, env: networkEnv.tiktok }),
  linkedin: createLinkedInLogins({ key: own.TOKEN_KEY, env: networkEnv.linkedin }),
  meta: createMetaLogins({ key: own.TOKEN_KEY, env: networkEnv, publicUrl }),
};
const api = createApi({
  bluesky: blueskyOAuth,
  deletion,
  env: networkEnv,
  vault,
  worker,
  kick,
  limits: accountLimits,
  db,
  ...logins,
  links: createConnectLinks({ db, key: own.TOKEN_KEY, vault, limits: accountLimits, env: networkEnv, bluesky: blueskyOAuth, ...logins }),
  mailer: createInviteMailer({ supabaseUrl, serviceKey, publicUrl, db }),
  users: createUsers({ supabaseUrl, anonKey: shared.SUPABASE_ANON_KEY || own.SUPABASE_ANON_KEY, requireInvite: (own.REQUIRE_INVITE || shared.REQUIRE_INVITE) !== "false" }),
});

const server = createServer(onlyFromGateway(senderSecret, (req, res) => {
  const path = (req.url || "").split("?")[0];
  if (path === "/api/publisher/health") {
    const problems = [
      ...(nodeProblem ? [nodeProblem] : []),
      ...(senderSecret ? [] : ["SENDER_SECRET isn't set, so the gateway can't reach the publisher"]),
      ...(Date.now() - lastPass < STUCK_MS ? [] : ["no sending pass has finished for 15 minutes"]),
      ...health.report(),
    ];
    const ok = !problems.length;
    json(res, ok ? 200 : 503, { ok, lastPass: new Date(lastPass).toISOString(), problems });
    return;
  }
  if (!path.startsWith("/api/publisher/")) {
    json(res, 404, { error: "Unknown publisher route." });
    return;
  }
  // Instagram and Threads fetch a post's video without signing in: each link is signed and runs out.
  if (path.startsWith(VIDEO_PATH)) {
    photos.serveVideo(req, res, path).catch((error) => {
      console.error("[publisher] video failed", error instanceof Error ? error.message : error);
      if (!res.headersSent) json(res, 503, { error: "The video isn't available right now." });
      else res.destroy();
    });
    return;
  }
  // TikTok fetches them without signing in: each link is signed and runs out.
  if (path.startsWith(PHOTO_PATH)) {
    photos.serve(req, res, path).catch((error) => {
      console.error("[publisher] photo failed", error instanceof Error ? error.message : error);
      if (!res.headersSent) json(res, 503, { error: "The picture isn't available right now." });
      else res.destroy();
    });
    return;
  }
  // Anyone's, signed in or not: the support form, which needs no login.
  if (path === SUPPORT_PATH) {
    support(req, res).catch((error) => {
      if (error instanceof Refused) json(res, error.status, { error: error.message });
      else {
        console.error("[publisher] support report failed", error);
        json(res, 500, { error: "Your message couldn't be sent right now. Email hello@plan.video instead." });
      }
    });
    return;
  }
  // Logins sealed with a wrong key couldn't be opened later, and none kept now can be: nothing is taken or handed out.
  if (health.keyWrong()) {
    json(res, 503, { error: "Publishing isn't available right now." });
    return;
  }
  api(req, res, path).catch((error) => {
    if (error instanceof Refused) json(res, error.status, { error: error.message });
    else if (error instanceof PublishError) json(res, error.expired ? 409 : error.retry ? 503 : 400, { error: error.message, expired: error.expired });
    else {
      console.error("[publisher] request failed", error);
      json(res, 500, { error: "Publishing isn't available right now." });
    }
  });
}));

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(SENDER_PORT, HOST, () => {
  console.log(`publisher listening on ${HOST}:${SENDER_PORT}, sending runs due from ${new Date(sendFrom).toISOString()}`);
  const adopt = () => (health.keyWrong() ? Promise.resolve(0) : worker.adopt()).then((kept) => kept && console.log(`[publisher] kept ${kept} logins from account state`)).catch((error) => console.error("[publisher] adopting logins failed", error));
  const checkHealth = () => health.check().catch((error) => console.error("[publisher] health check failed", error));
  // The key is checked before the first pass, so a wrong one sends nothing at all.
  void checkHealth()
    .then(adopt)
    .finally(() => {
      loops = startLoops({
        worker,
        // With a key that opens no login, every send would fail: the posts wait for the right key instead.
        paused: () => health.keyWrong(),
        passed: (planned) => planned && (lastPass = Date.now()),
        afterPass: () => notices?.send(),
        passMs: PASS_MS,
        dispatchMs: DISPATCH_MS,
        wakeAfterMs: WAKE_AFTER_MS,
      });
      return loops.pass();
    });
  // A restart lets the sends going finish first, so they aren't cut off and failed as ones that may have gone out.
  // The server keeps answering meanwhile: Instagram and Threads pull the files of a send going from it, through the gateway.
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      console.log(`[publisher] ${signal}: finishing the sends going`);
      void (loops ? loops.stop(DRAIN_MS) : Promise.resolve(true)).then((finished) => {
        if (!finished) console.error("[publisher] stopped with sends still going");
        process.exit(0);
      });
    });
  }
  // Hourly and a minute after starting: Free's waiting posts recounted, any wrong next look put right.
  const sweep = () => (health.keyWrong() ? Promise.resolve(0) : worker.sweep()).catch((error) => console.error("[publisher] the hourly look failed", error instanceof Error ? error.message : error));
  setTimeout(sweep, 60_000);
  setInterval(sweep, 60 * 60_000);
  setInterval(checkHealth, 60_000);
  setInterval(adopt, 60 * 60_000);
  setInterval(() => planLimits.prune().catch((error) => console.error("[publisher] pruning uploads failed", error)), 6 * 60 * 60_000);
  const youtubeCheck = createYouTubeCheck({ db, vault, env: networkEnv.youtube });
  const checkYouTube = () => youtubeCheck.run().catch((error) => console.error("[publisher] checking YouTube failed", error instanceof Error ? error.message : error));
  setTimeout(checkYouTube, 10 * 60_000);
  setInterval(checkYouTube, 24 * 60 * 60_000);
  if (notices) {
    const watch = () => notices.watchLogins().catch((error) => console.error("[publisher] checking logins failed", error));
    setTimeout(watch, 5 * 60_000);
    setInterval(watch, 12 * 60 * 60_000);
    setInterval(() => notices.prune().catch((error) => console.error("[publisher] pruning notices failed", error)), 6 * 60 * 60_000);
  }
});
