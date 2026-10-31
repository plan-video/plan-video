/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { defineConfig, loadEnv, runnerImport, type Plugin, type PluginOption, type UserConfig } from 'vite'
import { agentDevPlugin } from './agent-server'
import { billingDevPlugin } from './billing-server'
import { linkedinDevPlugin } from './linkedin-server'
import { xDevPlugin } from './x-server'
import { tiktokDevPlugin } from './tiktok-server'
import { youtubeDevPlugin } from './youtube-server'
import { transcribeDevPlugin } from './transcribe-server'
import { contentSecurityPolicyPlugin } from './content-security-policy'
import { serverSecretsPlugin } from './server-env'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import tailwindcss from '@tailwindcss/vite'
import typegpu from 'unplugin-typegpu/vite'
import { resolve, sep } from 'path'
import pkg from '../../package.json'

// Prebundled so the editor doesn't re-request hundreds of workspace source files on each load.
const WORKSPACE_DEPS = [
  '@plan.video/runtime',
  '@plan.video/assets',
  '@plan.video/encoder',
  '@plan.video/jsx',
  '@plan.video/reconciler',
  '@plan.video/koota-solid',
  '@plan.video/agent-chat',
  '@plan.video/dapi',
]

// Their `solid` export points at JSX source, which optimizeDeps can't cache: dev aliases them to the compiled build.
const COMPILED_DEPS = [
  '@kobalte/core',
  '@kobalte/utils',
  '@solidjs/router',
  'solid-presence',
  'solid-prevent-scroll',
  '@corvu/utils',
  '@solid-primitives/props',
  '@solid-primitives/event-listener',
  '@solid-primitives/resize-observer',
  '@solid-primitives/keyed',
  '@solid-primitives/map',
  '@solid-primitives/media',
  '@solid-primitives/refs',
  '@solid-primitives/rootless',
  '@solid-primitives/static-store',
  '@solid-primitives/utils',
]

// Part of the dep cache's hash: the browser caches a bundle as immutable, so an edit must give it new URLs.
function workspaceStamp(): string {
  let latest = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else latest = Math.max(latest, statSync(path).mtimeMs)
    }
  }
  for (const name of WORKSPACE_DEPS) {
    try {
      walk(resolve(__dirname, '../../packages', name.replace('@plan.video/', ''), 'src'))
    } catch {
      // A package without sources here has nothing to go stale.
    }
  }
  // Patched node_modules files count too: a patch changes the bundle without touching any source.
  for (const file of patchedFiles()) {
    try {
      latest = Math.max(latest, statSync(file).mtimeMs)
    } catch {
      // Not installed yet.
    }
  }
  return String(Math.round(latest))
}

// The stamp is only read at startup, so a package edit restarts the server or the browser keeps the stale bundle.
function workspaceRestartPlugin(): Plugin {
  const dirs = WORKSPACE_DEPS.map((name) => resolve(__dirname, '../../packages', name.replace('@plan.video/', ''), 'src'))
  return {
    name: 'plan-studio-workspace-restart',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(dirs)
      let timer: ReturnType<typeof setTimeout> | undefined
      const onChange = (file: string) => {
        if (!dirs.some((dir) => file.startsWith(dir + sep))) return
        // An editor or a git checkout writes many files at once: restart once.
        clearTimeout(timer)
        timer = setTimeout(() => {
          server.config.logger.info('workspace package changed, restarting to rebuild the dep cache', { timestamp: true })
          void server.restart()
        }, 300)
      }
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

function patchedFiles(): string[] {
  const root = resolve(__dirname, '../..')
  const dir = resolve(root, 'patches')
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.patch'))
      .flatMap((name) => [...readFileSync(resolve(dir, name), 'utf8').matchAll(/^\+\+\+ b\/(\S+)$/gm)])
      .map((match) => resolve(root, match[1]!))
  } catch {
    return []
  }
}

const nodeModules = resolve(__dirname, '../../node_modules')
const waveformWorkerUrl = '/@fs' + resolve(__dirname, '../../packages/assets/src/derive/waveform-worker.ts').replaceAll('\\', '/')

function compiledDepAliases() {
  return [
    { find: /^@kobalte\/core\/(.+)$/, replacement: `${nodeModules}/@kobalte/core/dist/$1/index.js` },
    { find: /^@kobalte\/core$/, replacement: `${nodeModules}/@kobalte/core/dist/index.js` },
    { find: /^@kobalte\/utils$/, replacement: `${nodeModules}/@kobalte/utils/dist/index.js` },
    { find: /^@solidjs\/router$/, replacement: `${nodeModules}/@solidjs/router/dist/index.js` },
    { find: /^@solid-primitives\/([^/]+)$/, replacement: `${nodeModules}/@solid-primitives/$1/dist/index.js` },
    { find: /^@corvu\/([^/]+)$/, replacement: `${nodeModules}/@corvu/$1/dist/index.js` },
    { find: /^solid-presence$/, replacement: `${nodeModules}/solid-presence/dist/index.js` },
    { find: /^solid-prevent-scroll$/, replacement: `${nodeModules}/solid-prevent-scroll/dist/index.js` },
  ]
}

// The website lives in site/, its own repository; without it the app builds alone and `/` opens the dashboard.
const SITE_PLUGINS = resolve(__dirname, 'site/vite.ts')

type SiteVite = {
  sitePlugins(options: { root: string; dev: boolean; mode: string; inviteOnly: boolean }): PluginOption[]
}

export default defineConfig(async ({ mode, command }): Promise<UserConfig> => {
  const site = existsSync(SITE_PLUGINS)
    ? (await runnerImport<SiteVite>(SITE_PLUGINS, { configFile: false, logLevel: 'error' })).module
    : undefined
  const env = loadEnv(mode, __dirname, '')

  if (!site) {
    // The waitlist is plan.video's own: an app built without the site lets everyone in unless told otherwise.
    if (env.VITE_INVITE_ONLY === undefined) process.env.VITE_INVITE_ONLY = 'false'
    if (command === 'build' && /^https:\/\/(www\.)?plan\.video\/?$/.test(env.VITE_APP_URL ?? '')) {
      throw new Error('apps/web/site is missing: plan.video is built with its website. Clone it into apps/web/site, or set VITE_APP_URL to your own address.')
    }
  }

  const dev = command === 'serve'

  return {
    plugins: [
      workspaceRestartPlugin(),
      transcribeDevPlugin(__dirname, mode),
      agentDevPlugin(__dirname, mode),
      tiktokDevPlugin(__dirname, mode),
      youtubeDevPlugin(__dirname, mode),
      linkedinDevPlugin(__dirname, mode),
      xDevPlugin(__dirname, mode),
      billingDevPlugin(__dirname, mode),
      // Invite-only unless VITE_INVITE_ONLY=false, as in lib/waitlist.ts.
      ...(site ? site.sitePlugins({ root: __dirname, dev, mode, inviteOnly: env.VITE_INVITE_ONLY !== 'false' }) : []),
      // Not in dev, whose client injects scripts of its own.
      dev ? null : contentSecurityPolicyPlugin(env),
      solid(),
      tailwindcss(),
      solidSvg({ defaultAsComponent: true }),
      typegpu(),
      // Last, so it searches the files as they're deployed; its check of the env files runs before Vite reads them.
      serverSecretsPlugin(__dirname, mode),
    ],
    define: {
      APP_VERSION: JSON.stringify(pkg.version),
    },
    build: {
      rollupOptions: {
        // zod's builders are pure, so a page that only reads a constant from the API contract leaves zod out.
        treeshake: { manualPureFunctions: ['z'] },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Killfeed icons live at the repo root (`assets/killfeed`), outside this app.
      fs: {
        allow: [resolve(__dirname, '../..')],
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: {
        // For VITE_CONNECTOR_DEV=true.
        '/api/mcp': {
          target: 'http://127.0.0.1:8791',
          ws: true,
        },
        // Logins are sealed with the live publisher's key, so a local copy couldn't share them.
        // A self-hosted copy points VITE_PUBLISHER_URL (or VITE_APP_URL) at its own.
        '/api/publisher': {
          target: (({ VITE_PUBLISHER_URL, VITE_APP_URL }) => VITE_PUBLISHER_URL || VITE_APP_URL || 'https://plan.video')(
            loadEnv(mode, __dirname, 'VITE_'),
          ),
          changeOrigin: true,
          secure: true,
        },
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
      warmup: {
        clientFiles: ['./index.html'],
      },
    },
    resolve: {
      alias: [
        { find: '@site', replacement: resolve(__dirname, './site/src') },
        { find: '@', replacement: resolve(__dirname, './src') },
        ...(dev ? compiledDepAliases() : []),
      ],
    },
    optimizeDeps: {
      // Listed here so vite-plugin-solid's crawl doesn't put them back on optimizeDeps.exclude.
      include: dev
        ? [
            ...COMPILED_DEPS,
            ...WORKSPACE_DEPS,
            'marked',
            'dompurify',
            'typegpu',
            // Imported on first use: left out, Vite optimizes them mid-session and full-reloads the page.
            'mediabunny',
            'koota',
            'animejs',
            'zod',
            'idb',
            'colord',
            '@kobalte/core/breadcrumbs',
            '@kobalte/core/checkbox',
            '@kobalte/core/popover',
            '@kobalte/core/slider',
            '@kobalte/core/listbox',
            '@kobalte/core/toggle-group',
            '@kobalte/core/tabs',
            '@kobalte/core/segmented-control',
            '@kobalte/core/menubar',
            '@kobalte/core/context-menu',
            '@kobalte/core/alert-dialog',
            '@kobalte/core/separator',
            '@kobalte/core/text-field',
            '@kobalte/core/switch',
          ]
        : [],
      esbuildOptions: {
        ...(dev ? { define: { __WORKSPACE_STAMP__: JSON.stringify(workspaceStamp()) } } : {}),
        plugins: [
          {
            name: 'plan-studio-skip-editor-scan',
            setup(build) {
              // The prebundle moves this file, so the worker URL must point at the source Vite still serves.
              build.onLoad({ filter: /[\\/]packages[\\/]assets[\\/]src[\\/]derive[\\/]waveform\.ts$/ }, (args) => {
                const contents = readFileSync(args.path, 'utf8').replace(
                  "new URL('./waveform-worker.ts', import.meta.url)",
                  `new URL(${JSON.stringify(waveformWorkerUrl)}, window.location.origin)`,
                )
                return { contents, loader: 'ts' }
              })
            },
          },
        ],
      },
    },
  }
})
