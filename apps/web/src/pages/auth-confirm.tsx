/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { EmailOtpType, Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { DASHBOARD_PATH } from '@/hooks/use-project-route';
import { msg, t } from '@/lib/i18n';
import { takeReturn } from '@/lib/return-after-sign-in';
import { takeLinkAsked } from '@/lib/sign-in-link';
import { detachedClient, supabase } from '@/lib/supabase';

const OTP_TYPES = new Set<EmailOtpType>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

/** The link opens another account than this browser expects: whose, and who is signed in here now, if anyone. */
type Asking = { email: string; current: string | null; session: Session; client: NonNullable<ReturnType<typeof detachedClient>> };

export function AuthConfirmPage() {
  const navigate = useNavigate();
  // English, or Supabase's own words, shown through t().
  const [message, setMessage] = createSignal<string>(msg('Signing you in...'));
  const [asking, setAsking] = createSignal<Asking | null>(null);
  const [busy, setBusy] = createSignal(false);
  const params = new URLSearchParams(window.location.search);

  const goOn = () => {
    // An invite email's link opens the invite once its account is made.
    const invite = params.get('invite');
    navigate(invite && /^[0-9a-f-]{36}$/i.test(invite) ? `${DASHBOARD_PATH}?invite=${invite}` : (takeReturn() ?? DASHBOARD_PATH), { replace: true });
  };

  /** Signs this tab in with the link's session. */
  const signIn = async (session: Session) => {
    const { error } = await supabase!.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (error) {
      setMessage(error.message);
      return;
    }
    goOn();
  };

  onMount(async () => {
    const client = detachedClient();
    if (!supabase || !client) {
      setMessage(msg('Auth is not configured'));
      return;
    }

    const tokenHash = params.get('token_hash');
    const type = params.get('type') ?? 'email';
    if (!tokenHash || !OTP_TYPES.has(type as EmailOtpType)) {
      setMessage(msg('This sign-in link is missing a code.'));
      return;
    }

    // Checked on a client that keeps nothing, so this tab stays as it is until it's clear whose account this is.
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    if (!data.session || !data.user) {
      // Nothing to sign in with, such as the first half of an email change.
      goOn();
      return;
    }

    const email = data.user.email ?? '';
    const current = (await supabase.auth.getSession()).data.session?.user ?? null;
    const asked = takeLinkAsked(email);
    if (current?.id === data.user.id || (!current && asked)) {
      await signIn(data.session);
      return;
    }
    setAsking({ email, current: current ? (current.email ?? '') : null, session: data.session, client });
  });

  const accept = async () => {
    const link = asking();
    if (!link) return;
    setBusy(true);
    await signIn(link.session);
    setBusy(false);
  };

  const decline = async () => {
    const link = asking();
    if (!link) return;
    setBusy(true);
    // The link's session ends here, so it can't be used from this page later.
    await link.client.auth.signOut({ scope: 'local' }).catch(() => {});
    navigate(link.current ? DASHBOARD_PATH : '/', { replace: true });
  };

  return (
    <div class="grid h-screen place-items-center bg-background px-6">
      <Show when={asking()} fallback={<p class="text-sm text-muted-foreground">{t(message())}</p>}>
        {(link) => (
          <div class="flex w-full max-w-sm flex-col gap-4">
            <p class="text-sm break-words text-foreground">
              {link().current
                ? t("You're signed in as {current}. This link signs you in to {email} instead.", { current: link().current, email: link().email })
                : t('This link signs you in to {email}.', { email: link().email })}
            </p>
            <p class="text-sm text-muted-foreground">{t('Only go on if this is your own email. Someone may have sent you a link to their account.')}</p>
            <div class="flex gap-2">
              <Button disabled={busy()} onClick={() => void accept()}>
                {link().current ? t('Switch to {email}', { email: link().email }) : t('Continue')}
              </Button>
              <Button variant="secondary" disabled={busy()} onClick={() => void decline()}>
                {link().current ? t('Stay signed in') : t('Cancel')}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
