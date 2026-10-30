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

// Sentry starts after load so the first paint doesn't wait; earlier errors are kept and sent then.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (import.meta.env.PROD && sentryDsn) {
  const early: unknown[] = []
  // An error event can come without an error (a ResizeObserver loop, another site's script); Sentry would file it as "null".
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
        // A deploy replaced the files and the tab is reloading: old chunks failing on the way out aren't bugs.
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
// Wait for the language's words so the app never shows English first.
const words = loadStartingLanguage()
const draw = () => {
  // Clears the prerendered text written for search engines (prerender-pages.ts).
  root!.replaceChildren()
  render(() => <App />, root!)
}
const mount = () => (words ? void words.then(draw) : draw())

// On the home page, HTML starts this script only after its hero copy counts as the largest content (heroStartHtml in lib/hero-shell.ts).
mount()
