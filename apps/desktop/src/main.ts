/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, BrowserWindow, nativeImage, session, shell } from "electron";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { updateElectronApp } from "update-electron-app";
import { tempPathFor } from "./atomic";
import { DapiServer } from "./dapi/server";
import { agentChatEndpoint, deleteProjectChats, startAgentChat, stopAgentChat } from "./agent-chat";
import { cliStatus, installCli, refreshCliShim, uninstallCli } from "./cli-install";
import { applyMcp, healMcpRegistrations, mcpStatus } from "./mcp-install";
import { enableHeadless } from "./headless";
import { trackEvent, trackInstall } from "./analytics";
import { setupAppMenu } from "./menu";
import { handleSquirrelEvent } from "./squirrel";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import {
  compileProject,
  createProject,
  defaultRoot,
  deleteProject,
  duplicateProject,
  getProject,
  initProject,
  pickFolder,
  pickRoot,
  renameProject,
  resolveProject,
  scanProjects,
  unwatchAll,
  listEntries,
  realPathEntry,
  noteContent,
  noteRenamed,
  readConfig,
  readManifest,
  removeEntry,
  statEntry,
  unwatchProject,
  watchProject,
  writeConfig,
  writeManifest,
  writeProject,
} from "./projects";
import type { DeepLinkChannel } from "./main-channels";
import type { LogEntry } from "@plan.video/dapi";

const DEV_URL = "http://localhost:5173";
const AUTH_PROTOCOL = "planvideo";
const MACOS_CORNER_RADIUS = 18;
const MACOS_BACKDROP = { blur: 80, red: 0.07, green: 0.07, blue: 0.07, alpha: 0.9 };
// Windows Controls Overlay matches the renderer's `h-10` drag strip and `--sidebar`; the dark value is
// that token flattened onto the sidebar, since the overlay takes opaque colours only.
const WINDOWS_OVERLAY_HEIGHT = 40;
const WINDOWS_OVERLAY_COLORS = {
  dark: { color: "#121212", symbolColor: "#a1a1a1" },
  light: { color: "#ffffff", symbolColor: "#737373" },
};

// A Squirrel.Windows install/update/uninstall launch quits on its own, so decide it before starting any service.
const squirrelLaunch = handleSquirrelEvent();

app.setName("plan.video");
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

let setNativeCornerRadius: ((handle: Buffer, radius: number) => void) | null = null;
let setNativeBackdrop:
  | ((handle: Buffer, blur: number, r: number, g: number, b: number, a: number) => void)
  | null = null;

if (process.platform === "darwin") {
  ({ setCornerRadius: setNativeCornerRadius, setBackdrop: setNativeBackdrop } = require(
    join(app.getAppPath(), "dist", "corner_radius.node"),
  ));
}

function applyCornerRadius(radius: number) {
  if (!setNativeCornerRadius || !mainWindow || mainWindow.isDestroyed()) return;
  setNativeCornerRadius(mainWindow.getNativeWindowHandle(), radius);
}

function applyBackdrop() {
  if (!setNativeBackdrop || !mainWindow || mainWindow.isDestroyed()) return;
  const { blur, red, green, blue, alpha } = MACOS_BACKDROP;
  setNativeBackdrop(mainWindow.getNativeWindowHandle(), blur, red, green, blue, alpha);
}

function setColorMode(mode: "dark" | "light") {
  if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitleBarOverlay({ ...WINDOWS_OVERLAY_COLORS[mode], height: WINDOWS_OVERLAY_HEIGHT });
}

if (app.isPackaged && !squirrelLaunch && !process.argv.includes("--hidden")) {
  updateElectronApp({ repo: "plan-video/plan-video" });
}

const openWrites = new Map<string, { handle: FileHandle; path: string; temp: string; reserved: boolean }>();

let mainWindow: BrowserWindow | null = null;

// Keyed by channel so auth and checkout never drain each other's link.
const pendingDeepLinks = new Map<DeepLinkChannel, string>();

// Lives in main so it survives reloads and captures worker logs and uncaught errors too.
const LOG_BUFFER_MAX = 2000;
const logBuffer: LogEntry[] = [];

// Packaged: staged by scripts/stage-docs.mjs into Contents/Resources/docs; dev: the repo's `docs/`.
function docsDir(): string | null {
  const dir = app.isPackaged ? join(process.resourcesPath, "docs") : join(app.getAppPath(), "..", "..", "docs");
  return existsSync(dir) ? dir : null;
}

// The first connection switches the app into headless mode.
const dapi = new DapiServer({
  version: app.getVersion(),
  logs: () => logBuffer,
  docsDir: docsDir(),
  onFirstConnection: enableHeadless,
});

function pushLog(level: LogEntry["level"], message: string, source: string) {
  logBuffer.push({ ts: Date.now(), level, message, source });
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

function captureConsole(window: BrowserWindow) {
  window.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    pushLog(level, message, sourceId ? `${sourceId}:${lineNumber}` : "");
  });
  window.webContents.on("preload-error", (_event, path, error) => {
    pushLog("error", `Preload error: ${error.message}`, path);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    pushLog("error", `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`, "");
  });
}

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`)) ?? null;
}

function isHiddenLaunch(argv: string[]): boolean {
  return argv.includes("--hidden");
}

function deepLinkChannel(url: string): DeepLinkChannel | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  if (host === "auth") return MAIN_CHANNELS.AUTH_CALLBACK;
  if (host === "checkout") return MAIN_CHANNELS.CHECKOUT_CALLBACK;
  return null;
}

function deliverDeepLink(url: string) {
  const channel = deepLinkChannel(url);
  if (!channel) return;

  // Parked until the page can take it: the renderer subscribes only once its component mounts, well
  // after did-finish-load. Consumers drain parked links via the take* handlers on mount.
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingDeepLinks.set(channel, url);
    return;
  }

  mainBridge.emit(mainWindow, channel, { url });
}

function takePendingDeepLink(channel: DeepLinkChannel): string | null {
  const url = pendingDeepLinks.get(channel) ?? null;
  pendingDeepLinks.delete(channel);
  return url;
}

async function setFileInputFiles(selector: string, absolutePath: string) {
  if (!mainWindow) throw new Error("No main window");
  const wc = mainWindow.webContents;
  // Stay attached between calls: attach/detach dominates a transfer's cost, and writes come in bursts.
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  const { root } = await wc.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`Selector not found: ${selector}`);
  await wc.debugger.sendCommand("DOM.setFileInputFiles", {
    files: [absolutePath],
    nodeId,
  });
}

function createWindow(show = true) {

  const options: Electron.BrowserWindowConstructorOptions = {
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.js"),
      backgroundThrottling: false,
    },
  }

  if (process.platform === "darwin") {
    options.titleBarStyle = "hiddenInset" as const;
    options.trafficLightPosition = { x: 14, y: 14 };
    options.vibrancy = "sidebar" as const;
    options.backgroundColor = "#00000000";
  }

  if (process.platform === "win32") {
    options.titleBarStyle = "hidden" as const;
    options.titleBarOverlay = { ...WINDOWS_OVERLAY_COLORS.dark, height: WINDOWS_OVERLAY_HEIGHT };
    options.autoHideMenuBar = true;
    options.backgroundColor = WINDOWS_OVERLAY_COLORS.dark.color;

    if (!app.isPackaged) {
      options.icon = join(app.getAppPath(), "assets", "icon-dev.png");
    }
  }

  mainWindow = new BrowserWindow(options);

  captureConsole(mainWindow);

  applyCornerRadius(MACOS_CORNER_RADIUS);
  applyBackdrop();

  mainWindow.once("ready-to-show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();

    if (show) {
      mainWindow?.show();
    }
  });

  mainWindow.on("show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();
  });

  mainWindow.on("enter-full-screen", () => {
    applyCornerRadius(0);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(join(app.getAppPath(), "web", "index.html"));
  }
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
    join(process.cwd(), process.argv[1]!),
  ]);
} else {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

if (squirrelLaunch) {
  // Update.exe is at work; handleSquirrelEvent quits the app when it is done.
} else if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) deliverDeepLink(url);

    const hidden = isHiddenLaunch(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (hidden) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow(!hidden);
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  mainBridge.handle(MAIN_CHANNELS.APP_OPEN_EXTERNAL, ({ url }) => shell.openExternal(url));
  mainBridge.handle(MAIN_CHANNELS.APP_SHOW_IN_FOLDER, ({ path }) => shell.showItemInFolder(path));
  mainBridge.handle(MAIN_CHANNELS.ANALYTICS_TRACK, ({ event, data }) => trackEvent(event, data));
  mainBridge.handle(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.AUTH_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.CHECKOUT_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false);
  mainBridge.handle(MAIN_CHANNELS.WINDOW_SET_COLOR_MODE, ({ mode }) => setColorMode(mode));
  mainBridge.handle(MAIN_CHANNELS.WINDOW_CAPTURE, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No main window");
    const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true });
    const { width, height } = image.getSize();
    const png = image.toPNG();
    // A plain Uint8Array, so the renderer sees bytes and not a Buffer.
    return { png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength), width, height };
  });
  mainBridge.handle(MAIN_CHANNELS.LOGS_GET, () => logBuffer);
  mainBridge.handle(MAIN_CHANNELS.AGENT_CHAT_ENDPOINT, () => agentChatEndpoint());
  mainBridge.handle(MAIN_CHANNELS.MCP_STATUS, () => mcpStatus());
  mainBridge.handle(MAIN_CHANNELS.MCP_APPLY, (request) => applyMcp(request));
  mainBridge.handle(MAIN_CHANNELS.CLI_STATUS, () => cliStatus());
  mainBridge.handle(MAIN_CHANNELS.CLI_INSTALL, () => installCli());
  mainBridge.handle(MAIN_CHANNELS.CLI_UNINSTALL, () => uninstallCli());
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_PICK_ROOT, () => pickRoot(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_PICK_FOLDER, () => pickFolder(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, () => defaultRoot(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_SCAN, ({ root }) => scanProjects(root));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_GET, ({ dir }) => getProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_INIT, ({ dir }) => initProject(mainWindow, dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_RESOLVE, ({ dir }) => resolveProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CREATE, ({ root, displayName }) =>
    createProject(root, displayName),
  );
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_RENAME, ({ dir, displayName }) => renameProject(dir, displayName));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DUPLICATE, ({ dir }) => duplicateProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DELETE, ({ dir }) => deleteProject(dir).then(deleteProjectChats));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_COMPILE, ({ dir }) => compileProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_WRITE, ({ dir, edits }) => writeProject(dir, edits));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_WATCH, ({ dir }, event) =>
    watchProject(BrowserWindow.fromWebContents(event.sender), dir),
  );
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_UNWATCH, ({ dir }) => unwatchProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_MANIFEST_READ, ({ dir }) => readManifest(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE, ({ dir, manifest }) => writeManifest(dir, manifest));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CONFIG_READ, ({ dir }) => readConfig(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, ({ dir, config }) => writeConfig(dir, config));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_LIST, ({ dir, source }) => listEntries(dir, source));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_STAT, ({ dir, source }) => statEntry(dir, source));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_REMOVE, ({ dir, path }) => removeEntry(dir, path));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_REAL_PATH, ({ dir, source }) => realPathEntry(dir, source));
  mainBridge.handle(MAIN_CHANNELS.FILE_TRANSFER, ({ selector, absolutePath }) =>
    setFileInputFiles(selector, absolutePath),
  );

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_OPEN, async ({ path, exclusive }) => {
    await mkdir(dirname(path), { recursive: true });

    // `exclusive` reserves the name now with an empty file, renamed over on finish and removed on abandon.
    if (exclusive) {
      noteContent(path, "");
      await (await open(path, "wx")).close();
    }

    // Written to a temp file beside the destination and renamed when whole, so nothing ever sees half an asset.
    const temp = tempPathFor(path);
    const handle = await open(temp, "wx");
    const id = randomUUID();
    openWrites.set(id, { handle, path, temp, reserved: exclusive === true });
    return { id };
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CHUNK, async ({ id, data, position }) => {
    const entry = openWrites.get(id);
    if (!entry) throw new Error(`No open file for write id ${id}`);
    await entry.handle.write(data, 0, data.byteLength, position);
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CLOSE, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
      // Claimed before the rename, the only moment the destination changes (see `noteRenamed`).
      await noteRenamed(entry.temp, entry.path);
      await rename(entry.temp, entry.path);
    } catch (error) {
      await unlink(entry.temp).catch(() => { });
      throw error;
    }
  });

  // An abandoned write never reached the destination; only an `exclusive` reservation is given back.
  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_ABORT, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
    } finally {
      await unlink(entry.temp).catch(() => { });
      if (entry.reserved) {
        noteContent(entry.path, null);
        await unlink(entry.path).catch(() => { });
      }
    }
  });

  app.whenReady().then(() => {
    if (!app.isPackaged && process.platform === "darwin") {
      const devIcon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon-dev.png"));
      if (!devIcon.isEmpty()) app.dock?.setIcon(devIcon);
    }

    setupAppMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDevicePermissionHandler(() => true);

    const url = findProtocolUrl(process.argv);
    if (url) deliverDeepLink(url);

    dapi.start();
    // `?client=chat` keeps the app from switching into remote-controlled mode (see dapi/http).
    dapi.mcpUrl().then((url) =>
      startAgentChat({
        dataDir: join(app.getPath("userData"), "agent-chat"),
        mcpUrl: url ? `${url}?client=chat` : null,
        version: app.getVersion(),
      }),
    );
    refreshCliShim();
    healMcpRegistrations();
    trackInstall();
    createWindow(!isHiddenLaunch(process.argv));
  });

  app.on("before-quit", () => {
    unwatchAll();
    stopAgentChat();
    dapi.stop();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
} else {
  app.quit();
}
