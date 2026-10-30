/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn, execFileSync } from "node:child_process";
import { get } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { npm } from "./lib/npm.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "node_modules", ".bin");
const DEV_PORT = 5173;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const WINDOWS = process.platform === "win32";
const children = [];
let shuttingDown = false;

function run(name, bin, args, cwd) {
  // Not via `npm run`, which reports the teardown SIGTERM as a failed lifecycle script. Detached so
  // teardown can signal the whole process group. Windows has neither groups nor spawnable `.cmd`
  // shims: the shim runs through a shell and `taskkill /T` takes the tree down instead.
  const child = WINDOWS
    ? spawn(`"${join(BIN, `${bin}.cmd`)}"`, args, { cwd, stdio: "inherit", shell: true })
    : spawn(join(BIN, bin), args, { cwd, stdio: "inherit", detached: true });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n[dev:desktop] ${name} exited (${code}); shutting down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function killTree(pid, signal = "SIGTERM") {
  try {
    if (WINDOWS) execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  // A negative pid signals the child's whole process group.
  for (const child of children) killTree(WINDOWS ? child.pid : -child.pid);
  process.exit(code);
}

// Probes the URL Electron loads, so it follows the same host resolution (Vite binds localhost as ::1).
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = get(url, (res) => {
        res.destroy();
        resolve();
      });
      req.once("error", () => {
        req.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Vite did not come up at ${url} in time`));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

function listeners(port) {
  if (WINDOWS) {
    try {
      // `  TCP    [::1]:5173    [::]:0    LISTENING    1234`
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      const v6 = execFileSync("netstat", ["-ano", "-p", "TCPv6"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      const pids = `${out}\n${v6}`
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((cols) => cols[0] === "TCP" && cols[3] === "LISTENING" && cols[1]?.endsWith(`:${port}`))
        .map((cols) => Number(cols[4]))
        .filter(Boolean);
      return [...new Set(pids)];
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().split("\n").map((line) => Number(line.trim())).filter(Boolean);
  } catch {
    return []; // lsof exits 1 when nothing listens.
  }
}

function commandOf(pid) {
  if (WINDOWS) {
    try {
      const query = `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`;
      return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  }
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// Windows paths compare without case.
function isOurVite(command) {
  const root = ROOT.replace(/[\\/]$/, "");
  const [haystack, needle] = WINDOWS ? [command.toLowerCase(), root.toLowerCase()] : [command, root];
  return haystack.includes("vite") && haystack.includes(needle);
}

// Only a stale Vite from this checkout is killed; anything else on the port is not ours to touch.
async function reclaimPort(port) {
  const pids = listeners(port);
  if (!pids.length) return;
  for (const pid of pids) {
    const command = commandOf(pid);
    if (!isOurVite(command)) {
      console.error(`[dev:desktop] port ${port} is in use by another process (pid ${pid}): ${command || "unknown"}`);
      process.exit(1);
    }
    console.log(`[dev:desktop] port ${port} held by a stale vite (pid ${pid}); stopping it…`);
    killTree(pid);
  }
  const deadline = Date.now() + 5000;
  while (listeners(port).length) {
    if (Date.now() > deadline) {
      for (const pid of listeners(port)) killTree(pid, "SIGKILL");
      await new Promise((r) => setTimeout(r, 200));
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Built first so a linked `dapi` and the app's headless server run the same code.
console.log("[dev:desktop] building CLI…");
npm(["run", "build", "--workspace=@plan.video/cli"]);

await reclaimPort(DEV_PORT);
console.log("[dev:desktop] starting web dev server…");
run("web", "vite", [], join(ROOT, "apps", "web"));

try {
  await waitForServer(DEV_URL);
} catch (err) {
  console.error(`[dev:desktop] ${err.message}`);
  shutdown(1);
}
console.log("[dev:desktop] building desktop app…");
npm(["run", "build", "--workspace=@plan.video/desktop"]);
console.log("[dev:desktop] starting desktop app…");
run("desktop", "electron-forge", ["start"], join(ROOT, "apps", "desktop"));
