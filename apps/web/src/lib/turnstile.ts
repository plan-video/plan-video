/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

type Turnstile = {
  render(host: HTMLElement, options: Record<string, unknown>): string;
  remove(widget: string): void;
};

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const MOST_WAIT_MS = 120_000;

let loading: Promise<Turnstile> | undefined;

function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const found = (window as { turnstile?: Turnstile }).turnstile;
      if (found) resolve(found);
      else reject(new Error("Turnstile didn't start"));
    };
    script.onerror = () => reject(new Error("Turnstile didn't load"));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** Undefined without a site key, so a self-hosted copy signs in as usual. Each token works once, so every email or password try asks anew. */
export async function captchaToken(siteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY): Promise<string | undefined> {
  if (!siteKey) return undefined;
  const turnstile = await loadTurnstile();
  const host = document.createElement("div");
  host.className = "fixed bottom-4 left-1/2 z-[100] -translate-x-1/2";
  document.body.append(host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let widget: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error("Turnstile didn't finish"));
      timer = setTimeout(fail, MOST_WAIT_MS);
      widget = turnstile.render(host, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": fail,
        "expired-callback": fail,
        "timeout-callback": fail,
      });
    });
  } finally {
    clearTimeout(timer);
    if (widget) turnstile.remove(widget);
    host.remove();
  }
}
