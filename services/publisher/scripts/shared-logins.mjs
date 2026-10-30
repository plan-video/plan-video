// Finds TikTok and LinkedIn logins a workspace's admins or members may hold copies of, and with --revoke
// ends them at the network so no copy still works (the owner then connects again). Only sees workspaces
// with people in them now; --everyone covers every TikTok and LinkedIn login. Run on the server as the
// publisher's user: node scripts/shared-logins.mjs [--everyone] [--revoke]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { revoke } from "../api.mjs";
import { createDb } from "../db.mjs";
import { createVault } from "../vault.mjs";

const PAGE = 1000;
const NETWORKS = new Set(["tiktok", "linkedin"]);

async function every(db, table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.select(table, {}, columns, `&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** `admin`, `member` (TikTok's 24-hour token only), or `everyone` when asked for every login. */
export async function sharedLogins(db, { everyone = false } = {}) {
  const logins = (await every(db, "social_tokens", "user_id,connection_id,platform")).filter((row) => NETWORKS.has(row.platform));
  const joined = (await every(db, "workspace_members", "owner_id,workspace_id,role,user_id")).filter((row) => row.user_id);
  const found = [];
  for (const owner of new Set(logins.map((row) => row.user_id))) {
    const team = joined.filter((row) => row.owner_id === owner);
    const listed = team.length ? ((await db.rpc("publisher_workspace_connections", { owner })) ?? []) : [];
    for (const login of logins.filter((row) => row.user_id === owner)) {
      const workspaces = listed.filter((row) => row.connection_id === login.connection_id).map((row) => row.workspace_id);
      const people = team.filter((row) => workspaces.includes(row.workspace_id));
      const why = people.some((row) => row.role === "admin")
        ? "admin"
        : people.length && login.platform === "tiktok"
          ? "member"
          : everyone
            ? "everyone"
            : "";
      if (why) found.push({ ...login, why, workspaces });
    }
  }
  return found;
}

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
    const eq = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function main() {
  const dir = process.env.PLAN_VIDEO_ENV_DIR || "/etc/plan-video";
  const own = loadEnv(process.env.PUBLISHER_ENV || `${dir}/publisher.env`);
  const tiktokEnv = loadEnv(`${dir}/tiktok.env`);
  const linkedinEnv = loadEnv(`${dir}/linkedin.env`);
  const url = own.SUPABASE_URL || loadEnv(`${dir}/r2.env`).SUPABASE_URL;
  if (!url || !own.SUPABASE_SERVICE_ROLE_KEY || !own.TOKEN_KEY) {
    console.error("shared-logins: publisher.env needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TOKEN_KEY");
    process.exit(1);
  }
  const env = {
    tiktok: { clientKey: tiktokEnv.TIKTOK_CLIENT_KEY || "", clientSecret: tiktokEnv.TIKTOK_CLIENT_SECRET || "" },
    linkedin: { clientId: linkedinEnv.LINKEDIN_CLIENT_ID || "", clientSecret: linkedinEnv.LINKEDIN_CLIENT_SECRET || "" },
  };
  const db = createDb({ url, serviceKey: own.SUPABASE_SERVICE_ROLE_KEY });
  const vault = createVault({ db, key: own.TOKEN_KEY, env });
  const found = await sharedLogins(db, { everyone: process.argv.includes("--everyone") });
  const ending = process.argv.includes("--revoke");
  console.log(`${found.length} TikTok and LinkedIn logins ${ending ? "to end" : "found"}${found.length ? ":" : "."}`);
  let failed = 0;
  for (const login of found) {
    const line = `  ${login.platform} ${login.user_id}:${login.connection_id} (${login.why}${login.workspaces.length ? `; in ${login.workspaces.join(", ")}` : ""})`;
    if (!ending) {
      console.log(line);
      continue;
    }
    const kept = await vault.read(login.user_id, login.connection_id).catch(() => null);
    const ended = kept ? await revoke(kept.platform, kept.session, env) : true;
    // Removed only once the network has ended it, so a failed revoke can be run again.
    if (ended) await vault.remove(login.user_id, login.connection_id);
    else failed++;
    console.log(`${line}: ${ended ? "ended; the owner connects it again" : "the network didn't confirm, so it's kept; run again"}`);
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
