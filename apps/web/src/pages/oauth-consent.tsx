/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from '@solidjs/router';
import { createEffect, createResource, createSignal, Show } from 'solid-js';

import { AGENTIC_EDITING } from '@/ai-editor/connector';
import { LogoMark } from '@/components/brand/logo';
import { useAuth } from '@/context/auth';
import { t } from '@/lib/i18n';
import { rememberReturn, takeReturn } from '@/lib/return-after-sign-in';
import { supabase } from '@/lib/supabase';

const BUTTON =
  'flex h-11 w-full cursor-pointer items-center justify-center rounded-[8px] px-4 text-[15px] font-medium tracking-[-0.1px] transition-colors disabled:cursor-default disabled:opacity-50 focus-ring';
const LIGHT = `${BUTTON} bg-white text-black hover:bg-white/85`;
const DARK = `${BUTTON} bg-white/[0.06] text-white hover:bg-white/[0.1]`;

export function rememberConsent(): void {
  rememberReturn(window.location.pathname + window.location.search);
}

export const takeConsent = takeReturn;

const SIGN_IN_PAGES = new Set(['/', '/login', '/signup', '/auth/confirm', '/auth/callback']);

export function ResumeConsent() {
  const auth = useAuth();
  const navigate = useNavigate();

  createEffect(() => {
    if (auth.isLoading() || !auth.isAuthenticated()) return;
    if (window.location.pathname === '/oauth/consent' || SIGN_IN_PAGES.has(window.location.pathname)) return;
    const path = takeConsent();
    if (path) navigate(path, { replace: true });
  });

  return null;
}

// Anyone can register an app under any name, so a name is shown as the app's own only when its
// return address is one of these. Exact hosts, over https.
const KNOWN_APPS: Record<string, string> = {
  'claude.ai': 'Claude',
  'claude.com': 'Claude',
  'chatgpt.com': 'ChatGPT',
  'vscode.dev': 'VS Code',
};

/** Only an app on this computer can receive an answer sent here. */
function onThisComputer(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/** `unknown` when the name is only the address, as the app's own name can't be trusted. */
type Details = { id: string; name: string; returnsTo: string; unknown: string | null };

async function loadDetails(id: string): Promise<Details | { redirect: string }> {
  if (!supabase) throw new Error(t("Sign-in isn't set up here."));
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error) throw new Error(error.message);
  if (!('authorization_id' in data)) return { redirect: data.redirect_url };
  const own = data.client.name || t('An app');
  let url: URL | null = null;
  try {
    url = new URL(data.redirect_uri);
  } catch {
    // Unknown below.
  }
  const returnsTo = url ? url.host || url.protocol : '';
  const known = url?.protocol === 'https:' ? KNOWN_APPS[url.hostname] : undefined;
  if (known) return { id: data.authorization_id, name: known, returnsTo, unknown: null };
  if (url && onThisComputer(url)) return { id: data.authorization_id, name: own, returnsTo, unknown: null };
  return { id: data.authorization_id, name: returnsTo || t('An app'), returnsTo, unknown: own };
}

export function OAuthConsentPage() {
  const auth = useAuth();
  const id = new URLSearchParams(window.location.search).get('authorization_id');
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const [details] = createResource(
    () => (id && !auth.isLoading() && auth.isAuthenticated() ? id : null),
    loadDetails,
  );

  createEffect(() => {
    const current = details();
    if (current && 'redirect' in current) window.location.replace(current.redirect);
  });

  const decide = async (allow: boolean) => {
    if (!supabase || !id) return;
    setBusy(true);
    setProblem(null);
    const { data, error } = allow
      ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) {
      setBusy(false);
      setProblem(error?.message ?? t('That didn\'t go through. Start again from Claude.'));
      return;
    }
    window.location.replace(data.redirect_url);
  };

  const asking = () => {
    const current = details();
    return current && 'id' in current ? current : null;
  };

  return (
    <div class="fixed inset-0 z-999 flex flex-col overflow-y-auto bg-(--site-page) px-6 text-white">
      <main class="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-24">
        <LogoMark class="size-7 text-white" />
        <Show
          when={id}
          fallback={<p class="mt-8 text-[15px] leading-6 text-white/55">{t('This link is missing its request. Start connecting again from Claude.')}</p>}
        >
          <Show
            when={asking()}
            fallback={
              <p class="mt-8 text-[15px] leading-6 text-white/55">
                {details.error ? (details.error as Error).message : t('Loading…')}
              </p>
            }
          >
            {(current) => (
              <>
                <h1 class="mt-8 text-[22px] font-[520] leading-[27px] tracking-[-0.35px] break-words text-white">
                  {t('Allow {client} to manage your posts?', { client: current().name })}
                </h1>
                <Show when={current().unknown}>
                  {(own) => (
                    <p class="mt-4 text-[15px] leading-6 break-words text-amber-300">
                      {t("plan.video doesn't know this app. It calls itself “{name}”, but any app can pick that name. Only allow it if you started connecting from {host} yourself.", { name: own(), host: current().returnsTo })}
                    </p>
                  )}
                </Show>
                <p class="mt-4 text-[15px] leading-6 text-white/55">
                  {t("It can see your connected accounts, media library and calendar, and your Analytics, such as YouTube views and top videos. It can schedule, change and delete posts, and publish them when you ask. It works through plan.video while it's open in your browser.")}
                  <Show when={AGENTIC_EDITING}> {t('It can also change the project you have open, one undo step at a time.')}</Show>
                </p>
                <p class="mt-4 text-[14px] leading-5 text-white/40">
                  {current().returnsTo
                    ? t("Signed in as {email}. You'll go back to {host}.", { email: auth.user()?.email, host: current().returnsTo })
                    : t('Signed in as {email}', { email: auth.user()?.email })}
                </p>
                <div class="mt-10 flex flex-col gap-2">
                  <button type="button" class={LIGHT} disabled={busy()} onClick={() => void decide(true)}>
                    {t('Allow')}
                  </button>
                  <button type="button" class={DARK} disabled={busy()} onClick={() => void decide(false)}>
                    {t('Deny')}
                  </button>
                </div>
                <Show when={problem()}>
                  <p class="mt-3 text-[13px] leading-5 text-red-300">{problem()}</p>
                </Show>
              </>
            )}
          </Show>
        </Show>
      </main>
    </div>
  );
}
