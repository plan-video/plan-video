/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Plugs: per channel, rules that act on a post once it has enough likes. The
// sidebar lists the channels that can have them; the page shows the plugs of
// the one picked, each set up and switched on or off on its card, beside how
// the latest post looks once they've run, and above the posts that went out
// lately with what their plugs did.

import { useSearchParams } from "@solidjs/router";
import Heart from "lucide-solid/icons/heart";
import MessageCircle from "lucide-solid/icons/message-circle";
import Repeat2 from "lucide-solid/icons/repeat-2";
import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";

import { allPosts } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlugsArt } from "@/components/dashboard/empty-art";
import { PostThumbnail } from "@/components/dashboard/posts-view";
import { dashboardNavItemClass } from "@/components/dashboard/sidebar";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { fieldControl, fieldControlBase } from "@/components/publish/controls";
import { accountRows, type DeliveryRow } from "@/components/publish/deliveries";
import { Button } from "@/components/ui/button";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { useAuth } from "@/context/auth";
import { AvatarPhoto } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { intlLocale, t } from "@/lib/i18n";
import {
  PLUGS,
  PLUGS_BY_PLATFORM,
  PLUG_CHECKS,
  PLUG_CHECK_HOURS,
  PLUG_PLATFORMS,
  loadPlugs,
  plugFor,
  plugProblems,
  plugSettings,
  savePlug,
  setPlugActivated,
  type PlugDraft,
  type PlugKind,
  type PlugSetting,
} from "@/lib/plugs";
import { socialPlatform, type PlatformId } from "@/lib/social";
import { accountsFor, loadSocialConnections, socialConnections, type SocialConnection } from "@/lib/social-connections";
import { timeZone } from "@/lib/time-zone";

const HOUR_MS = 3_600_000;
/** How many of the channel's latest posts the list shows. */
const RECENT = 10;

/** The networks plugs work on, by name: "Bluesky", or "X and Bluesky". */
const plugNetworks = () =>
  new Intl.ListFormat(intlLocale("en"), { type: "disjunction" }).format(PLUG_PLATFORMS.map((id) => socialPlatform(id as PlatformId).name));

/** Accounts on the networks plugs work on, in the order the networks are listed. */
export function plugChannels(): SocialConnection[] {
  return socialConnections()
    .filter((account) => PLUG_PLATFORMS.includes(account.platform))
    .sort((a, b) => PLUG_PLATFORMS.indexOf(a.platform) - PLUG_PLATFORMS.indexOf(b.platform) || a.handle.localeCompare(b.handle));
}

/** The channel picked in the address, or the first one. */
function useChannel() {
  const [params, setParams] = useSearchParams();
  const channel = () => {
    const list = plugChannels();
    const wanted = Array.isArray(params.channel) ? params.channel[0] : params.channel;
    return list.find((account) => account.id === wanted) ?? list[0];
  };
  return [channel, (id: string) => setParams({ channel: id }, { replace: true })] as const;
}

/** The sidebar's channel list. */
export function DashboardPlugChannels() {
  const auth = useAuth();
  const [channel, setChannel] = useChannel();
  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
    loadPlugs(auth.user()?.id);
  });
  const activeCount = (account: SocialConnection) => plugSettings().filter((plug) => plug.accountId === account.id && plug.activated).length;

  return (
    <For each={plugChannels()}>
      {(account) => (
        <button
          type="button"
          aria-current={channel()?.id === account.id ? "page" : undefined}
          class={dashboardNavItemClass(channel()?.id === account.id)}
          onClick={() => setChannel(account.id)}
        >
          <span class="flex min-w-0 flex-1 items-center gap-2 py-px">
            <AccountAvatar account={account} class="size-5" />
            <span class="min-w-0 truncate text-sm leading-5 font-medium">@{account.handle}</span>
          </span>
          <Show when={activeCount(account)}>
            <span class="shrink-0 rounded-md bg-(--plane-layer-3) px-1.5 py-0.5 text-xxs leading-[1.1] font-medium text-(--plane-text-tertiary) tabular-nums">
              {t("{count, plural, other {# on}}", { count: activeCount(account) })}
            </span>
          </Show>
        </button>
      )}
    </For>
  );
}

export function DashboardPlugsView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [channel] = useChannel();
  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
    loadPlugs(auth.user()?.id);
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <Show
        when={channel()?.id}
        keyed
        fallback={
          <div class="flex flex-col items-center gap-4 px-6 pt-12 text-center">
            <PlugsArt />
            <div class="flex flex-col gap-1">
              <h2 class="text-sm font-medium text-foreground">{t("None of your channels has plugs")}</h2>
              <p class="text-xs text-muted-foreground">{t("Plugs work on {networks}. Add an account there to set them up.", { networks: plugNetworks() })}</p>
            </div>
            <Button class="px-3" onClick={() => setParams({ dashboard: "connections", channel: undefined })}>
              {t("Open Connections")}
            </Button>
          </div>
        }
      >
        <ChannelPlugs account={channel()!} />
      </Show>
    </div>
  );
}

const draftOf = (plug: PlugSetting | undefined): PlugDraft => ({ likes: plug ? String(plug.likes) : "", message: plug?.message ?? "" });

/** One channel's page. Made again for another channel, so the fields start from its plugs. */
function ChannelPlugs(props: { account: SocialConnection }) {
  const kinds = () => PLUGS_BY_PLATFORM[props.account.platform] ?? [];
  const [drafts, setDrafts] = createStore<Partial<Record<PlugKind, PlugDraft>>>(
    Object.fromEntries(kinds().map((kind) => [kind, draftOf(plugFor(props.account.id, kind))])),
  );
  // Ticks each minute, so the next check times move along.
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));
  const sent = () => sentFrom(props.account);

  return (
    <div class="flex w-full max-w-[1400px] flex-col gap-6 px-6 pt-6 pb-16">
      <div class="flex items-center gap-3">
        <AccountAvatar account={props.account} class="size-9" />
        <div class="flex min-w-0 flex-col">
          <h2 class="truncate text-sm font-medium text-foreground">@{props.account.handle}</h2>
          <p class="text-xs text-muted-foreground">
            {socialPlatform(props.account.platform as PlatformId).name} · {t("Each post is checked every {hours, plural, one {# hour} other {# hours}}, {checks, plural, one {# time} other {# times}} after it goes out", { hours: PLUG_CHECK_HOURS, checks: PLUG_CHECKS })}
          </p>
        </div>
      </div>

      {/* The preview stretches to the plugs' height, its picture taking up the difference. */}
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="depth-card flex min-w-0 flex-col divide-y divide-border-strong rounded-xl border border-border-strong bg-accent/30">
          <For each={kinds()}>
            {(kind) => (
              <PlugSection
                account={props.account}
                kind={kind}
                draft={drafts[kind] ?? draftOf(undefined)}
                onDraft={(draft) => setDrafts(kind, draft)}
              />
            )}
          </For>
        </div>
        <PlugPreview account={props.account} drafts={drafts} latest={sent()[0]?.post} />
      </div>

      <RecentPosts account={props.account} sent={sent()} now={now()} />
    </div>
  );
}

function PlugSection(props: { account: SocialConnection; kind: PlugKind; draft: PlugDraft; onDraft(draft: PlugDraft): void }) {
  const plug = () => PLUGS[props.kind];
  const saved = () => plugFor(props.account.id, props.kind);
  const [tried, setTried] = createSignal(false);
  const problems = () => (tried() ? plugProblems(props.kind, props.draft, props.account.platform) : {});
  // The saved plug can arrive or change after the fields were filled, from the
  // account or another tab: the fields follow it unless they were being edited.
  let base = draftOf(saved());
  createEffect(
    on(saved, (current) => {
      const next = draftOf(current);
      if (props.draft.likes === base.likes && props.draft.message === base.message) props.onDraft(next);
      base = next;
    }),
  );
  const changed = () => {
    const current = saved();
    if (!current) return true;
    return String(current.likes) !== props.draft.likes.trim() || (plug().message && current.message !== props.draft.message.trim());
  };

  const save = () => {
    setTried(true);
    const before = saved();
    const error = savePlug(props.account.id, props.account.platform, props.kind, props.draft);
    if (error) return;
    setTried(false);
    props.onDraft(draftOf(saved()));
    toast.success(before ? t("Plug updated") : t("Plug activated"), { description: t("{plug} on @{handle}", { plug: t(plug().title), handle: props.account.handle }) });
  };
  const reset = () => {
    setTried(false);
    props.onDraft(draftOf(saved()));
  };
  const saveOnShortcut = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey && event.currentTarget instanceof HTMLTextAreaElement)) return;
    event.preventDefault();
    save();
  };

  return (
    <section class="grid gap-x-10 gap-y-4 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex min-h-5 items-center justify-between gap-3">
          <h3 class="text-sm font-medium text-foreground">{t(plug().title)}</h3>
          {/* Every plug turns on and off here. One not set up yet is saved on, with what's in its fields. */}
          <Switch
            checked={saved()?.activated ?? false}
            onChange={(on: boolean) => {
              const current = saved();
              if (current) setPlugActivated(current.id, on);
              else if (on) save();
            }}
          >
            <SwitchInput aria-label={t("{plug} on", { plug: t(plug().title) })} />
            <SwitchControl variant="compact">
              <SwitchThumb variant="compact" />
            </SwitchControl>
          </Switch>
        </div>
        <p class="text-xs leading-5 text-muted-foreground">{t(plug().description)}</p>
      </div>

      <div class="flex min-w-0 flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">{t("Likes it takes")}</span>
          <input
            class={cx(fieldControl, "tabular-nums")}
            inputMode="numeric"
            placeholder={t("Amount of likes")}
            value={props.draft.likes}
            onInput={(event) => props.onDraft({ ...props.draft, likes: event.currentTarget.value })}
            onKeyDown={saveOnShortcut}
          />
          <Show when={problems().likes}>
            <span class="text-xs text-destructive">{problems().likes}</span>
          </Show>
        </label>
        <Show when={plug().message}>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{t("Reply")}</span>
            <textarea
              class={cx(fieldControlBase, "min-h-20 resize-y py-2 leading-relaxed")}
              placeholder={t("The post to plug, like a link to your newsletter or what you're launching.")}
              value={props.draft.message}
              onInput={(event) => props.onDraft({ ...props.draft, message: event.currentTarget.value })}
              onKeyDown={saveOnShortcut}
            />
            <Show when={problems().message}>
              <span class="text-xs text-destructive">{problems().message}</span>
            </Show>
          </label>
        </Show>
        {/* A plug that's set up saves its changes here; a new one is turned on with its switch. */}
        <Show when={saved() && changed()}>
          <div class="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              {t("Cancel")}
            </Button>
            <Button class="px-3" onClick={save}>
              {t("Save")}
            </Button>
          </div>
        </Show>
      </div>
    </section>
  );
}

/* ---- How the latest post looks once the plugs have run ------------------ */

/** The words a post went out with on the network. */
const wordsOn = (post: StoredEvent, platform: string) => post.captions?.[platform]?.trim() || post.description?.trim() || post.title;

function PlugPreview(props: { account: SocialConnection; drafts: Partial<Record<PlugKind, PlugDraft>>; latest?: StoredEvent }) {
  /** Shown when it's on, or while it's being set up. */
  const likesFor = (kind: PlugKind) => {
    const saved = plugFor(props.account.id, kind);
    if (saved && !saved.activated) return 0;
    const likes = Number(props.drafts[kind]?.likes.trim());
    return Number.isInteger(likes) && likes > 0 ? likes : 0;
  };
  const reposted = () => likesFor("auto-repost") > 0;
  const replied = () => likesFor("auto-plug") > 0;
  const reply = () => props.drafts["auto-plug"]?.message.trim() ?? "";
  const likes = () => Math.max(likesFor("auto-repost"), likesFor("auto-plug"));
  const name = () => props.account.handle.split(".")[0];
  const count = (value: number) => value.toLocaleString(intlLocale());

  const Avatar = () => (
    <AvatarPhoto
      url={props.account.avatarUrl || null}
      class="size-9 shrink-0 rounded-full object-cover"
      fallback={<span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-medium text-foreground">{name().charAt(0).toUpperCase()}</span>}
    />
  );
  const Byline = () => (
    <div class="flex min-w-0 items-center gap-1 text-xs">
      <span class="shrink-0 font-medium text-foreground">{name()}</span>
      <span class="truncate text-muted-foreground">@{props.account.handle}</span>
    </div>
  );

  return (
    <aside aria-label={t("What your followers see")} class="flex min-w-0 flex-col rounded-xl border border-border-strong bg-background p-4">
      <Show when={reposted()}>
        <p class="flex items-center gap-1.5 pb-2 pl-5 text-xs text-muted-foreground">
          <Repeat2 class="size-3.5" stroke-width={2} />
          {t("Reposted by you")}
        </p>
      </Show>
      <article class="flex min-h-0 flex-1 gap-2.5">
        <div class="flex flex-col items-center">
          <Avatar />
          <Show when={replied()}>
            <span class="mt-1 w-0.5 flex-1 rounded-full bg-border-strong" />
          </Show>
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 pb-4">
          <Byline />
          <Show when={props.latest} fallback={<p class="text-xs leading-5 text-muted-foreground">{t("Your post")}</p>}>
            {(post) => (
              <>
                <p class="line-clamp-4 text-xs leading-5 whitespace-pre-line break-words text-foreground">{wordsOn(post(), props.account.platform)}</p>
                <Show when={post().thumbnail}>
                  {(src) => (
                    <div class="relative min-h-40 flex-1 overflow-hidden rounded-lg border border-border xl:min-h-16">
                      <img src={src()} alt="" class="absolute inset-0 size-full object-cover" draggable={false} />
                    </div>
                  )}
                </Show>
              </>
            )}
          </Show>
          <div class="mt-auto flex items-center gap-5 pt-1 text-xs text-muted-foreground tabular-nums">
            <span class="flex items-center gap-1">
              <MessageCircle class="size-3.5" stroke-width={2} />
              {replied() ? 1 : 0}
            </span>
            <span class="flex items-center gap-1">
              <Repeat2 class="size-3.5" stroke-width={2} />
              {reposted() ? 1 : 0}
            </span>
            <span class="flex items-center gap-1">
              <Heart class="size-3.5" stroke-width={2} />
              {count(likes())}
            </span>
          </div>
        </div>
      </article>
      <Show when={replied()}>
        <article class="flex gap-2.5">
          <Avatar />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <Byline />
            <p class="text-xs leading-5 whitespace-pre-line break-words" classList={{ "text-foreground": !!reply(), "text-muted-foreground": !reply() }}>
              {reply() || t("Your plug")}
            </p>
          </div>
        </article>
      </Show>
    </aside>
  );
}

/* ---- The posts that went out lately, and what their plugs did ----------- */

type SentPost = { post: StoredEvent; at: number; row?: DeliveryRow };

/** The channel's latest posts that went out, newest first. */
function sentFrom(account: SocialConnection): SentPost[] {
  const rows = accountRows(account.id);
  const list: SentPost[] = [];
  for (const post of allPosts()) {
    const delivery = post.deliveries?.[account.platform];
    if (delivery?.state !== "sent" || !accountsFor(account.platform, post.accounts).some((item) => item.id === account.id)) continue;
    const row = rows.filter((item) => item.post_id === post.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    // A row's update time moves with each check, so the time it was due stands for when it went out.
    const at = Date.parse(row?.due_at ?? delivery.at);
    if (Number.isFinite(at)) list.push({ post, at, row });
  }
  return list.sort((a, b) => b.at - a.at).slice(0, RECENT);
}

const when = (ms: number) =>
  new Intl.DateTimeFormat(intlLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timeZone() }).format(ms);

/** What the plugs did on a post, or when it's checked next. */
function outcome(sent: SentPost, accountId: string, now: number): string {
  const done = sent.row?.plugs_done ?? [];
  if (done.length) return done.map((kind) => (kind === "auto-repost" ? t("Reposted") : t("Plug posted"))).join(" · ");
  const set = plugSettings().filter((plug) => plug.accountId === accountId && plug.activated && Date.parse(plug.createdAt) <= sent.at);
  if (!set.length) return t("No plugs were on");
  const step = PLUG_CHECK_HOURS * HOUR_MS;
  const checks = sent.row?.plug_checks ?? Math.min(PLUG_CHECKS, Math.max(0, Math.floor((now - sent.at) / step)));
  if (checks < PLUG_CHECKS) return t("Next check {time}", { time: when(sent.at + (checks + 1) * step) });
  return t("Didn't reach the likes");
}

function RecentPosts(props: { account: SocialConnection; sent: SentPost[]; now: number }) {
  return (
    <section class="flex flex-col gap-2">
      <h3 class="text-sm font-medium text-foreground">{t("Recent posts")}</h3>
      <Show
        when={props.sent.length}
        fallback={<p class="pt-1 text-xs text-muted-foreground">{t("Posts that go out from @{handle} show up here, with what their plugs did.", { handle: props.account.handle })}</p>}
      >
        <div class="flex flex-col divide-y divide-border-strong overflow-hidden rounded-xl border border-border-strong bg-accent/30">
          <For each={props.sent}>
            {(sent) => (
              <div class="flex h-14 items-center gap-3 px-4">
                <PostThumbnail post={sent.post} />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-sm font-medium text-foreground">{sent.post.title}</span>
                  <span class="text-xs text-muted-foreground tabular-nums">{when(sent.at)}</span>
                </div>
                <span class="shrink-0 text-xs text-muted-foreground">{outcome(sent, props.account.id, props.now)}</span>
                <Show when={sent.row?.url} fallback={<span class="size-7 shrink-0" />}>
                  {(url) => (
                    <a
                      href={url()}
                      target="_blank"
                      rel="noopener"
                      class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-ring"
                      aria-label={t("Open on {network}", { network: socialPlatform(props.account.platform as PlatformId).name })}
                    >
                      <Icon name="external-link" class="size-4" />
                    </a>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
