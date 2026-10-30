/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* @refresh reload */
import './lib/zod-config'
import { render } from 'solid-js/web'
import './index.css'
import App from './app'
import { initAnalytics } from './lib/analytics'
import { initGoogleAnalytics } from './lib/google-analytics'
import { fadeInImages } from './lib/motion'
import { loadStartingLanguage } from './lib/i18n'
import { restoreLastRoute } from './lib/persist-route'
import { isReloadingAfterModuleError } from './components/route-error'

// Sentry starts once the page has loaded, so the first paint doesn't wait for it.
// Errors from before then are kept and sent when it's up. A build without
// VITE_SENTRY_DSN (apps/web/.env) reports nowhere and never loads Sentry.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (import.meta.env.PROD && sentryDsn) {
  const early: unknown[] = []
  // An error event can come without an error (a ResizeObserver loop, another
  // site's script): there is nothing to send, and Sentry would file it as "null".
  const keep = (event: ErrorEvent | PromiseRejectionEvent) => {
    const error = event instanceof ErrorEvent ? event.error : event.reason
    if (error != null) early.push(error)
  }
  window.addEventListener('error', keep)
  window.addEventListener('unhandledrejection', keep)
  const start = () =>
    void import('@sentry/solid').then(({ init, captureException }) => {
      init({
        dsn: sentryDsn,
        sendDefaultPii: false,
        release: APP_VERSION,
        environment: 'production',
        // A deploy replaced the files under this tab and it is reloading: code
        // that asked for the old ones fails on its way out, and that's no bug.
        beforeSend: (event) => (isReloadingAfterModuleError() ? null : event),
      })
      window.removeEventListener('error', keep)
      window.removeEventListener('unhandledrejection', keep)
      for (const error of early) captureException(error)
    })
  if (document.readyState === 'complete') window.setTimeout(start)
  else window.addEventListener('load', () => window.setTimeout(start), { once: true })
}

// On `window`, not `document`: Solid delegates `contextmenu` to `document`, and
// Kobalte's context menus ignore events that are already default-prevented.
window.addEventListener('contextmenu', (e) => e.preventDefault())

if (window.desktop) {
  document.documentElement.dataset.platform = window.desktop.platform;

  const origRequest = FileSystemHandle.prototype.requestPermission;
  FileSystemHandle.prototype.queryPermission = async function (desc) {
    try {
      return await origRequest.call(this, desc);
    } catch {
      return 'prompt';
    }
  };

  restoreLastRoute();
}

initAnalytics()
initGoogleAnalytics()
fadeInImages()

const root = document.getElementById('root')
// In another language the app draws once that language's words are here, so it never shows English first.
const words = loadStartingLanguage()
const draw = () => {
  // The page's text written in for search engines (prerender-pages.ts) makes way for the app.
  root!.replaceChildren()
  render(() => <App />, root!)
}
const mount = () => (words ? void words.then(draw) : draw())

// On the home page the HTML starts this script only once its copy of the hero has been counted
// as the page's first and largest content (heroStartHtml in lib/hero-shell.ts).
mount()
