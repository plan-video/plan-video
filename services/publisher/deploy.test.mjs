// Runs services/deploy.sh for real in a temporary folder, with the commands that touch the machine stubbed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT = new URL("../deploy.sh", import.meta.url).pathname;
const FRESH = "2099-01-01T00:00:00.000Z";
const OLD = "2001-01-01T00:00:00.000Z";
const health = (lastPass, problems = []) => JSON.stringify({ ok: !problems.length, lastPass, problems });
const UNIT = "[Service]\nExecStart=/bin/true\n\n[Install]\nWantedBy=multi-user.target\n";

function write(path, text, mode = 0o644) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}

const STUBS = {
  // Records every call; the publisher's and its gateway's units always start.
  systemctl: `#!/bin/sh\necho "$*" >> "$STUB_DIR/systemctl.log"\nexit 0\n`,
  journalctl: "#!/bin/sh\nexit 0\n",
  useradd: "#!/bin/sh\nexit 0\n",
  sleep: "#!/bin/sh\nexit 0\n",
  stat: "#!/bin/sh\necho me:me\n",
  install: `#!/bin/sh
while [ $# -gt 2 ]; do shift; done
mkdir -p "$(dirname "$2")"
cp "$1" "$2"
`,
  curl: `#!/bin/sh
case "$*" in
  *8798*logins*) printf 401 ;;
  *http_code*) printf 200 ;;
  -f*) grep -q '"ok":true' "$STUB_DIR/health" && cat "$STUB_DIR/health" || exit 22 ;;
  *) cat "$STUB_DIR/health" ;;
esac
`,
  // Just enough of rsync: a tree copied over another, keeping what deploy.sh protects, leaving out what it excludes.
  rsync: `#!/bin/bash
dry=0
for arg in "$@"; do [ "$arg" = --dry-run ] && dry=1; done
from=\${@: -2:1}
to=\${@: -1}
differs=$(diff -rq -x '*.service' -x '*.service.d' -x '*.timer' -x DEPLOYED -x node_modules "$from" "$to" 2>&1 || true)
[ -z "$differs" ] || echo ">f changed"
[ "$dry" = 1 ] && exit 0
mkdir -p "$to"
find "$to" -mindepth 1 -maxdepth 1 ! -name DEPLOYED ! -name node_modules -exec rm -rf {} +
cp -R "$from/." "$to/"
find "$to" \\( -name '*.service' -o -name '*.service.d' \\) -exec rm -rf {} +
exit 0
`,
};

/** A checkout and a server, with the publisher's first version already installed. */
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pv-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const stubs = join(root, "stubs");
  for (const [name, body] of Object.entries(STUBS)) write(join(stubs, name), body, 0o755);
  const env = {
    ...process.env,
    PATH: `${stubs}:${process.env.PATH}`,
    STUB_DIR: stubs,
    DEPLOY_ROOT: join(root, "opt"),
    DEPLOY_UNITS: join(root, "units"),
    DEPLOY_BACKUPS: join(root, "backups"),
    DEPLOY_ENV: join(root, "env"),
    DEPLOY_RESTART: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  write(join(root, "env", "publisher.env"), "SENDER_SECRET=s\n");
  write(join(root, "env", "gateway.env"), "SENDER_SECRET=s");
  write(join(root, "units", "plan-video-gateway.service"), UNIT);
  cpSync(SCRIPT, join(repo, "services", "deploy.sh"));
  chmodSync(join(repo, "services", "deploy.sh"), 0o755);
  for (const name of ["tiktok", "youtube", "linkedin", "x"]) write(join(repo, "services", name, "handler.mjs"), "export {};\n");
  const git = (...args) => assert.equal(spawnSync("git", args, { cwd: repo, env }).status, 0, `git ${args.join(" ")}`);
  git("init", "-q");

  const version = (code, unit = UNIT, dropIn = "[Service]\nExecStart=\nExecStart=/bin/true\n") => {
    write(join(repo, "services", "publisher", "server.mjs"), `// ${code}\n`);
    write(join(repo, "services", "publisher", "gateway-link.mjs"), "export {};\n");
    write(join(repo, "services", "publisher", "plan-video-publisher.service"), unit);
    if (dropIn) write(join(repo, "services", "publisher", "plan-video-publisher.service.d", "node.conf"), dropIn);
    git("add", "-A");
    git("commit", "-qm", code);
  };
  const deploy = (body) => {
    writeFileSync(join(stubs, "health"), body);
    writeFileSync(join(stubs, "systemctl.log"), "");
    return spawnSync("bash", [join(repo, "services", "deploy.sh"), "publisher"], { env, encoding: "utf8" });
  };
  const installed = () => readFileSync(join(root, "opt", "plan-video-publisher", "publisher", "server.mjs"), "utf8");
  const unit = () => readFileSync(join(root, "units", "plan-video-publisher.service"), "utf8");
  const dropIn = () => readFileSync(join(root, "units", "plan-video-publisher.service.d", "node.conf"), "utf8");
  const calls = () => readFileSync(join(stubs, "systemctl.log"), "utf8").trim().split("\n");

  version("first");
  mkdirSync(join(root, "opt", "plan-video-publisher", "publisher"), { recursive: true });
  const first = deploy(health(FRESH));
  assert.equal(first.status, 0, first.stderr);
  assert.match(installed(), /first/);
  return { root, repo, git, version, deploy, installed, unit, dropIn, calls };
}

test("a deploy during an incident stays, as long as a pass finished since the restart", (t) => {
  const { version, deploy, installed } = setup(t);
  version("the fix");
  const done = deploy(health(FRESH, ["a scheduled post is over 15 minutes past its time and hasn't been sent", "6 posts from 2 people failed in the last 2 hours and none went out"]));
  assert.equal(done.status, 0, done.stderr);
  assert.match(installed(), /the fix/);
});

for (const [why, body] of Object.entries({
  "no pass has finished yet": health(null),
  "the last pass is from before the restart": health(OLD),
  "the key opens no login": health(FRESH, ["TOKEN_KEY opens none of the kept logins, so nothing can be sent"]),
  "the gateway can't reach it": health(FRESH, ["SENDER_SECRET isn't set, so the gateway can't reach the publisher"]),
  "it runs on the wrong Node": health(FRESH, ["Node 22.0.0 reports undici none; Bluesky needs undici 6.11.1 or later (run the official Node build)"]),
  "health doesn't answer": "",
})) {
  test(`a deploy rolls back when ${why}`, (t) => {
    const { version, deploy, installed } = setup(t);
    version("the new one");
    const done = deploy(body);
    assert.notEqual(done.status, 0);
    assert.match(done.stderr, /previous version is back/);
    assert.match(installed(), /first/);
  });
}

test("rolling back puts the old unit files back too, and reloads them before the restart", (t) => {
  const { version, deploy, installed, unit, dropIn, calls } = setup(t);
  const before = unit();
  const dropInBefore = dropIn();
  version("the new one", `${UNIT}# a bad unit\n`, "[Service]\nExecStart=\nExecStart=/nowhere\n");
  const done = deploy(health(null));
  assert.notEqual(done.status, 0);
  assert.match(installed(), /first/);
  assert.equal(unit(), before);
  assert.equal(dropIn(), dropInBefore);
  const list = calls();
  const restart = list.lastIndexOf("restart plan-video-publisher");
  const onNew = list.indexOf("restart plan-video-publisher");
  const reload = list.lastIndexOf("daemon-reload");
  assert.ok(onNew < reload && reload < restart, `reloaded between the failed start and the restart on the old unit: ${list.join(" | ")}`);
});

test("rolling back takes away a unit file the old version didn't have", (t) => {
  const { root, repo, git, version, deploy, calls } = setup(t);
  version("the new one", `${UNIT}# changed\n`);
  write(join(repo, "services", "publisher", "plan-video-publisher.service.d", "extra.conf"), "[Service]\nExecStart=/nowhere\n");
  git("add", "-A");
  git("commit", "-qm", "with a new drop-in");
  const done = deploy(health(null));
  assert.notEqual(done.status, 0);
  assert.equal(existsSync(join(root, "units", "plan-video-publisher.service.d", "extra.conf")), false);
  assert.ok(calls().includes("daemon-reload"));
});

test("a deploy that goes well keeps its new unit files", (t) => {
  const { version, deploy, unit } = setup(t);
  version("the new one", `${UNIT}# better\n`);
  assert.equal(deploy(health(FRESH)).status, 0);
  assert.match(unit(), /better/);
});
