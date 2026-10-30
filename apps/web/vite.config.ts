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

// Workspace packages are TypeScript source. Bundling them once into the dep
// cache keeps the editor from re-requesting hundreds of files on each load.
// The cache lives in node_modules/.vite and survives server restarts.
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

// These publish a compiled build and a `solid` export that points at JSX
// source. vite-plugin-solid prefers the source, which cannot be cached.
// Dev aliases them to the compiled files so optimizeDeps can store one bundle.
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

/**
 * When the workspace sources last changed. Part of the dep cache's hash, so an
 * edit to a package rebuilds the bundle on the next start and gives it new
 * URLs: the browser holds a bundle as immutable under its old ones.
 */
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
  // The files patches/ rewrites in node_modules, too: applying a patch (or an
  // install undoing one) changes the bundle without touching any source, and
  // the browser would otherwise keep running the old one under the same URLs.
  for (const file of patchedFiles()) {
    try {
      latest = Math.max(latest, statSync(file).mtimeMs)
    } catch {
      // Not installed yet.
    }
  }
  return String(Math.round(latest))
}

/**
 * The stamp above is read when the server starts, so a package edited while it
 * runs would keep being served from the old bundle: an import of anything the
 * edit added fails in the browser. Restarting reads the stamp again, which
 * rebuilds the bundle under new URLs, and the open tabs reload onto it.
 */
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

/**
 * plan.video's website (homepage, feature pages, docs pages…), kept in site/,
 * its own repository. Without it the app builds alone: `/` opens the dashboard.
 */
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
    // plan.video's own build always carries its website.
    if (command === 'build' && mode !== 'desktop' && /^https:\/\/(www\.)?plan\.video\/?$/.test(env.VITE_APP_URL ?? '')) {
      throw new Error('apps/web/site is missing: plan.video is built with its website. Clone it into apps/web/site, or set VITE_APP_URL to your own address.')
    }
  }

  // The desktop app bundles this build; missing client env would silently ship with auth disabled.
  if (mode === 'desktop') {
    const env = loadEnv(mode, __dirname, '')
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      if (!env[key]) {
        throw new Error(`${key} is not set. Copy apps/web/.env.example to apps/web/.env before building the desktop app.`)
      }
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
      // The website's styles, head, pictures and each public page's own HTML.
      // Invite-only unless VITE_INVITE_ONLY=false, as in lib/waitlist.ts.
      ...(site ? site.sitePlugins({ root: __dirname, dev, mode, inviteOnly: env.VITE_INVITE_ONLY !== 'false' }) : []),
      // A Content-Security-Policy in every page, with its inline scripts' hashes.
      // Not in dev, whose client injects scripts of its own, nor in the desktop app.
      mode === 'desktop' || dev ? null : contentSecurityPolicyPlugin(env),
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
        // zod's schema builders have no side effects. Saying so lets a page that only reads a
        // constant from the API contract (the sign-in context does) leave its schemas, and zod, out.
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
        // The hosted agent connector (services/mcp), for VITE_CONNECTOR_DEV=true.
        '/api/mcp': {
          target: 'http://127.0.0.1:8791',
          ws: true,
        },
        // The live publisher (services/publisher). Logins are sealed with its
        // key, so a local copy couldn't share them; the dev site signs in to
        // the live database, whose sessions it accepts. A self-hosted copy
        // points VITE_PUBLISHER_URL (or VITE_APP_URL) at its own.
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
      // Compile the sign-in screen as soon as the server is up, so the
      // browser is not the thing that starts that work.
      warmup: {
        clientFiles: ['./index.html'],
      },
    },
    resolve: {
      alias: [
        { find: '@site', replacement: resolve(__dirname, './site/src') },
        { find: '@', replacement: resolve(__dirname, './src') },
        { find: '@desktop', replacement: resolve(__dirname, '../desktop/src') },
        ...(dev ? compiledDepAliases() : []),
      ],
    },
    optimizeDeps: {
      // Listed in the user config so vite-plugin-solid's crawl does not put
      // them back on optimizeDeps.exclude.
      include: dev
        ? [
            ...COMPILED_DEPS,
            ...WORKSPACE_DEPS,
            'marked',
            'dompurify',
            'typegpu',
            // The editor imports these on first use. Left out of the startup
            // bundle, Vite optimizes them mid-session and full-reloads the page.
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
      // The dep scanner follows dynamic import(). The editor page is part of
      // that crawl so its dependencies are ready before the first edit.
      // Desktop tool handlers stay out: the website never loads them.
      esbuildOptions: {
        ...(dev ? { define: { __WORKSPACE_STAMP__: JSON.stringify(workspaceStamp()) } } : {}),
        plugins: [
          {
            name: 'plan-studio-skip-editor-scan',
            setup(build) {
              build.onResolve({ filter: /^@\/dapi\/tools$/ }, (args) => ({
                path: args.path,
                external: true,
              }))
              // The prebundle moves this file out of its folder, so the worker
              // URL has to point at the source Vite can still serve.
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
