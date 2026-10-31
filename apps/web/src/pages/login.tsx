/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A, useLocation, useNavigate } from '@solidjs/router';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';

import { useAuth } from '@/context/auth';
import { TRY_PATH } from '@/hooks/use-project-route';
import { msg, rich, t } from '@/lib/i18n';
import { site } from '@/lib/site';
import { REPO_PUBLIC, REPO_URL } from '@/lib/site-links';
import { supabase } from '@/lib/supabase';
import { INVITE_ONLY, isEmail } from '@/lib/waitlist';

void site?.LoginPanel.preload();

/** Supabase refuses a second link to the same address within a minute. */
const RESEND_AFTER = 60;

const BUTTON =
  'press flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] px-4 text-[15px] font-medium tracking-[-0.15px] disabled:cursor-default disabled:opacity-50 focus-ring';
const LIGHT = `${BUTTON} bg-neutral-50 text-black hover:bg-white/80`;
const DARK = `${BUTTON} bg-white/[0.07] text-white hover:bg-white/[0.12]`;
const FIELD =
  'h-11 w-full rounded-[8px] bg-transparent px-4 text-[15px] text-white outline-none ring-1 ring-inset transition-shadow placeholder:text-white/35';
const ring = (error: boolean) => ({
  'ring-red-400/70': error,
  'ring-white/[0.1] hover:ring-white/[0.18] focus:ring-(--site-accent)': !error,
});
const TEXT_BUTTON =
  'h-9 cursor-pointer text-[14px] text-white/50 transition-colors hover:text-white';

type Inbox = { label: string; href: string };

const INBOXES: { domains: readonly string[]; label: string; href: (email: string) => string }[] = [
  {
    domains: ['gmail.com', 'googlemail.com'],
    label: msg('Open Gmail'),
    href: (email) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox`,
  },
  {
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    label: msg('Open Outlook'),
    href: () => 'https://outlook.live.com/mail/0/',
  },
  {
    domains: ['yahoo.com', 'ymail.com', 'rocketmail.com'],
    label: msg('Open Yahoo Mail'),
    href: () => 'https://mail.yahoo.com/',
  },
  {
    domains: ['icloud.com', 'me.com', 'mac.com'],
    label: msg('Open iCloud Mail'),
    href: () => 'https://www.icloud.com/mail',
  },
  {
    domains: ['proton.me', 'protonmail.com', 'pm.me'],
    label: msg('Open Proton Mail'),
    href: () => 'https://mail.proton.me/u/0/inbox',
  },
  {
    domains: ['fastmail.com'],
    label: msg('Open Fastmail'),
    href: () => 'https://app.fastmail.com/',
  },
  {
    domains: ['hey.com'],
    label: msg('Open HEY'),
    href: () => 'https://app.hey.com/',
  },
  {
    domains: ['aol.com'],
    label: msg('Open AOL Mail'),
    href: () => 'https://mail.aol.com/',
  },
];

const COMMON_INBOXES = INBOXES.slice(0, 4);

function inboxesFor(email: string): Inbox[] {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  const match = INBOXES.find((inbox) => inbox.domains.some((name) => domain === name || domain.endsWith(`.${name}`)));
  if (match) return [{ label: match.label, href: match.href(email) }];
  // Don't pin Gmail to an address that isn't a Google account.
  return COMMON_INBOXES.map((inbox) => ({
    label: inbox.label,
    href: inbox.label === 'Open Gmail' ? 'https://mail.google.com/mail/u/0/#inbox' : inbox.href(email),
  }));
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}

function Heading(props: { title: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col text-center text-balance">
      <h1 class="text-[22px] font-[520] leading-[27px] tracking-[-0.35px] text-white">{props.title}</h1>
      <p class="mt-2 text-[15px] leading-[22px] text-white/50">{props.children}</p>
    </div>
  );
}

const LINE_LINK = 'text-white transition-colors hover:text-white/75';

function Or() {
  return (
    <div class="my-6 flex items-center gap-3 text-[13px] leading-5 text-white/35">
      <span class="h-px flex-1 bg-white/[0.07]" />
      {t('or')}
      <span class="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function Sent(props: {
  email: string;
  onResend: () => Promise<string | null>;
  onBack: () => void;
  onCode?: (token: string) => Promise<string | null>;
}) {
  const [sentAt, setSentAt] = createSignal(Date.now());
  const [now, setNow] = createSignal(Date.now());
  const [resending, setResending] = createSignal(false);
  const [code, setCode] = createSignal('');
  const [checking, setChecking] = createSignal(false);
  const [codeError, setCodeError] = createSignal<string | null>(null);
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const links = inboxesFor(props.email);
  const wait = () => Math.max(0, RESEND_AFTER - Math.floor((now() - sentAt()) / 1000));

  const resend = async () => {
    setResending(true);
    const problem = await props.onResend();
    setResending(false);
    if (problem) return;
    setSentAt(Date.now());
    setNow(Date.now());
  };

  const submitCode = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!props.onCode) return;
    setCodeError(null);
    setChecking(true);
    const problem = await props.onCode(code());
    setChecking(false);
    if (problem) setCodeError(problem);
  };

  return (
    <div class="flex flex-col" role="status">
      <Heading title={t('Check your email')}>
        {rich('Open the link we sent to {email} on this device.', { email: <span class="break-words text-white">{props.email}</span> })}
      </Heading>
      <div class="mt-8 flex flex-col gap-2">
        <For each={links}>
          {(inbox) => (
            <a
              href={inbox.href}
              target="_blank"
              rel="noopener noreferrer"
              class={links.length === 1 ? LIGHT : DARK}
            >
              {t(inbox.label)}
            </a>
          )}
        </For>
      </div>
      <Show when={props.onCode}>
        <form class="mt-6 flex flex-col gap-2" onSubmit={(event) => void submitCode(event)}>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            aria-label={t('Code from the email')}
            placeholder={t('Code from the email')}
            aria-invalid={!!codeError()}
            class={FIELD}
            classList={ring(!!codeError())}
            value={code()}
            onInput={(event) => {
              setCode(event.currentTarget.value);
              setCodeError(null);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
          />
          <Show when={codeError()}>
            <p class="text-[13px] leading-5 text-red-300">{codeError()}</p>
          </Show>
          <button type="submit" class={LIGHT} disabled={checking() || !code().trim()}>
            {checking() ? t('Signing in…') : t('Sign in with code')}
          </button>
        </form>
      </Show>
      <div class="mt-6 flex flex-col gap-2">
        <button type="button" class={DARK} disabled={resending() || wait() > 0} onClick={() => void resend()}>
          {resending() ? t('Sending…') : wait() > 0 ? t('Send again in {seconds}s', { seconds: wait() }) : t('Send the link again')}
        </button>
        <button
          type="button"
          class={TEXT_BUTTON}
          onClick={() => props.onBack()}
        >
          {t('Use a different email')}
        </button>
      </div>
    </div>
  );
}

const SIGN_IN_DOCS = `${REPO_URL}/blob/main/apps/web/src/content/docs/local-development.md#sign-in`;

/** Without a Supabase project (lib/supabase.ts) there are no accounts to sign in to. */
function SignInOff() {
  return (
    <div class="flex flex-col">
      <Heading title={t("Sign-in isn't set up yet")}>
        {t('This copy of plan.video has no accounts yet. You can still try the dashboard and the editor with sample posts.')}
      </Heading>
      <A href={TRY_PATH} class={`${LIGHT} mt-10`}>
        {t('Try the demo')}
      </A>
      <Show when={REPO_PUBLIC || import.meta.env.DEV}>
        <a href={SIGN_IN_DOCS} target="_blank" rel="noopener noreferrer" class={`${TEXT_BUTTON} mt-2 inline-flex items-center justify-center`}>
          {t('How to set up sign-in')}
        </a>
      </Show>
    </div>
  );
}

/** Signing in creates the account either way; `signup` only changes the words and the link. */
export function LoginPage(props: { mode?: 'login' | 'signup' }) {
  const auth = useAuth();
  const signup = () => props.mode === 'signup';
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const reviewer = () => location.pathname === '/login/reviewer';
  const [error, setError] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const [sentTo, setSentTo] = createSignal<string | null>(null);

  const sendLink = async (address: string) => {
    const result = await auth.signInWithOtp(address);
    return result.error;
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = email().trim();
    if (!isEmail(value)) {
      setError(t("That doesn't look like an email address."));
      return;
    }
    setError(null);
    setSending(true);
    const problem = await sendLink(value);
    setSending(false);
    if (problem) setError(problem);
    else setSentTo(value);
  };

  const submitPassword = async (event: SubmitEvent) => {
    event.preventDefault();
    const address = email().trim();
    if (!isEmail(address)) {
      setError(t("That doesn't look like an email address."));
      return;
    }
    if (!password()) {
      setError(t('Enter the password.'));
      return;
    }
    setError(null);
    setSending(true);
    const result = await auth.signInWithPassword(address, password());
    setSending(false);
    if (result.error) setError(result.error);
  };

  const leaveReviewer = () => {
    setPassword('');
    setError(null);
    setSending(false);
    navigate('/login');
  };

  return (
    <div class="fixed inset-0 z-999 flex bg-(--site-page) text-white">
      <div class="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6">
        {/* A build without the site (lib/site.ts) has nowhere to go back to. */}
        <Show when={site}>
          <A
            href="/"
            class="press absolute top-6 left-6 inline-flex h-9 items-center gap-1 rounded-[8px] bg-white/[0.07] pr-3.5 pl-2.5 text-[15px] text-white hover:bg-white/[0.12] focus-ring"
          >
            <ChevronLeft class="size-4" />
            {t('Back')}
          </A>
        </Show>

        <main class="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-24">
          <Show when={supabase} fallback={<SignInOff />}>
            <Show
              when={sentTo()}
              fallback={
                <div class="flex flex-col">
                  <Heading
                    title={INVITE_ONLY && !reviewer() ? t('Sign in') : reviewer() ? t('Welcome to plan.video') : signup() ? t('Create your plan.video account') : t('Welcome back to plan.video')}
                  >
                    <Show
                      when={!reviewer()}
                      fallback={t('Sign in with the account you were given.')}
                    >
                      <Show
                        when={INVITE_ONLY}
                        fallback={
                          <>
                            {signup() ? t('Already have an account?') : t("Don't have an account?")}{' '}
                            <A href={signup() ? '/login' : '/signup'} class={LINE_LINK}>
                              {signup() ? t('Log in') : t('Sign up')}
                            </A>
                          </>
                        }
                      >
                        {t('Invited emails only. No invite yet?')}{' '}
                        <A href="/#waitlist" class={`whitespace-nowrap ${LINE_LINK}`}>
                          {t('Join the waitlist')}
                        </A>
                      </Show>
                    </Show>
                  </Heading>

                  <Show when={!reviewer() && !INVITE_ONLY}>
                    <button type="button" class={`${DARK} mt-10`} onClick={() => void auth.signInWithOAuth('google')}>
                      <GoogleMark />
                      {t('Continue with Google')}
                    </button>

                    <Or />
                  </Show>

                  <Show
                    when={reviewer()}
                    fallback={
                      <form class={`flex flex-col ${INVITE_ONLY ? "mt-10" : ""}`} onSubmit={(event) => void submit(event)} novalidate>
                        <label for="login-email" class="sr-only">
                          {t('Email')}
                        </label>
                        <input
                          id="login-email"
                          type="email"
                          autocomplete="email"
                          placeholder={t('Your email address')}
                          aria-invalid={!!error()}
                          aria-describedby={error() ? 'login-email-error' : undefined}
                          class={FIELD}
                          classList={ring(!!error())}
                          value={email()}
                          onInput={(event) => {
                            setEmail(event.currentTarget.value);
                            setError(null);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          onKeyUp={(event) => event.stopPropagation()}
                        />
                        <Show when={error()}>
                          <p id="login-email-error" class="mt-1.5 text-[13px] leading-5 text-red-300">
                            {error()}
                          </p>
                        </Show>
                        <button type="submit" class={`${LIGHT} mt-2`} disabled={sending()}>
                          {sending() ? t('Sending link…') : t('Send sign-in link')}
                        </button>
                      </form>
                    }
                  >
                    <form class="mt-10 flex flex-col gap-2" onSubmit={(event) => void submitPassword(event)} novalidate>
                      <input
                        id="reviewer-email"
                        type="email"
                        autocomplete="username"
                        aria-label={t('Email')}
                        placeholder="reviewer@plan.video"
                        aria-invalid={!!error()}
                        aria-describedby={error() ? 'reviewer-error' : undefined}
                        class={FIELD}
                        classList={ring(!!error())}
                        value={email()}
                        onInput={(event) => {
                          setEmail(event.currentTarget.value);
                          setError(null);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        onKeyUp={(event) => event.stopPropagation()}
                      />
                      <input
                        id="reviewer-password"
                        type="password"
                        autocomplete="current-password"
                        aria-label={t('Password')}
                        placeholder={t('Password')}
                        class={FIELD}
                        classList={ring(false)}
                        value={password()}
                        onInput={(event) => {
                          setPassword(event.currentTarget.value);
                          setError(null);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        onKeyUp={(event) => event.stopPropagation()}
                      />
                      <Show when={error()}>
                        <p id="reviewer-error" class="text-[13px] leading-5 text-red-300">
                          {error()}
                        </p>
                      </Show>
                      <button type="submit" class={LIGHT} disabled={sending()}>
                        {sending() ? t('Signing in…') : t('Sign in')}
                      </button>
                      <button type="button" class={TEXT_BUTTON} onClick={leaveReviewer}>
                        {t('Use an email link instead')}
                      </button>
                    </form>
                  </Show>

                </div>
              }
            >
              {(address) => (
                <Sent
                  email={address()}
                  onResend={() => sendLink(address())}
                  onBack={() => setSentTo(null)}
                  onCode={
                    import.meta.env.DEV
                      ? async (token) => (await auth.signInWithEmailCode(address(), token)).error
                      : undefined
                  }
                />
              )}
            </Show>
          </Show>
        </main>

        {/* plan.video's terms and privacy policy are the site's pages (lib/site.ts). */}
        <Show when={site}>
          <p class="pb-8 text-center text-[13px] leading-5 text-balance text-white/35">
            {rich('By continuing you agree to the <terms>Terms of Service</terms> & <privacy>Privacy Policy</privacy>', {
              terms: (text) => (
                <A href="/terms" class="whitespace-nowrap text-white/60 transition-colors hover:text-white">
                  {text}
                </A>
              ),
              privacy: (text) => (
                <A href="/privacy" class="whitespace-nowrap text-white/60 transition-colors hover:text-white">
                  {text}
                </A>
              ),
            })}
          </p>
        </Show>
      </div>

      {site && <site.LoginPanel />}
    </div>
  );
}
