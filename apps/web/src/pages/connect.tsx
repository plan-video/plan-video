/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A, useParams } from "@solidjs/router";
import { For, Match, Show, Switch, createRenderEffect, createResource, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { toast } from "somoto";

import { MARK_PATH } from "@/components/brand/logo";
import { PLATFORMS } from "@/components/calendar/utils";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon, type PlaneIconName } from "@/components/dashboard/plane-icons";
import { PlatformLogo } from "@/components/publish/controls";
import { AvatarPhoto } from "@/hooks/use-avatar";
import {
  ConnectLinkError,
  finishLinkSignIn,
  openConnectLink,
  startLinkSignIn,
  type LinkNetwork,
  type LinkedAccount,
  type OpenedLink,
} from "@/lib/connect-link";
import { loginRefusal, takeHandOff } from "@/lib/connect-return";
import { dashboardTheme } from "@/lib/dashboard-theme";
import { intlLocale, t } from "@/lib/i18n";
import { accountLabel } from "@/lib/social-connections";
import type { PlatformId } from "@/lib/social";

type Loaded = { kind: "ok"; link: OpenedLink } | { kind: "gone" } | { kind: "error" };

/** Kept so accounts connected from this tab are still listed after the next network's sign-in comes back. */
const doneKey = (link: string) => `plan.video.connect-link.done.${link.slice(0, 16)}`;

function readDone(link: string): LinkedAccount[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(doneKey(link)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as LinkedAccount[]).filter((item) => typeof item?.platform === "string" && typeof item.handle === "string") : [];
  } catch {
    return [];
  }
}

export function ConnectLinkPage() {
  const params = useParams<{ link: string }>();

  // On <html> so toasts take it too; index.html sets it before the first paint.
  const root = document.documentElement;
  root.classList.add("dashboard-theme");
  createRenderEffect(() => {
    root.dataset.dashboardTheme = dashboardTheme();
  });
  onCleanup(() => {
    root.classList.remove("dashboard-theme");
    delete root.dataset.dashboardTheme;
  });

  const [result, { refetch }] = createResource(
    () => params.link,
    async (link): Promise<Loaded> => {
      try {
        return { kind: "ok", link: await openConnectLink(link) };
      } catch (error) {
        return error instanceof ConnectLinkError && error.status === 404 ? { kind: "gone" } : { kind: "error" };
      }
    },
  );
  const opened = () => {
    const current = result.latest;
    return current?.kind === "ok" ? current.link : undefined;
  };

  const [done, setDone] = createSignal<LinkedAccount[]>(readDone(params.link));
  const [finishing, setFinishing] = createSignal<string | null>(null);

  const remember = (accounts: LinkedAccount[]) => {
    const next = [...done().filter((item) => !accounts.some((added) => added.platform === item.platform && added.handle === item.handle)), ...accounts];
    setDone(next);
    sessionStorage.setItem(doneKey(params.link), JSON.stringify(next));
  };

  onMount(() => {
    const previous = document.title;
    createRenderEffect(() => {
      const workspace = opened()?.workspace;
      document.title = workspace ? t("Connect your accounts to {workspace} | plan.video", { workspace }) : t("Connect your accounts | plan.video");
    });
    onCleanup(() => (document.title = previous));

    const returned = takeHandOff();
    if (!returned) return;
    const name = PLATFORMS.find((item) => item.id === returned.network)?.name ?? returned.network;
    const refused = loginRefusal(returned.network, returned.search);
    if (refused) {
      toast.error(t("Couldn't connect {network}", { network: name }), { description: refused });
      return;
    }
    setFinishing(returned.network);
    const id = toast.loading(t("Connecting {network}…", { network: name }));
    finishLinkSignIn(params.link, returned.network, returned.search)
      .then(({ accounts, problem }) => {
        remember(accounts);
        toast.success(t("Connected {network}", { network: name }), { id, description: accounts.map((account) => accountLabel(account)).join(", ") });
        if (problem) toast.error(t("Some accounts weren't connected"), { description: problem });
      })
      .catch((error: unknown) => {
        toast.error(t("Couldn't connect {network}", { network: name }), { id, description: error instanceof Error ? error.message : t("Try again in a moment.") });
        if (error instanceof ConnectLinkError && (error.status === 404 || error.status === 410)) void refetch();
      })
      .finally(() => setFinishing(null));
  });

  return (
    <div class="flex min-h-dvh flex-col bg-(--plane-canvas) text-(--plane-text-primary)">
      <header class="flex h-12 shrink-0 items-center gap-3 px-4 lg:px-3.5">
        <A href="/" class="flex items-center gap-2 rounded-md pr-1 outline-none focus-ring" aria-label={t("plan.video home")}>
          <svg viewBox="0 0 32 32" aria-hidden="true" class="size-7 shrink-0 rounded-md bg-(--logo-tile) ring-1 ring-inset ring-(--plane-border-subtle)">
            <g transform="translate(16 16) scale(0.72) translate(-16 -16)">
              <path class="fill-(--logo-ink)" d={MARK_PATH} />
            </g>
          </svg>
          <span class="text-sm leading-5 font-medium text-(--plane-text-primary)">plan.video</span>
        </A>
      </header>
      <main class="flex flex-1 justify-center px-3 pt-6 pb-10 sm:pt-16">
        <div class="depth-frame flex h-fit w-full max-w-[480px] flex-col rounded-xl border border-(--plane-border-subtle) bg-(--plane-surface-1)">
          <Switch>
            <Match when={result.latest?.kind === "error"}>
              <Message icon="info" title={t("This link couldn't be opened")} body={t("Check your connection and try again.")}>
                <PlaneButton variant="secondary" size="lg" onClick={() => void refetch()}>
                  {t("Try again")}
                </PlaneButton>
              </Message>
            </Match>
            <Match when={result.latest?.kind === "gone"}>
              <Message icon="link" title={t("This link doesn't work any more")} body={t("It ran out or was turned off. Ask the person who sent it for a new one.")} />
            </Match>
            <Match when={opened()}>
              {(link) => <Networks link={params.link} opened={link()} done={done()} finishing={finishing()} />}
            </Match>
            <Match when={!result.latest}>
              <div class="flex flex-col gap-2.5 p-5">
                <span class="h-5 w-2/3 animate-pulse rounded-md bg-(--plane-layer-2)" />
                <span class="h-3.5 w-5/6 animate-pulse rounded-md bg-(--plane-layer-2)" />
                <span class="mt-4 h-40 w-full animate-pulse rounded-md bg-(--plane-layer-2)" />
              </div>
            </Match>
          </Switch>
        </div>
      </main>
    </div>
  );
}

function Networks(props: { link: string; opened: OpenedLink; done: LinkedAccount[]; finishing: string | null }) {
  const [leaving, setLeaving] = createSignal<string | null>(null);
  const [askingHandle, setAskingHandle] = createSignal(false);
  const [handle, setHandle] = createSignal("");

  const networks = () => PLATFORMS.filter((item) => props.opened.networks.includes(item.id));
  const until = () => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" }).format(new Date(props.opened.expiresAt));
  const workspace = () => props.opened.workspace || t("their workspace");
  const from = () => props.opened.from || t("Someone");

  const start = (network: LinkNetwork) => {
    if (leaving()) return;
    setLeaving(network);
    void startLinkSignIn(props.link, network, network === "bluesky" ? handle().trim() : "").catch((error: unknown) => {
      setLeaving(null);
      const name = PLATFORMS.find((item) => item.id === network)?.name ?? network;
      toast.error(t("Couldn't start {network} login.", { network: name }), { description: error instanceof Error ? error.message : undefined });
    });
  };

  return (
    <>
      <div class="flex flex-col gap-1.5 px-5 pt-5 pb-4">
        <h1 class="text-[15px] leading-6 font-medium tracking-[-0.01em] text-(--plane-text-primary)">
          {t("Connect your accounts to {workspace}", { workspace: workspace() })}
        </h1>
        <p class="text-[13px] leading-5 text-(--plane-text-secondary)">
          {t("{name} uses plan.video to schedule and publish posts. Connect the accounts they should post to. You don't need a plan.video account.", { name: from() })}
        </p>
      </div>
      <ul class="flex flex-col border-t border-(--plane-border-subtle)">
        <For each={networks()}>
          {(item) => {
            const connected = () => props.done.filter((account) => account.platform === item.id);
            const busy = () => leaving() === item.id || props.finishing === item.id;
            return (
              <li class="flex flex-col gap-2 border-b border-(--plane-border-subtle) px-5 py-3 last:border-b-0">
                <div class="flex items-center gap-3">
                  <PlatformLogo id={item.id as PlatformId} class="size-8 rounded-md" />
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p class="truncate text-[13px] leading-5 font-medium text-(--plane-text-primary)">{item.name}</p>
                    <Show when={connected().length > 0}>
                      <p class="flex items-center gap-1.5 text-xs leading-4 text-(--plane-text-secondary)">
                        <span class="size-1.5 rounded-full bg-meter-green" />
                        {t("{count, plural, one {# account connected} other {# accounts connected}}", { count: connected().length })}
                      </p>
                    </Show>
                  </div>
                  <PlaneButton
                    variant="secondary"
                    size="lg"
                    disabled={!!leaving() || !!props.finishing}
                    onClick={() => (item.id === "bluesky" ? setAskingHandle((on) => !on) : start(item.id as LinkNetwork))}
                  >
                    {busy() ? t("Connecting…") : connected().length ? t("Add another") : t("Connect")}
                  </PlaneButton>
                </div>
                <Show when={item.id === "bluesky" && askingHandle()}>
                  <form
                    class="flex items-center gap-2 pl-11"
                    onSubmit={(event) => {
                      event.preventDefault();
                      start("bluesky");
                    }}
                  >
                    <input
                      class="h-7 min-w-0 flex-1 rounded-md border border-(--plane-border-strong) bg-(--plane-layer-1) px-2 text-[13px] text-(--plane-text-primary) outline-none placeholder:text-(--plane-text-placeholder) focus-ring"
                      value={handle()}
                      placeholder={t("Handle, if not on bsky.social")}
                      aria-label={t("Bluesky handle")}
                      autocomplete="username"
                      onInput={(event) => setHandle(event.currentTarget.value)}
                    />
                    <PlaneButton type="submit" size="lg" disabled={!!leaving()}>
                      {t("Sign in with Bluesky")}
                    </PlaneButton>
                  </form>
                </Show>
                <Show when={connected().length > 0}>
                  <ul class="flex flex-wrap gap-1.5 pl-11">
                    <For each={connected()}>
                      {(account) => (
                        <li class="flex h-7 max-w-full items-center gap-1.5 rounded-full border border-(--plane-border-subtle) bg-(--plane-layer-1) pr-2.5 pl-1">
                          <AvatarPhoto
                            url={account.avatarUrl || null}
                            class="size-5 shrink-0 rounded-full object-cover"
                            fallback={
                              <span class="grid size-5 shrink-0 place-items-center rounded-full bg-(--plane-layer-3) text-xxs font-medium uppercase">{account.handle.charAt(0)}</span>
                            }
                          />
                          <span class="min-w-0 truncate text-xs text-(--plane-text-primary)">{accountLabel(account)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <p class="border-t border-(--plane-border-subtle) px-5 py-4 text-xs leading-5 text-(--plane-text-tertiary)">
        {t("plan.video keeps each login on its server and never shows it to anyone, {name} included. To stop it, ask {name} to remove the account, or remove plan.video in the network's settings. This link works until {date}.", {
          name: from(),
          date: until(),
        })}
      </p>
    </>
  );
}

function Message(props: { icon: PlaneIconName; title: string; body: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span class="grid size-10 place-items-center rounded-lg border border-(--plane-border-subtle) bg-(--plane-layer-1) text-(--plane-text-tertiary)">
        <PlaneIcon name={props.icon} class="size-5" />
      </span>
      <div class="flex flex-col gap-1">
        <h1 class="text-[15px] leading-6 font-medium text-(--plane-text-primary)">{props.title}</h1>
        <p class="text-[13px] leading-5 text-(--plane-text-tertiary)">{props.body}</p>
      </div>
      {props.children}
    </div>
  );
}

export default ConnectLinkPage;
