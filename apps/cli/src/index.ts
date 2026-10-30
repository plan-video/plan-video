#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Command, Help } from "commander";
import { z } from "zod";
import { version } from "../../../package.json";
import { AGENTIC_EDITING, MCP_URL, servedTools, toolByName } from "@plan.video/dapi";
import { APP_NAME, call, isAppDown, launchApp, ping, waitForApp } from "./cli-client";
import { runProxy } from "./mcp-proxy";

import type { GenericTool, ToolInput, ToolName } from "@plan.video/dapi";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function appError(e: unknown): never {
  if (isAppDown(e)) fail(`${APP_NAME} is not running. Launch the app first, then retry.`);
  fail((e as Error).message);
}

/** The tool's description, verbatim. */
function describe(name: ToolName): string {
  return toolByName(name).description;
}

/** An input field's description, verbatim, for the option that maps onto it. */
function field(name: ToolName, key: string): string {
  const tool: GenericTool = toolByName(name);
  const schema = tool.input.shape[key];
  if (schema === undefined) throw new Error(`tool ${name} has no input field "${key}"`);
  return schema.description ?? "";
}

/**
 * Checks the input against the tool's schema, calls the tool, and prints
 * what the app returns — its structured content, as one JSON object, the
 * same thing an agent receives. Strings stay strings: times like "45f" are
 * parsed by the schema on both sides.
 */
async function run<N extends ToolName>(name: N, input: ToolInput<N>): Promise<void> {
  if (!servedTools.some((tool) => tool.name === name)) fail(NOT_YET);
  const parsed = toolByName(name).input.safeParse(input);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const output = await call(name, input).catch(appError);
  console.log(JSON.stringify(output));
}

// Numbers are converted so the schema can check them as numbers; an empty or
// non-numeric string becomes NaN, which the schema rejects with its own message.
const numeric = (value: string): number => (value.trim() === "" ? NaN : Number(value));

/**
 * A local file (or frames folder) that exists is sent as its absolute path;
 * anything else — a URL, or a library path (`b-roll/clip.mp4`) — is passed
 * through for the app to resolve. Library paths need an open project.
 */
function assetPath(ref: string): string {
  const abs = resolve(ref);
  if (existsSync(abs)) return abs;
  if (isAbsolute(ref)) fail(`File not found: ${abs}`);
  return ref;
}

/** What a command the app does not serve yet says, while agentic editing is off. */
const NOT_YET = `Editing from agents and the CLI is not available yet. Schedule and publish posts with \`planvideo post\`.`;

/** The commands that work on projects and media, hidden from help while agentic editing is off. */
const EDITING_COMMANDS = new Set(["open", "context", "capture", "export", "check", "media", "models", "voices", "screenshot", "fonts"]);

const program = new Command();

program
  .name("planvideo")
  .description(
    AGENTIC_EDITING
      ? `The plan.video CLI: understand, generate, and edit footage.
Analyze video/audio/images, generate them with AI, and compose assets.
Use for any media analysis, media generation, or video editing task. No ffmpeg needed.`
      : `The plan.video CLI: schedule and publish social posts.`)
  .version(version);

if (!AGENTIC_EDITING) {
  program.configureHelp({
    visibleCommands: (cmd) => new Help().visibleCommands(cmd).filter((sub) => cmd !== program || !EDITING_COMMANDS.has(sub.name())),
  });
}

program
  .command("open")
  .description(
    `Launch ${APP_NAME} (or surface the running instance) and, given a path, open that folder as a project, creating the project files if the folder is not one yet. Prints the project's id, display name, and folder. Run this once before commands that need an open project (capture, check, export, context, and library paths in media commands).`,
  )
  .argument("[path]", `${field("open", "dir")} (default: none — just launch the app)`)
  .option("-b, --background", "launch or keep the app in the background, without raising a window")
  .action(async (path: string | undefined, opts: { background?: boolean }) => {
    const launched = await launchApp(opts.background ?? false);
    await (launched ? waitForApp() : ping()).catch(appError);
    if (path !== undefined) await run("open", { dir: resolve(path) });
  });

program
  .command("mcp")
  .description(
    `Serve ${APP_NAME}'s MCP server over stdio, for agents that cannot connect to it by URL (Claude Desktop). Launches the app in the background if it is not running. Agents that speak Streamable HTTP should use ${MCP_URL} directly.`,
  )
  .action(() => runProxy().catch(appError));

program
  .command("context")
  .alias("ctx")
  .description(describe("context"))
  .action(() => run("context", {}));

program
  .command("capture")
  .description(describe("capture"))
  .argument("<id>", field("capture", "id"))
  .option("-t, --times <time...>", field("capture", "times"))
  .option("-S, --separate", field("capture", "separate"))
  .option("--per-sheet <n>", field("capture", "perSheet"), numeric)
  .option("-o, --output <dir>", field("capture", "output"))
  .action((id: string, opts: Omit<ToolInput<"capture">, "id">) =>
    run("capture", { id, ...opts, output: opts.output && resolve(opts.output) }),
  );

program
  .command("export")
  .description(describe("export"))
  .argument("<id>", field("export", "id"))
  .argument("[output]", field("export", "path"))
  .action((id: string, output: string | undefined) => run("export", { id, path: output && resolve(output) }));

program
  .command("check")
  .description(`${describe("check")} Exits 1 when an error-severity issue is found.`)
  .argument("<id>", field("check", "id"))
  .action(async (id: string) => {
    const output = await call("check", { id }).catch(appError);
    console.log(JSON.stringify(output));
    if (output.issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
  });

const media = program
  .command("media")
  .alias("m")
  .description(
    "Inspect a media file by path, without adding it to the project: probe metadata, transcribe speech, grab frames, render visual previews, and analyze with multimodal models. Local files work with or without an open project; library paths need one.",
  );

media
  .command("probe")
  .description(describe("media_probe"))
  .argument("<path>", field("media_probe", "path"))
  .action((ref: string) => run("media_probe", { path: assetPath(ref) }));

media
  .command("transcribe")
  .description(describe("media_transcribe"))
  .argument("<path>", field("media_transcribe", "path"))
  .option("-o, --output <path>", field("media_transcribe", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_transcribe">, "path">) =>
    run("media_transcribe", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("grab")
  .alias("sample")
  .description(describe("media_grab"))
  .argument("<path>", field("media_grab", "path"))
  .option("-t, --times <time...>", field("media_grab", "times"))
  .option("-c, --count <n>", field("media_grab", "count"), numeric)
  .option("-a, --auto", field("media_grab", "auto"))
  .option("-s, --start <time>", field("media_grab", "start"))
  .option("-e, --end <time>", field("media_grab", "end"))
  .option("-q, --quality <preset>", field("media_grab", "quality"))
  .option("-S, --separate", field("media_grab", "separate"))
  .option("--per-sheet <n>", field("media_grab", "perSheet"), numeric)
  .option("--uncapped", field("media_grab", "uncapped"))
  .option("-o, --output <dir>", field("media_grab", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_grab">, "path">) =>
    run("media_grab", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("filmstrip")
  .alias("film")
  .description(describe("media_filmstrip"))
  .argument("<path>", field("media_filmstrip", "path"))
  .option("-s, --start <time>", field("media_filmstrip", "start"))
  .option("-e, --end <time>", field("media_filmstrip", "end"))
  .option("-x, --scale <factor>", field("media_filmstrip", "scale"), numeric)
  .option("-o, --output <path>", field("media_filmstrip", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_filmstrip">, "path">) =>
    run("media_filmstrip", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("waveform")
  .alias("wave")
  .description(describe("media_waveform"))
  .argument("<path>", field("media_waveform", "path"))
  .option("-s, --start <time>", field("media_waveform", "start"))
  .option("-e, --end <time>", field("media_waveform", "end"))
  .option("-x, --scale <factor>", field("media_waveform", "scale"), numeric)
  .option("-o, --output <path>", field("media_waveform", "output"))
  .action((ref: string, opts: Omit<ToolInput<"media_waveform">, "path">) =>
    run("media_waveform", { path: assetPath(ref), ...opts, output: opts.output && resolve(opts.output) }),
  );

media
  .command("listen")
  .description(describe("media_listen"))
  .argument("<path>", field("media_listen", "path"))
  .option("-p, --prompt <str>", field("media_listen", "prompt"))
  .option("-s, --start <time>", field("media_listen", "start"))
  .option("-e, --end <time>", field("media_listen", "end"))
  .action((ref: string, opts: Omit<ToolInput<"media_listen">, "path">) => run("media_listen", { path: assetPath(ref), ...opts }));

program
  .command("models")
  .description(describe("models"))
  .argument("[type]", field("models", "type"))
  .action((type: ToolInput<"models">["type"]) => run("models", { type }));

program
  .command("voices")
  .description(describe("voices"))
  .action(() => run("voices", {}));

program
  .command("logs")
  .description(describe("logs"))
  .option("-n, --tail <n>", field("logs", "tail"), numeric)
  .option("-l, --level <level>", field("logs", "level"))
  .option("--since <ms>", field("logs", "since"), numeric)
  .option("-c, --contains <text>", field("logs", "contains"))
  .action((opts: ToolInput<"logs">) => run("logs", opts));

program
  .command("screenshot")
  .description(describe("screenshot"))
  .option("-o, --output <dir>", field("screenshot", "output"))
  .action((opts: ToolInput<"screenshot">) => run("screenshot", { output: opts.output && resolve(opts.output) }));

program
  .command("report")
  .alias("issue")
  .description(describe("report"))
  .argument("<title>", field("report", "title"))
  .option("-b, --body <text>", field("report", "body"))
  .option("-c, --commands <cmd...>", field("report", "commands"))
  .option("--logs <n>", field("report", "logs"), numeric)
  .action((title: string, opts: Omit<ToolInput<"report">, "title">) => run("report", { title, ...opts }));

program
  .command("fonts")
  .description(describe("fonts"))
  .option("-f, --family <pattern>", field("fonts", "family"))
  .option("-w, --weights <weights...>", field("fonts", "weights"))
  .option("-s, --style <style>", field("fonts", "style"))
  .option("-l, --limit <n>", field("fonts", "limit"), numeric)
  .action((opts: ToolInput<"fonts">) => run("fonts", opts));

const post = program
  .command("post")
  .description("Schedule and publish social posts. Scheduling saves to the calendar and does not publish. publish sends TikTok, YouTube, Bluesky and LinkedIn immediately.");

post.command("accounts").description(describe("social_accounts")).action(() => run("social_accounts", {}));

post
  .command("schema")
  .description(describe("social_schema"))
  .argument("[platform]", field("social_schema", "platform"))
  .action((platform: ToolInput<"social_schema">["platform"]) => run("social_schema", { platform }));

post
  .command("tiktok")
  .description(describe("tiktok_creator"))
  .option("-a, --account <id>", field("tiktok_creator", "account"))
  .action((opts: { account?: string }) => run("tiktok_creator", { account: opts.account }));

type ScheduleFlags = {
  platform?: ToolInput<"schedule_post">["platforms"];
  account?: string[];
  day?: string;
  time?: string;
  draft?: boolean;
  media?: string;
  link?: string;
  youtubeTitle?: string;
  youtubePrivacy?: NonNullable<ToolInput<"schedule_post">["youtube"]>["privacy"];
  youtubeTag?: string[];
  madeForKids?: boolean;
  tiktokPrivacy?: NonNullable<ToolInput<"schedule_post">["tiktok"]>["privacy"];
  tiktokInbox?: boolean;
  tiktokPromotion?: NonNullable<ToolInput<"schedule_post">["tiktok"]>["promotion"];
  tiktokAgreed?: boolean;
  comments?: boolean;
  duet?: boolean;
  stitch?: boolean;
  every?: number;
  unit?: NonNullable<ToolInput<"schedule_post">["repeat"]>["unit"];
  until?: string;
  times?: number;
  stopRepeat?: boolean;
};

function postExtras(opts: ScheduleFlags): Omit<ToolInput<"schedule_post">, "caption" | "platforms"> {
  if ((opts.every !== undefined || opts.until || opts.times !== undefined) && !opts.unit) {
    fail("Pass --unit day, week, month, or weekday with the repeat.");
  }
  const youtube = opts.youtubeTitle || opts.youtubePrivacy || opts.youtubeTag || opts.madeForKids
    ? { title: opts.youtubeTitle, privacy: opts.youtubePrivacy, madeForKids: opts.madeForKids || undefined, tags: opts.youtubeTag }
    : undefined;
  const tiktok = opts.tiktokPrivacy || opts.tiktokInbox || opts.tiktokPromotion || opts.tiktokAgreed || opts.comments || opts.duet || opts.stitch
    ? {
        privacy: opts.tiktokPrivacy,
        inbox: opts.tiktokInbox || undefined,
        promotion: opts.tiktokPromotion,
        agreed: opts.tiktokAgreed || undefined,
        comments: opts.comments || undefined,
        duet: opts.duet || undefined,
        stitch: opts.stitch || undefined,
      }
    : undefined;
  const repeat = opts.unit ? { every: opts.every, unit: opts.unit, until: opts.until, times: opts.times } : undefined;
  return {
    accounts: opts.account,
    day: opts.day,
    time: opts.time,
    draft: opts.draft || undefined,
    media: opts.media && assetPath(opts.media),
    link: opts.link,
    youtube,
    tiktok,
    repeat,
  };
}

function addScheduleOptions(command: Command) {
  return command
    .option("-a, --account <id...>", field("schedule_post", "accounts"))
    .option("--day <date>", field("schedule_post", "day"))
    .option("--time <time>", field("schedule_post", "time"))
    .option("--draft", field("schedule_post", "draft"))
    .option("-m, --media <path>", field("schedule_post", "media"))
    .option("--link <url>", field("schedule_post", "link"))
    .option("--youtube-title <title>", "YouTube title. Defaults to the first line of the caption.")
    .option("--youtube-privacy <privacy>", "Who can watch on YouTube: public, unlisted, or private.")
    .option("--youtube-tag <tag...>", "YouTube tags, without a leading #.")
    .option("--made-for-kids", "Mark the YouTube video as made for kids.")
    .option("--tiktok-privacy <privacy>", "Who can watch on TikTok: public, friends, followers, or private.")
    .option("--tiktok-inbox", "Send the video to the TikTok inbox instead of the profile.")
    .option("--tiktok-promotion <kind>", "Whether the TikTok post promotes something: none, your_brand, branded_content, or both.")
    .option("--tiktok-agreed", "You accept TikTok's terms for this post, as post tiktok shows them.")
    .option("--comments", "Allow TikTok comments.")
    .option("--duet", "Allow TikTok duets.")
    .option("--stitch", "Allow TikTok stitches.")
    .option("--every <n>", "Repeat every N of --unit.", numeric)
    .option("--unit <unit>", "Repeat unit: day, week, month, or weekday.")
    .option("--until <date>", "Last day of a repeat, YYYY-MM-DD.")
    .option("--times <n>", "Stop a repeat after this many posts.", numeric);
}

addScheduleOptions(
  post
    .command("schedule")
    .description(describe("schedule_post"))
    .argument("<caption>", field("schedule_post", "caption"))
    .requiredOption("-p, --platform <id...>", field("schedule_post", "platforms")),
).action((caption: string, opts: ScheduleFlags) => {
  if (!opts.platform) fail("Pick at least one --platform.");
  return run("schedule_post", { caption, platforms: opts.platform, ...postExtras(opts) });
});

addScheduleOptions(
  post
    .command("update")
    .description(describe("update_post"))
    .argument("<id>", field("update_post", "id"))
    .option("-c, --caption <text>", field("update_post", "caption"))
    .option("-p, --platform <id...>", field("schedule_post", "platforms"))
    .option("--stop-repeat", "Stop repeating."),
).action((id: string, opts: ScheduleFlags & { caption?: string }) => {
  const extra = postExtras(opts);
  return run("update_post", {
    id,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
    ...(opts.platform ? { platforms: opts.platform } : {}),
    ...extra,
    repeat: opts.stopRepeat ? null : extra.repeat,
  });
});

post
  .command("copy")
  .description(describe("copy_post"))
  .argument("<id>", field("copy_post", "id"))
  .option("-c, --caption <text>", field("copy_post", "caption"))
  .option("-p, --platform <id...>", field("copy_post", "platforms"))
  .option("-a, --account <id...>", field("copy_post", "accounts"))
  .option("--day <date>", field("copy_post", "day"))
  .option("--time <time>", field("copy_post", "time"))
  .option("--draft", field("copy_post", "draft"))
  .option("--tiktok-agreed", "You accept TikTok's terms for the copy, as post tiktok shows them.")
  .action((id: string, opts: { caption?: string; platform?: ToolInput<"copy_post">["platforms"]; account?: string[]; day?: string; time?: string; draft?: boolean; tiktokAgreed?: boolean }) =>
    run("copy_post", {
      id,
      ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
      ...(opts.platform ? { platforms: opts.platform } : {}),
      ...(opts.account ? { accounts: opts.account } : {}),
      ...(opts.day ? { day: opts.day } : {}),
      ...(opts.time ? { time: opts.time } : {}),
      ...(opts.draft ? { draft: true } : {}),
      ...(opts.tiktokAgreed ? { tiktok: { agreed: true } } : {}),
    }),
  );

post
  .command("list")
  .description(describe("list_posts"))
  .option("--id <id>", field("list_posts", "id"))
  .option("--status <status>", field("list_posts", "status"))
  .option("--platform <id>", field("list_posts", "platform"))
  .option("--from <date>", field("list_posts", "from"))
  .option("--to <date>", field("list_posts", "to"))
  .option("--limit <n>", field("list_posts", "limit"), numeric)
  .action((opts: ToolInput<"list_posts">) => run("list_posts", opts));

post
  .command("delete")
  .description(describe("delete_post"))
  .argument("<id>", field("delete_post", "id"))
  .action((id: string) => run("delete_post", { id }));

post
  .command("publish")
  .description(describe("publish_post"))
  .argument("<id>", field("publish_post", "id"))
  .option("--agreed", field("publish_post", "agreed"))
  .action((id: string, opts: { agreed?: boolean }) => run("publish_post", { id, ...(opts.agreed ? { agreed: true } : {}) }));

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
program.parse(process.argv, { from: "node" });
