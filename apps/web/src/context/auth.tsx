/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';
import { toast } from 'somoto';
import type { Session, User } from '@supabase/supabase-js';
import { FREE_CREDITS_QUOTA, type UserData } from '@plan.video/api-contract';

import { supabase } from '@/lib/supabase';
import { rememberLinkAsked } from '@/lib/sign-in-link';
import { guestId, noteSignedIn } from '@/lib/guest';
import { deleteAccountEverywhere } from '@/lib/delete-account';
import { checkAccess, INVITE_ONLY, isInvited } from '@/lib/waitlist';
import { identify, resetIdentity, track } from '@/lib/analytics';
import { t } from '@/lib/i18n';
import { FREE_SCHEDULED_PER_ACCOUNT, accountLimit, setAccountsLimit, setScheduledLimit } from '@/lib/plans';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from '@/utils';

type OAuthProvider = 'google' | 'apple' | 'github';

type AuthContextValue = {
  session: Accessor<Session | null>;
  user: Accessor<User | null>;
  isAuthenticated: Accessor<boolean>;
  /** Work is kept in this browser (see lib/guest.ts). */
  isGuest: Accessor<boolean>;
  /** The signed-in person's, else the guest's. */
  ownerId: Accessor<string | undefined>;
  isLoading: Accessor<boolean>;
  /** Let in from the waitlist. Always true once the app is open to everyone. */
  hasAccess: Accessor<boolean>;
  isCheckingAccess: Accessor<boolean>;
  accessLevel: Accessor<number>;
  /** Bought past the ones Agency includes. */
  extraAccounts: Accessor<number>;
  /** Until then the plan and credits hold their defaults. */
  hasUserData: Accessor<boolean>;
  remainingCredits: Accessor<number>;
  creditLimit: Accessor<number>;
  nextCreditReset: Accessor<Date | null>;
  isPro: Accessor<boolean>;
  hasStripeCustomer: Accessor<boolean>;
  productUpdatesEnabled: Accessor<boolean>;
  marketingAnnouncementsEnabled: Accessor<boolean>;
  postAlertsEnabled: Accessor<boolean>;
  setEmailPreference: (column: EmailPreferenceColumn, enabled: boolean) => Promise<{ error: string | null }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  /** Comes back to the account settings. */
  linkOAuth: (provider: OAuthProvider) => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signInWithEmailCode: (email: string, token: string) => Promise<{ error: string | null }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>();

export type EmailPreferenceColumn = 'product_updates_enabled' | 'marketing_announcements_enabled' | 'post_alerts_enabled';

type UserDataSubset = Pick<
  UserData,
  | 'lifetime_credit_balance'
  | 'monthly_credit_balance'
  | 'monthly_credit_quota'
  | 'access_level'
  | 'stripe_customer_id'
  | 'last_credit_reset_at'
  | 'product_updates_enabled'
  | 'marketing_announcements_enabled'
>;

const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin;
const ELECTRON_AUTH_REDIRECT = `${APP_URL}/auth/electron-callback.html`;
const USER_DATA_QUERY = "lifetime_credit_balance,monthly_credit_balance,monthly_credit_quota,access_level,stripe_customer_id,last_credit_reset_at,product_updates_enabled,marketing_announcements_enabled" as const;

/** So the return says how it went. */
const LINKING_KEY = 'plan.video.linking';

function readOAuthReturn(): { error: string | null; cleanUrl: string } | null {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const error = query.get('error_description') ?? hash.get('error_description');
  if (!query.has('code') && !error) return null;

  for (const key of ['code', 'error', 'error_code', 'error_description']) query.delete(key);
  const rest = query.toString();
  const keepHash = hash.has('error_description') ? '' : window.location.hash;
  return { error, cleanUrl: `${window.location.pathname}${rest ? `?${rest}` : ''}${keepHash}` };
}

export function AuthProvider(props: { children: JSX.Element }) {
  const [session, setSession] = createSignal<Session | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  onMount(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    // Supabase finishes a Google sign-in returning to / on load; if it ends without a session, say so
    // and drop the spent parameters from the address.
    const returned = !window.desktop && window.location.pathname === '/' ? readOAuthReturn() : null;
    let linking: string | null = null;
    try {
      linking = sessionStorage.getItem(LINKING_KEY);
      sessionStorage.removeItem(LINKING_KEY);
    } catch {
      // Storage blocked: the return is finished without a message.
    }
    const linked = !window.desktop && linking && window.location.pathname === '/dashboard' ? readOAuthReturn() : null;

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setIsLoading(false);

      if (linked) {
        const name = linking === 'google' ? 'Google' : linking!;
        if (linked.error) toast.error(t("Couldn't connect {name}", { name }), { description: linked.error });
        else {
          // The session the return made can predate the new sign-in method.
          await refreshSession();
          toast.success(t('{name} connected', { name }), { description: t('You can sign in with {name} from now on.', { name }) });
        }
        window.history.replaceState(window.history.state, '', linked.cleanUrl);
      }

      if (!returned) return;
      if (returned.error) {
        toast.error(t("Couldn't sign you in"), { description: returned.error });
      } else if (!data.session) {
        toast.error(t("Sign-in didn't finish"), {
          description: t('Start it again from this page, in the same browser you began it in.'),
        });
      }
      window.history.replaceState(window.history.state, '', returned.cleanUrl);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession?.user) {
        const provider = newSession.user.app_metadata?.provider ?? 'unknown';
        identify(newSession.user.id, { provider });
        track('sign_in', { provider });
      } else if (event === 'SIGNED_OUT') {
        track('sign_out');
        resetIdentity();
      }
    });

    onCleanup(() => {
      subscription.unsubscribe();
    });
  });



  // Supabase sends a new session on every SIGNED_IN, refocusing the tab included, so key work on the id.
  const sessionUserId = createMemo(() => session()?.user.id);
  createRenderEffect(() => noteSignedIn(sessionUserId()));

  const [userData, { mutate: mutateUserData }] = createResource<UserDataSubset | null, string>(
    sessionUserId,
    async (userId) => {
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('user_data')
        .select(USER_DATA_QUERY)
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[auth] Failed to fetch user_data', error);
        return null;
      }

      return data as UserDataSubset;
    },
  );

  // Read apart from the rest, so the plan still loads before the column exists.
  const [extraAccounts, setExtraAccounts] = createSignal(0);
  createEffect(
    on([sessionUserId, () => userData.latest?.access_level], ([userId]) => {
      if (!userId || !supabase) return setExtraAccounts(0);
      void supabase
        .from('user_data')
        .select('extra_accounts')
        .eq('id', userId)
        .single()
        .then(({ data, error }) => {
          if (!error && sessionUserId() === userId) setExtraAccounts((data as { extra_accounts?: number } | null)?.extra_accounts ?? 0);
        });
    }),
  );

  // Read apart too, for the same reason.
  const [postAlerts, setPostAlerts] = createSignal(true);
  createEffect(
    on(sessionUserId, (userId) => {
      setPostAlerts(true);
      if (!userId || !supabase) return;
      void supabase
        .from('user_data')
        .select('post_alerts_enabled')
        .eq('id', userId)
        .single()
        .then(({ data, error }) => {
          if (!error && sessionUserId() === userId) setPostAlerts((data as { post_alerts_enabled?: boolean } | null)?.post_alerts_enabled ?? true);
        });
    }),
  );

  // A signal rather than a resource, so the check doesn't suspend the app.
  const [access, setAccess] = createSignal<boolean | undefined>();
  createEffect(
    on(
      sessionUserId,
      (userId) => {
        setAccess(undefined);
        if (!userId) return;
        let current = true;
        void checkAccess().then((ok) => current && setAccess(ok));
        onCleanup(() => {
          current = false;
        });
      },
    ),
  );

  onMount(() => {
    if (!window.desktop) return;
    // Must live in AuthProvider: ElectronProvider mounts only after sign-in, but the OAuth deep link arrives before.
    const handleAuthCallbackUrl = async (url: string | null) => {
      if (!supabase || !url) return;

      let code: string | null = null;
      try {
        const parsed = new URL(url);
        code = parsed.searchParams.get('code') ?? new URLSearchParams(parsed.hash.replace(/^#/, '')).get('code');
      } catch {
        return;
      }

      if (!code) return;

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        toast.error(error.message);
      }
    };

    void mainBridge
      .call(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, undefined)
      .then(handleAuthCallbackUrl);

    const unsubscribe = mainBridge.handle(MAIN_CHANNELS.AUTH_CALLBACK, ({ url }) => {
      handleAuthCallbackUrl(url);
    });

    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const userId = sessionUserId();
    if (!userId || !supabase) return;

    const client = supabase;
    const channel = client
      .channel(`user-data-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_data',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          mutateUserData(payload.new as UserDataSubset);
          const extra = (payload.new as { extra_accounts?: unknown }).extra_accounts;
          if (typeof extra === 'number') setExtraAccounts(extra);
          const alerts = (payload.new as { post_alerts_enabled?: unknown }).post_alerts_enabled;
          if (typeof alerts === 'boolean') setPostAlerts(alerts);
        },
      )
      .subscribe();

    onCleanup(() => client.removeChannel(channel));
  });

  const accessLevel = () => userData()?.access_level ?? 1;
  const lifetimeCreditBalance = () => userData()?.lifetime_credit_balance ?? 0;
  const monthlyCreditBalance = () => userData()?.monthly_credit_balance ?? 0;
  const monthlyCreditQuota = () => userData()?.monthly_credit_quota ?? 0;

  const signInWithOAuth = async (provider: OAuthProvider) => {
    if (!supabase) return;
    // The provider creates an account on first success, before the address is known, so while invite-only,
    // email is the only way in, and only for an invited address.
    if (INVITE_ONLY) {
      toast.error(t("Google sign-in opens once you're invited. Use the email on your invite."));
      return;
    }

    track('sign_in_attempt', { method: 'oauth', provider });

    if (window.desktop) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: ELECTRON_AUTH_REDIRECT,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      if (data.url) {
        await mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url: data.url });
      }
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      toast.error(error.message);
    }
  };

  const linkOAuth = async (provider: OAuthProvider) => {
    if (!supabase) return;

    if (window.desktop) {
      const { data, error } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: ELECTRON_AUTH_REDIRECT, skipBrowserRedirect: true },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data.url) await mainBridge.call(MAIN_CHANNELS.APP_OPEN_EXTERNAL, { url: data.url });
      return;
    }

    try {
      sessionStorage.setItem(LINKING_KEY, provider);
    } catch {
      // The connection still finishes, without a message on the way back.
    }
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard?dashboard=account` },
    });
    if (error) {
      try {
        sessionStorage.removeItem(LINKING_KEY);
      } catch {
        // Nothing was set.
      }
      toast.error(error.message);
    }
  };

  const signInWithOtp = async (email: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: 'Auth is not configured' };

    const invited = await isInvited(email);
    if (invited === false) return { error: t("That email isn't invited yet.") };
    if (invited === null) return { error: t("Couldn't check your invite. Try again in a moment.") };

    track('sign_in_attempt', { method: 'otp' });

    const emailRedirectTo = window.desktop ? ELECTRON_AUTH_REDIRECT : window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });

    if (error) {
      return { error: error.message };
    }

    rememberLinkAsked(email);
    return { error: null };
  };

  const signInWithEmailCode = async (email: string, token: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: 'Auth is not configured' };

    const code = token.replace(/\s/g, '');
    if (!code) return { error: t('Enter the code from the email.') };

    // A first sign-in is a signup confirmation, a later one a magic-link code. The wrong type does not use up the code.
    let message = t('That code did not work.');
    for (const type of ['email', 'signup'] as const) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type });
      if (!error) return { error: null };
      message = error.message;
    }

    return { error: message };
  };

  const signInWithPassword = async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: 'Auth is not configured' };

    track('sign_in_attempt', { method: 'password' });

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) return { error: error.message };

    return { error: null };
  };

  const signOut = async () => {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      toast.error(error.message);
    }
  };

  const deleteAccount = async (): Promise<{ error: string | null }> => {
    const userId = session()?.user.id;
    if (!supabase || !userId) {
      return { error: t('Not authenticated') };
    }

    try {
      await deleteAccountEverywhere(userId);
      track('account_deleted');

      // The account is gone, so only this browser's session is left to end.
      await supabase.auth.signOut({ scope: 'local' });
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Failed to delete account');
      return { error: message };
    }
  };

  const setEmailPreference = async (column: EmailPreferenceColumn, enabled: boolean): Promise<{ error: string | null }> => {
    const userId = session()?.user.id;
    if (!supabase || !userId) return { error: t('Not authenticated') };

    const { error } = await supabase.rpc('set_email_preference', { preference: column, enabled });
    if (error) return { error: error.message };
    if (column === 'post_alerts_enabled') {
      if (sessionUserId() === userId) setPostAlerts(enabled);
      return { error: null };
    }
    // Realtime brings the row too, but not every project has it on.
    const current = userData.latest;
    if (current && sessionUserId() === userId) mutateUserData({ ...current, [column]: enabled });
    return { error: null };
  };

  const refreshSession = async () => {
    if (!supabase) return;

    const { data: { user } } = await supabase.auth.getUser();
    const current = session();
    if (current && user) {
      setSession({ ...current, user });
    }
  };

  const isPro = () => accessLevel() > 1;
  // Until the plan is known, nobody is held to the Free plan's limit on scheduled posts.
  createEffect(() => {
    const data = userData.latest;
    setScheduledLimit(data && (data.access_level ?? 1) <= 1 ? FREE_SCHEDULED_PER_ACCOUNT : undefined);
  });
  // Nor, until then, to the plan's social accounts.
  createEffect(() => {
    const data = userData.latest;
    setAccountsLimit(data ? accountLimit(data.access_level ?? 1, extraAccounts()) : undefined);
  });
  const hasStripeCustomer = () => !!userData()?.stripe_customer_id;
  const productUpdatesEnabled = () => userData()?.product_updates_enabled ?? true;
  const marketingAnnouncementsEnabled = () => userData()?.marketing_announcements_enabled ?? true;
  const remainingCredits = () => monthlyCreditBalance() + lifetimeCreditBalance();
  const creditLimit = () => (isPro() ? monthlyCreditQuota() : FREE_CREDITS_QUOTA);
  const nextCreditReset = (): Date | null => {
    const last = userData()?.last_credit_reset_at;
    if (!last) return null;
    const next = new Date(last);
    next.setMonth(next.getMonth() + 1);
    return next;
  };

  const ctx: AuthContextValue = {
    session,
    isPro,
    hasStripeCustomer,
    user: () => session()?.user ?? null,
    isAuthenticated: () => !!session(),
    isGuest: () => !session() && !!guestId(),
    ownerId: () => session()?.user.id ?? guestId() ?? undefined,
    isLoading,
    hasAccess: () => access() === true,
    isCheckingAccess: () => !!session() && access() === undefined,
    accessLevel,
    extraAccounts,
    hasUserData: () => !!userData(),
    remainingCredits,
    creditLimit,
    nextCreditReset,
    productUpdatesEnabled,
    marketingAnnouncementsEnabled,
    postAlertsEnabled: postAlerts,
    setEmailPreference,
    signInWithOAuth,
    linkOAuth,
    signInWithOtp,
    signInWithEmailCode,
    signInWithPassword,
    signOut,
    deleteAccount,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={ctx}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  assert(ctx, 'useAuth must be used within AuthProvider');
  return ctx;
}
