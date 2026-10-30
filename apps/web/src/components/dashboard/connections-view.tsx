/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal } from "solid-js";
import { toast } from "somoto";

import { PLATFORMS, platformName } from "@/components/calendar/utils";
import { PlatformLogo } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import { useAuth } from "@/context/auth";
import { AvatarPhoto } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { rich, t } from "@/lib/i18n";
import { PAID_NETWORKS, accountsLimit } from "@/lib/plans";
import { fillMissingAvatars } from "@/lib/account-avatars";
import { finishPendingConnection } from "@/lib/connect-return";
import { askForAccount } from "@/lib/guest";
import { signInToBluesky } from "@/lib/bluesky";
import { beginBlueskySignIn, blueskySignInAvailable } from "@/lib/bluesky-oauth";
import {
  accountLabel,
  accountsFull,
  connectBluesky,
  connectSocial,
  connectionsFor,
  disconnectSocial,
  loadSocialConnections,
  loginReady,
  socialConnections,
} from "@/lib/social-connections";
import { linkedinAuthorizeUrl, linkedinNeedsRenewal, rememberLinkedInState } from "@/lib/linkedin";
import { META_NAMES, isMetaNetwork, metaAuthorizeUrl, rememberMetaState, type MetaNetwork } from "@/lib/meta";
import { forgetLogin } from "@/lib/publishing";
import { rememberXState, xAuthorizeUrl } from "@/lib/x";
import { rememberTikTokState, tiktokAuthorizeUrl } from "@/lib/tiktok";
import { rememberYouTubeState, youtubeAuthorizeUrl } from "@/lib/youtube";
import { activeScope, activeShared } from "@/lib/workspaces";

import { AccountGroupsSection } from "./account-groups";
import { ClientLinkSection } from "./client-link";
import { DashboardGroupLabel } from "./page-header";
import {
  DashboardDividedStack,
  DashboardFormModal,
  DashboardScrollView,
  DashboardSurfaceCard,
} from "./shared";

/** Past this many accounts the list gets a filter box. */
const FILTER_FROM = 8;

type ConnectedAccount = ReturnType<typeof connectionsFor>[number];

/** A platform's accounts as wrapping chips, in a box that scrolls once it fills. Without `onRemove`, they can't be removed here. */
function AccountList(props: { accounts: ConnectedAccount[]; onRemove?(accountId: string): void }) {
  const [query, setQuery] = createSignal("");

  const shown = () => {
    const needle = query().trim().replace(/^@/, "").toLowerCase();
    return needle ? props.accounts.filter((account) => account.handle.toLowerCase().includes(needle)) : props.accounts;
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={props.accounts.length > FILTER_FROM}>
        <TextField>
          <TextFieldInput
            uiSize="compact"
            value={query()}
            placeholder={t("{count, plural, one {Filter # account} other {Filter # accounts}}", { count: props.accounts.length })}
            aria-label={t("Filter accounts")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </TextField>
      </Show>
      <ul class="flex max-h-[8.5rem] flex-wrap content-start gap-1.5 overflow-y-auto">
        <For each={shown()} fallback={<li class="text-xs leading-7 text-muted-foreground">{t("No accounts match")}</li>}>
          {(account) => (
            <li class="group/chip flex h-7 max-w-full items-center gap-1.5 rounded-full border border-(--border-input) bg-accent/40 pr-0.5 pl-1">
              <AvatarPhoto
                url={account.avatarUrl || null}
                class="size-5 shrink-0 rounded-full object-cover"
                fallback={
                  <span class="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xxs font-medium text-foreground uppercase">
                    {account.handle.charAt(0)}
                  </span>
                }
              />
              <span class={cx("min-w-0 truncate text-xs text-foreground", !props.onRemove && "pr-2")}>{accountLabel(account)}</span>
              <Show when={props.onRemove}>
                {(remove) => (
                  <button
                    type="button"
                    aria-label={t("Remove {handle}", { handle: accountLabel(account) })}
                    class="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground/60 press group-hover/chip:text-muted-foreground hover:bg-secondary hover:text-foreground! focus-ring"
                    onClick={() => remove()(account.id)}
                  >
                    <Icon name="close-remove" class="size-3.5" />
                  </button>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export function DashboardConnectionsView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  /** A network the Free plan can't connect, for someone on Free. A shared workspace is on its owner's plan, which has a team, so it's paid. */
  const locked = (id: string) => PAID_NETWORKS.has(id) && !auth.isPro() && !activeScope();
  /** In a workspace someone shared, only its admins connect and remove accounts. */
  const canManage = () => activeShared()?.role !== "member";
  const [platform, setPlatform] = createSignal<string | null>(null);
  const [handle, setHandle] = createSignal("");
  /** Bluesky's app password, held only until the sign-in finishes. */
  const [appPassword, setAppPassword] = createSignal("");
  const [signingIn, setSigningIn] = createSignal(false);
  /** Bluesky with an app password instead of its sign-in, or always where the sign-in can't run. */
  const [withAppPassword, setWithAppPassword] = createSignal(!blueskySignInAvailable());

  const beginTikTok = async () => {
    const url = await tiktokAuthorizeUrl(rememberTikTokState());
    window.location.assign(url);
  };

  const beginYouTube = async () => {
    const url = await youtubeAuthorizeUrl(rememberYouTubeState());
    window.location.assign(url);
  };

  const beginLinkedIn = async () => {
    const url = await linkedinAuthorizeUrl(rememberLinkedInState());
    window.location.assign(url);
  };

  const beginX = async () => {
    const url = await xAuthorizeUrl(rememberXState());
    window.location.assign(url);
  };

  const beginMeta = async (network: MetaNetwork) => {
    const url = await metaAuthorizeUrl(network, rememberMetaState(network));
    window.location.assign(url);
  };

  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
  });

  createEffect(() => {
    const id = auth.user()?.id;
    if (id) fillMissingAvatars(id, socialConnections());
  });

  // A network's login that just came back to this tab is finished here.
  createEffect(() => {
    const id = auth.user()?.id;
    if (id) void finishPendingConnection(id);
  });

  const userId = () => auth.user()?.id;

  /**
   * Every social account the plan connects is in use: says so, with the way to
   * more, before a network's sign-in is started for an account that can't be kept.
   */
  const refuseWhenFull = () => {
    const id = userId();
    // A shared workspace's accounts count against its owner's plan, which the server checks.
    if (!id || activeScope() || !accountsFull(id)) return false;
    toast.error(t("All your social accounts are in use"), {
      description: t("Your plan connects {count} social accounts. Disconnect one, or get more to connect another.", { count: accountsLimit()! }),
      action: { label: auth.accessLevel() >= 4 ? t("Add accounts") : t("Upgrade"), onClick: () => setParams({ dashboard: "billing" }, { replace: true }) },
    });
    return true;
  };
  const open = () => PLATFORMS.find((item) => item.id === platform());

  const close = () => {
    setPlatform(null);
    setHandle("");
    setAppPassword("");
    setWithAppPassword(!blueskySignInAvailable());
  };

  const signInBluesky = async (id: string) => {
    if (signingIn()) return;
    setSigningIn(true);
    try {
      const account = await signInToBluesky(handle(), appPassword());
      const problem = connectBluesky(id, account);
      if (problem) throw new Error(t(problem));
      toast.success(t("Connected {handle}", { handle: `@${account.handle}` }));
      close();
    } catch (error) {
      toast.error(t("Couldn't connect Bluesky"), { description: error instanceof Error ? error.message : t("Try again in a moment.") });
    } finally {
      setSigningIn(false);
    }
  };

  const save = () => {
    const id = userId();
    const current = platform();
    if (!id || !current || locked(current)) return;
    if (current === "bluesky") {
      if (withAppPassword()) void signInBluesky(id);
      else {
        setSigningIn(true);
        void beginBlueskySignIn(handle().trim()).catch((error: unknown) => {
          setSigningIn(false);
          toast.error(t("Couldn't start Bluesky sign-in"), { description: error instanceof Error ? error.message : t("Try again in a moment.") });
        });
      }
      return;
    }
    const problem = connectSocial(id, current, handle());
    if (problem) {
      toast.error(t(problem));
      return;
    }
    close();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardScrollView>
        <section class="flex flex-col gap-2">
          <div class="flex flex-col gap-1 px-1">
            <DashboardGroupLabel>{t("Networks")}</DashboardGroupLabel>
            {/* In someone else's workspace, say who can change its accounts. */}
            <Show when={!canManage()}>
              <p class="text-xs text-muted-foreground">
                {t("The accounts {workspace}'s posts go out from. Only its owner and admins can connect or remove them.", { workspace: activeShared()!.name })}
              </p>
            </Show>
          </div>
          <DashboardSurfaceCard class="px-4 py-1">
          <DashboardDividedStack spacing="loose">
            <For each={PLATFORMS}>
              {(item) => {
                const accounts = () => connectionsFor(item.id);
                /** LinkedIn logins run out after 60 days and can't be renewed in the background. */
                const renew = () => accounts().some((account) => account.linkedin && linkedinNeedsRenewal(account.linkedin));
                /**
                 * An older "Sign in with Bluesky" stays in the browser that made it, and an Instagram, Facebook
                 * or Threads account added by name before it could sign in has no login, so posts can't go out from the server.
                 * The demo's sample accounts have no logins anywhere.
                 */
                const moved = () =>
                  accounts().some(
                    (account) => (account.bluesky?.oauth && !account.bluesky.server) || (!auth.isGuest() && isMetaNetwork(account.platform) && !account[account.platform]),
                  );
                return (
                  <div class="flex flex-col gap-2 py-3">
                    <div class="flex items-center gap-3">
                      <PlatformLogo id={item.id} class="size-8 rounded-md" />
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p class="truncate text-xs leading-4 text-foreground">{item.name}</p>
                        <p class="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                          <Show when={accounts().length > 0} fallback={locked(item.id) ? t("Paid plans only") : t("Not connected")}>
                            <Show
                              when={renew() || moved()}
                              fallback={
                                <>
                                  <span class="size-1.5 rounded-full bg-meter-green" />
                                  {t("{count, plural, one {# account} other {# accounts}}", { count: accounts().length })}
                                </>
                              }
                            >
                              <span class="size-1.5 rounded-full bg-meter-yellow" />
                              {moved() ? t("Sign in again to post on schedule") : t("Login runs out soon")}
                            </Show>
                          </Show>
                        </p>
                      </div>
                      <Show when={canManage()}>
                      <Show
                        when={!locked(item.id)}
                        fallback={
                          <Button
                            class="gap-0 pl-0 pr-2"
                            onClick={() => (auth.isGuest() ? askForAccount({ reason: "account" }) : setParams({ dashboard: "billing" }, { replace: true }))}
                          >
                            <span class="grid h-7 w-6 place-items-center overflow-clip">
                              <Icon name="upgrade" class="size-6" />
                            </span>
                            {t("Upgrade")}
                          </Button>
                        }
                      >
                        <Button
                          variant="secondary"
                          onClick={() => {
                            // Connecting needs an account to keep the login: a guest is asked to make one first.
                            if (auth.isGuest()) return askForAccount({ reason: "connect", platform: item.id });
                            // Signing in again to an account already here doesn't take another.
                            if (!renew() && !moved() && refuseWhenFull()) return;
                            if (item.id === "tiktok") {
                              void beginTikTok().catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't start {network} login.", { network: "TikTok" }));
                              });
                              return;
                            }
                            if (item.id === "youtube") {
                              void beginYouTube().catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't start {network} login.", { network: "YouTube" }));
                              });
                              return;
                            }
                            if (item.id === "linkedin") {
                              void beginLinkedIn().catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't start {network} login.", { network: "LinkedIn" }));
                              });
                              return;
                            }
                            if (item.id === "x") {
                              void beginX().catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't start {network} login.", { network: "X" }));
                              });
                              return;
                            }
                            const network = item.id;
                            if (isMetaNetwork(network)) {
                              void beginMeta(network).catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't start {network} login.", { network: META_NAMES[network] }));
                              });
                              return;
                            }
                            setHandle("");
                            setPlatform(item.id);
                          }}
                        >
                          {renew() || moved() ? t("Reconnect") : accounts().length ? t("Add account") : t("Connect")}
                        </Button>
                      </Show>
                      </Show>
                    </div>
                    <Show when={accounts().length > 0}>
                      <div class="pl-11">
                        <AccountList
                          accounts={accounts()}
                          onRemove={!canManage() ? undefined : (accountId) => {
                            const id = auth.ownerId();
                            if (!id) return;
                            const removed = accounts().find((account) => account.id === accountId);
                            // The workspace it's removed from, should another open before the server hears of it.
                            const team = activeScope();
                            disconnectSocial(id, accountId);
                            // The demo's sample accounts have no logins anywhere.
                            if (auth.isGuest()) return;
                            // The server ends plan.video's access at the network and drops the login it kept.
                            const network = removed ? platformName(removed.platform) : t("the network");
                            // After any login still on its way there, so the server doesn't keep it afterwards.
                            void loginReady(accountId)
                              .catch(() => undefined)
                              .then(() => forgetLogin(accountId, team))
                              .then((revoked) => {
                                if (revoked) return;
                                // Meta has no way for an app to end its own access to one account: the login is deleted, and the rest is the person's to do.
                                if (removed && isMetaNetwork(removed.platform)) {
                                  toast(t("Disconnected {network}", { network }), {
                                    description: t("plan.video deleted its login. To remove plan.video from {network} too, remove it from the apps connected in {network}'s settings.", { network }),
                                  });
                                  return;
                                }
                                toast.error(t("Couldn't confirm that plan.video's access ended at {network}. Remove it in {network}'s settings.", { network }));
                              })
                              .catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : t("Couldn't end plan.video's access at {network}.", { network }));
                              });
                          }}
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </DashboardDividedStack>
          </DashboardSurfaceCard>
        </section>
        {/* Only those who connect accounts here can send a client the way to. */}
        <Show when={canManage() && !auth.isGuest()}>
          <ClientLinkSection />
        </Show>
        <AccountGroupsSection />
      </DashboardScrollView>

      <DashboardFormModal
        open={platform() !== null}
        title={open() ? t("Add {network} account", { network: open()!.name }) : t("Connect")}
        onClose={close}
        footer={
          <Button
            disabled={
              signingIn() ||
              (platform() === "bluesky" ? withAppPassword() && (!handle().trim() || !appPassword().trim()) : !handle().trim())
            }
            onClick={save}
          >
            {signingIn() ? t("Connecting…") : platform() === "bluesky" && !withAppPassword() ? t("Sign in with Bluesky") : t("Connect")}
          </Button>
        }
      >
        <div class="flex flex-col gap-3 px-2">
          <Show
            when={platform() === "bluesky"}
            fallback={
              <p class="text-xs text-muted-foreground">
                {t("A post that includes {network} goes out from one of these accounts.", { network: open()?.name ?? t("this network") })}
              </p>
            }
          >
            <Show
              when={withAppPassword()}
              fallback={
                <p class="text-xs text-muted-foreground">
                  {t(
                    "You'll approve plan.video on Bluesky and come back here. Enter your handle if your account isn't on bsky.social, or leave it empty.",
                  )}
                </p>
              }
            >
              <p class="text-xs text-muted-foreground">
                {rich(
                  "Sign in with an app password, not your Bluesky password. Make one in <link>Bluesky's settings</link>. plan.video keeps the login Bluesky gives back, not the password.",
                  {
                    link: (text) => (
                      <a class="text-foreground underline" href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">
                        {text}
                      </a>
                    ),
                  },
                )}
              </p>
            </Show>
          </Show>
          <TextField>
            <TextFieldLabel uiSize="compact" class="text-muted-foreground">
              {platform() === "bluesky" ? (withAppPassword() ? t("Handle") : t("Handle (optional)")) : t("Account name")}
            </TextFieldLabel>
            <TextFieldInput
              uiSize="compact"
              value={handle()}
              placeholder={platform() === "bluesky" ? "yourname.bsky.social" : "yourname"}
              onInput={(event) => setHandle(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") save();
              }}
            />
          </TextField>
          <Show when={platform() === "bluesky" && withAppPassword()}>
            <TextField>
              <TextFieldLabel uiSize="compact" class="text-muted-foreground">
                {t("App password")}
              </TextFieldLabel>
              <TextFieldInput
                uiSize="compact"
                type="password"
                autocomplete="off"
                value={appPassword()}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                onInput={(event) => setAppPassword(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") save();
                }}
              />
            </TextField>
          </Show>
          <Show when={platform() === "bluesky" && blueskySignInAvailable()}>
            <button
              type="button"
              class="self-start text-xs text-muted-foreground underline hover:text-foreground focus-ring"
              onClick={() => setWithAppPassword((on) => !on)}
            >
              {withAppPassword() ? t("Sign in with Bluesky instead") : t("Use an app password instead")}
            </button>
          </Show>
        </div>
      </DashboardFormModal>
    </div>
  );
}
