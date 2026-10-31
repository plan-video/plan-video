/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";

import { YouTubeIcon } from "@/components/brand/youtube-icon";

import { CharCount, Field, FieldGroup, PlatformLogo, Segmented, SwitchRow, TagInput, fieldControl } from "@/components/publish/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { localized, msg, rich, t } from "@/lib/i18n";
import { cleanBoardName, loadPinterestBoards, pinterestBoards } from "@/lib/pinterest-boards";
import { accountLabel, type SocialConnection } from "@/lib/social-connections";
import { loadTikTokCreator, type TikTokCreator } from "@/lib/tiktok";
import {
  captionLength,
  INSTAGRAM_MAX_COLLABORATORS,
  instagramHandle,
  socialPlatform,
  xCommunityId,
  YOUTUBE_TAGS_LIMIT,
  youtubeTag,
  youtubeTagsLength,
  type PlatformId,
  type PlatformSettings,
  type PostKind,
  type TikTokPrivacy,
  type XReplies,
  type YouTubePrivacy,
  formatDuration,
} from "@/lib/social";

export const HAS_SETTINGS: readonly PlatformId[] = ["youtube", "tiktok", "instagram", "x", "pinterest"];

export const platformsWithSettings = (kind: PostKind, platforms: readonly PlatformId[]) =>
  kind === "story" ? [] : platforms.filter((id) => HAS_SETTINGS.includes(id));

const TIKTOK_PRIVACY: { id: TikTokPrivacy; label: string }[] = [
  { id: "public", label: msg("Everyone") },
  { id: "friends", label: msg("Friends") },
  { id: "followers", label: msg("Followers") },
  { id: "private", label: msg("Only me") },
];

const MUSIC_USAGE = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED_POLICY = "https://www.tiktok.com/legal/page/global/bc-policy/en";

const [gate, setGate] = createSignal<{ maxVideoSeconds: number | null; error: string | null }>({ maxVideoSeconds: null, error: null });

export function tiktokLimitIssues(kind: PostKind, platforms: readonly PlatformId[], duration: number | null): { platform: PlatformId; level: "error"; message: string }[] {
  if (kind === "story" || !platforms.includes("tiktok")) return [];
  const current = gate();
  const issues: { platform: PlatformId; level: "error"; message: string }[] = [];
  if (current.error) issues.push({ platform: "tiktok", level: "error", message: t(current.error) });
  if (current.maxVideoSeconds && duration && duration > current.maxVideoSeconds) {
    issues.push({
      platform: "tiktok",
      level: "error",
      message: t("This account can post videos up to {duration}.", { duration: formatDuration(current.maxVideoSeconds) }),
    });
  }
  return issues;
}

export function TikTokPostNotice(props: { settings: PlatformSettings["tiktok"]; class?: string }) {
  const branded = () => props.settings.disclose && props.settings.brandedContent;
  const link = (href: string) => (text: string) => (
    <a class="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-ring" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
  return (
    <Show
      when={!props.settings.inbox}
      fallback={
        <p class={cx("text-xs text-muted-foreground", props.class)}>
          {t("This sends the video to your TikTok inbox. Open the notification in TikTok to edit it and post it.")}
        </p>
      }
    >
    <p class={cx("text-xs text-muted-foreground", props.class)}>
      {branded()
        ? rich("By posting, you agree to TikTok's <policy>Branded Content Policy</policy> and <music>Music Usage Confirmation</music>.", {
            policy: link(BRANDED_POLICY),
            music: link(MUSIC_USAGE),
          })
        : rich("By posting, you agree to TikTok's <music>Music Usage Confirmation</music>.", { music: link(MUSIC_USAGE) })}
    </p>
    </Show>
  );
}

function useTikTokCreator(account: () => SocialConnection | undefined) {
  const auth = useAuth();
  const [info, setInfo] = createSignal<TikTokCreator | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  createEffect(
    on(
      () => `${auth.user()?.id ?? ""}:${account()?.id ?? ""}`,
      () => {
        setInfo(null);
        setError(null);
        const current = account();
        const id = current?.id ?? "";
        const userId = auth.user()?.id;
        if (!id || !current?.tiktok || !userId) {
          setLoading(false);
          return;
        }
        let alive = true;
        setLoading(true);
        void (async () => {
          try {
            const next = await loadTikTokCreator(current.id);
            if (!alive) return;
            setInfo(next);
            setGate({ maxVideoSeconds: next.maxVideoSeconds, error: null });
          } catch (caught) {
            if (!alive) return;
            const message = caught instanceof Error ? caught.message : msg("Couldn't reach TikTok.");
            setError(message);
            setGate({ maxVideoSeconds: null, error: message });
          } finally {
            if (alive) setLoading(false);
          }
        })();
        onCleanup(() => {
          alive = false;
        });
      },
    ),
  );

  return { info, error, loading };
}

const YOUTUBE_PRIVACY: { id: YouTubePrivacy; label: string }[] = [
  { id: "public", label: msg("Public") },
  { id: "unlisted", label: msg("Unlisted") },
  { id: "private", label: msg("Private") },
];

const X_REPLIES: { id: XReplies; label: string }[] = [
  { id: "everyone", label: msg("Everyone") },
  { id: "following", label: msg({ message: "Following", context: "who can reply: accounts you follow" }) },
  { id: "mentioned", label: msg("Mentioned") },
];

const NAME_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "conjunction" }), "en-GB");

type CreatorState = { info(): TikTokCreator | null; error(): string | null; loading(): boolean };

function TikTokAccount(props: { creator: CreatorState }) {
  const [broken, setBroken] = createSignal(false);
  createEffect(on(() => props.creator.info()?.avatarUrl, () => setBroken(false)));
  return (
    <Show
      when={props.creator.info()}
      fallback={
        <Show when={props.creator.loading()}>
          <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="spinner-loader" class="size-4 animate-spin" />
            {t("Checking account")}
          </span>
        </Show>
      }
    >
      {(info) => (
        <span class="ml-auto flex min-w-0 items-center gap-1.5" title={info().username ? `@${info().username}` : undefined}>
          <Show
            when={info().avatarUrl && !broken()}
            fallback={
              <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium uppercase text-foreground">
                {info().nickname.charAt(0)}
              </span>
            }
          >
            <img
              src={info().avatarUrl}
              alt=""
              referrerpolicy="no-referrer"
              class="size-5 shrink-0 rounded-full object-cover ring-1 ring-white/10"
              onError={() => setBroken(true)}
            />
          </Show>
          <span class="min-w-0 truncate text-xs text-foreground">{info().nickname}</span>
        </span>
      )}
    </Show>
  );
}

/** TikTok requires the privacy dropdown to start with nothing picked, and its disclosure. */
function TikTokSettings(props: {
  settings: PlatformSettings["tiktok"];
  onChange: SetStoreFunction<PlatformSettings>;
  creator: CreatorState;
  hasVideo: boolean;
  hasPictures: boolean;
}) {
  const set = props.onChange;
  const tiktok = () => props.settings;
  const branded = () => tiktok().disclose && tiktok().brandedContent;
  const choices = createMemo(() => {
    const allowed = new Set(props.creator.info()?.privacy ?? []);
    return TIKTOK_PRIVACY.filter((choice) => allowed.has(choice.id));
  });

  // TikTok's answer wins: a switch it turned off stays off, and a privacy it doesn't offer is cleared.
  createEffect(() => {
    const info = props.creator.info();
    if (!info) return;
    const current = tiktok();
    if (info.commentDisabled && current.comments) set("tiktok", "comments", false);
    if (info.duetDisabled && current.duet) set("tiktok", "duet", false);
    if (info.stitchDisabled && current.stitch) set("tiktok", "stitch", false);
    if (current.privacy && !info.privacy.includes(current.privacy)) set("tiktok", "privacy", null);
    if (current.privacy === "private" && current.disclose && current.brandedContent) set("tiktok", "privacy", null);
  });

  const turnedOff = () => {
    const info = props.creator.info();
    if (!info) return [];
    return [
      info.commentDisabled && msg("Comments"),
      props.hasVideo && info.duetDisabled && msg("Duet"),
      props.hasVideo && info.stitchDisabled && msg("Stitch"),
    ].filter((name) => name !== false);
  };

  return (
    <>
      <Show when={props.hasVideo}>
        <Field label={t("Send it")}>
          <Segmented
            label={t("Where the TikTok video goes")}
            options={[
              { id: "profile", label: msg("To the profile") },
              { id: "inbox", label: msg("To the inbox") },
            ]}
            value={tiktok().inbox ? "inbox" : "profile"}
            onChange={(mode) => set("tiktok", "inbox", mode === "inbox")}
          />
        </Field>
      </Show>
      <Show when={tiktok().inbox && props.hasVideo}>
        <p class="text-xs text-muted-foreground">
          {t("The video goes to this account's TikTok inbox. Open the notification in TikTok to edit it and post it.")}
        </p>
      </Show>
      <Show when={!tiktok().inbox || !props.hasVideo}>
      <>
      <Show when={!props.creator.info() && !props.creator.loading()}>
        <p class="text-xs" classList={{ "text-destructive": !!props.creator.error(), "text-muted-foreground": !props.creator.error() }}>
          {t(props.creator.error() ?? msg("Connect TikTok to choose who can watch."))}
        </p>
      </Show>
      <Field label={t("Who can watch")}>
        <Select<(typeof TIKTOK_PRIVACY)[number]>
          options={choices()}
          optionValue="id"
          optionTextValue="label"
          optionDisabled={(option) => option.id === "private" && branded()}
          placeholder={props.creator.loading() ? t("Checking TikTok…") : t("Select who can watch")}
          value={choices().find((option) => option.id === tiktok().privacy) ?? null}
          onChange={(option) => option && set("tiktok", "privacy", option.id)}
          itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.label)}</SelectItem>}
          disabled={!choices().length}
        >
          <SelectTrigger aria-label={t("Who can watch this TikTok")} class="border border-(--border-input)">
            <SelectValue<(typeof TIKTOK_PRIVACY)[number]>>{(state) => t(state.selectedOption()?.label ?? "")}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </Field>
      <Show when={branded()}>
        <p class="text-xs text-muted-foreground">{t("Branded content visibility cannot be set to private.")}</p>
      </Show>
      <FieldGroup label={t("Allow users to")}>
        <div class="flex flex-col gap-2.5 pt-1">
          <SwitchRow
            label={t("Comment")}
            checked={tiktok().comments}
            disabled={props.creator.info()?.commentDisabled}
            onChange={(on) => set("tiktok", "comments", on)}
          />
          <Show when={props.hasVideo}>
            <SwitchRow
              label={t("Duet")}
              checked={tiktok().duet}
              disabled={props.creator.info()?.duetDisabled}
              onChange={(on) => set("tiktok", "duet", on)}
            />
            <SwitchRow
              label={t("Stitch")}
              checked={tiktok().stitch}
              disabled={props.creator.info()?.stitchDisabled}
              onChange={(on) => set("tiktok", "stitch", on)}
            />
          </Show>
        </div>
        <Show when={turnedOff().length}>
          <span class="pt-1 text-xs text-muted-foreground">
            {turnedOff().length === 1 && turnedOff()[0] !== "Comments"
              ? t("{names} is turned off in this account's TikTok privacy settings.", { names: t(turnedOff()[0]!) })
              : t("{names} are turned off in this account's TikTok privacy settings.", { names: NAME_LIST().format(turnedOff().map((name) => t(name))) })}
          </span>
        </Show>
      </FieldGroup>
      <Show when={props.hasPictures}>
        <p class="text-xs text-muted-foreground">{t("TikTok adds a trending sound to photo posts. Change it in the app once it's up.")}</p>
      </Show>
      <div class="border-t border-border-strong" />
      <SwitchRow
        label={t("Disclose commercial content")}
        description={t("Turn on if this promotes you, a brand, a product, or a service.")}
        checked={tiktok().disclose}
        onChange={(on) => set("tiktok", "disclose", on)}
      />
      <Show when={tiktok().disclose}>
        <div class="flex flex-col gap-3 rounded-xl bg-accent/50 p-3">
          <SwitchRow
            label={t("Your brand")}
            description={t("You are promoting yourself or your own business.")}
            checked={tiktok().yourBrand}
            onChange={(on) => set("tiktok", "yourBrand", on)}
          />
          <SwitchRow
            label={t("Branded content")}
            description={t("You are promoting another brand or a third party.")}
            checked={tiktok().brandedContent}
            onChange={(on) => {
              set("tiktok", "brandedContent", on);
              if (on && tiktok().privacy === "private") set("tiktok", "privacy", null);
            }}
          />
          <p class="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Icon
              name={tiktok().yourBrand || tiktok().brandedContent ? "info" : "alert-warning"}
              class={cx("size-4 shrink-0", !tiktok().yourBrand && !tiktok().brandedContent && "text-destructive")}
            />
            {tiktok().brandedContent
              ? t("Your photo/video will be labeled as 'Paid partnership'")
              : tiktok().yourBrand
                ? t("Your photo/video will be labeled as 'Promotional content'")
                : t("You need to indicate if your content promotes yourself, a third party, or both.")}
          </p>
        </div>
      </Show>
      </>
      </Show>
      {/* TikTok's required declaration, at the end of its own settings. */}
      <TikTokPostNotice settings={tiktok()} class="border-t border-border-strong pt-3 [&_a]:text-foreground/80" />
    </>
  );
}

export function PlatformSettingsFields(props: {
  kind: PostKind;
  platforms: readonly PlatformId[];
  settings: PlatformSettings;
  onChange: SetStoreFunction<PlatformSettings>;
  mixed?: boolean;
  tiktokAccount?: () => SocialConnection | undefined;
  only?: PlatformId;
  youtubeChannels?: () => SocialConnection[];
  /** Shown with its title and privacy status, as YouTube's rules ask. */
  youtubeDescription?: { value: () => string; onInput: (text: string) => void; own: () => boolean; reset: () => void };
}) {
  const auth = useAuth();
  const creator = useTikTokCreator(() => (props.platforms.includes("tiktok") ? props.tiktokAccount?.() : undefined));
  createEffect(() => loadPinterestBoards(auth.user()?.id));
  const shown = () => platformsWithSettings(props.kind, props.platforms).filter((id) => !props.only || id === props.only);
  const hasVideo = () => props.kind === "video" || !!props.mixed;
  const hasPictures = () => props.kind === "image" || !!props.mixed;
  const set = props.onChange;
  const communityBad = () => !!props.settings.x.community.trim() && !xCommunityId(props.settings.x.community);
  const otherBoards = () =>
    pinterestBoards().filter((board) => board.toLowerCase() !== props.settings.pinterest.board.trim().toLowerCase());

  const fields = (id: PlatformId) => (
    <Switch>
      <Match when={id === "youtube"}>
        <Field label={t("Title")} trailing={<CharCount count={captionLength(props.settings.youtube.title)} limit={100} />}>
          <input
            class={fieldControl}
            placeholder={t("What's the video called?")}
            value={props.settings.youtube.title}
            onInput={(event) => set("youtube", "title", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Field>
        <Show when={props.youtubeDescription}>
          {(description) => (
            <Field
              label={t("Description")}
              trailing={
                <Show when={description().own()} fallback={<span>{t("Same as the caption")}</span>}>
                  <button type="button" class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => description().reset()}>
                    {t("Use the shared caption")}
                  </button>
                </Show>
              }
            >
              <textarea
                class={cx(fieldControl, "h-auto min-h-20 resize-y py-1.5 leading-relaxed")}
                placeholder={t("What's the video about?")}
                value={description().value()}
                onInput={(event) => description().onInput(event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </Field>
          )}
        </Show>
        <FieldGroup label={t("Privacy status")}>
          <Segmented options={YOUTUBE_PRIVACY} value={props.settings.youtube.privacy} onChange={(privacy) => set("youtube", "privacy", privacy)} />
        </FieldGroup>
        <SwitchRow
          label={t("Made for kids")}
          description={t("Required by YouTube. Turns off comments and some features.")}
          checked={props.settings.youtube.madeForKids}
          onChange={(on) => set("youtube", "madeForKids", on)}
        />
        <FieldGroup
          label={t("Tags")}
          trailing={<CharCount count={youtubeTagsLength(props.settings.youtube.tags)} limit={YOUTUBE_TAGS_LIMIT} />}
          hint={t("Helps YouTube with misspellings of your title. Press Enter or a comma after each one.")}
        >
          <TagInput
            label={t("YouTube tags")}
            placeholder={t("tutorial, video editing")}
            value={props.settings.youtube.tags}
            clean={youtubeTag}
            onChange={(tags) => set("youtube", "tags", tags)}
          />
        </FieldGroup>
      </Match>
      <Match when={id === "tiktok"}>
        <TikTokSettings
          settings={props.settings.tiktok}
          onChange={set}
          creator={creator}
          hasVideo={hasVideo()}
          hasPictures={hasPictures()}
        />
      </Match>
      <Match when={id === "instagram"}>
        <FieldGroup
          label={t("Collaborators")}
          trailing={
            <span class="tabular-nums">
              {props.settings.instagram.collaborators.length} / {INSTAGRAM_MAX_COLLABORATORS}
            </span>
          }
          hint={t("Each one gets an invite. Once they accept, the post shows on their profile too.")}
        >
          <TagInput
            label={t("Instagram collaborators")}
            placeholder={t("username")}
            prefix="@"
            max={INSTAGRAM_MAX_COLLABORATORS}
            value={props.settings.instagram.collaborators}
            clean={instagramHandle}
            onChange={(handles) => set("instagram", "collaborators", handles)}
          />
        </FieldGroup>
        <Show when={hasVideo()}>
          <SwitchRow
            label={t("Also share to feed")}
            description={t("The Reel shows on your profile grid too.")}
            checked={props.settings.instagram.shareToFeed}
            onChange={(on) => set("instagram", "shareToFeed", on)}
          />
        </Show>
      </Match>
      <Match when={id === "x"}>
        <Field label={t("Who can reply")}>
          <Segmented options={X_REPLIES} value={props.settings.x.replies} onChange={(replies) => set("x", "replies", replies)} />
        </Field>
        <Field label={t("Community")}>
          <input
            class={cx(fieldControl, communityBad() && "border-destructive/70 focus:border-destructive/70")}
            placeholder={t("Paste a community link, or leave empty")}
            value={props.settings.x.community}
            onInput={(event) => set("x", "community", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <span class={`text-xs ${communityBad() ? "text-destructive" : "text-muted-foreground"}`}>
            {communityBad()
              ? t("Use a link like x.com/i/communities/123…")
              : props.settings.x.community.trim()
                ? t("Posts to the community. Its members can reply.")
                : t("Posts to your timeline.")}
          </span>
        </Field>
      </Match>
      <Match when={id === "pinterest"}>
        <FieldGroup label={t("Board")}>
          <input
            aria-label={t("Pinterest board")}
            class={fieldControl}
            placeholder={t("Which board does it go on?")}
            maxLength={50}
            value={props.settings.pinterest.board}
            onInput={(event) => set("pinterest", "board", event.currentTarget.value)}
            onBlur={(event) => set("pinterest", "board", cleanBoardName(event.currentTarget.value))}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <Show when={otherBoards().length}>
            <div class="flex flex-wrap gap-1">
              <For each={otherBoards()}>
                {(board) => (
                  <button
                    type="button"
                    class="cap-trim h-6 max-w-full truncate rounded-md border border-border-strong px-2 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
                    onClick={() => set("pinterest", "board", board)}
                  >
                    {board}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </FieldGroup>
        <Field label={t("Title")} trailing={<CharCount count={captionLength(props.settings.pinterest.title)} limit={100} />}>
          <input
            class={fieldControl}
            placeholder={t("Give the pin a title")}
            value={props.settings.pinterest.title}
            onInput={(event) => set("pinterest", "title", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Field>
        <Field label={t("Link")}>
          <input
            class={fieldControl}
            type="url"
            placeholder="https://"
            value={props.settings.pinterest.link}
            onInput={(event) => set("pinterest", "link", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Field>
      </Match>
    </Switch>
  );

  const single = () => (props.only ? shown()[0] : undefined);

  return (
    <Show
      when={single()}
      keyed
      fallback={
        <div class="flex flex-col gap-2">
          <For each={shown()}>
            {(id) => (
              <div class="flex flex-col gap-3 rounded-xl border border-border-strong bg-accent/30 p-3">
                <div class="flex items-center gap-2">
                  <Show when={id !== "youtube"} fallback={<YouTubeIcon />}>
                    <PlatformLogo id={id} />
                  </Show>
                  <span class="text-xs font-medium text-foreground">{socialPlatform(id).name}</span>
                  <Show when={id === "tiktok"}>
                    <TikTokAccount creator={creator} />
                  </Show>
                </div>
                {fields(id)}
              </div>
            )}
          </For>
        </div>
      }
    >
      {(id) => (
        <div class="flex flex-col gap-4">
          <Show when={id === "tiktok" && (creator.info() || creator.loading())}>
            <div class="flex h-7 items-center gap-2">
              <span class="text-xs text-muted-foreground">{t("Posting as")}</span>
              <TikTokAccount creator={creator} />
            </div>
          </Show>
          {/* YouTube's form leads with its icon at the brand's minimum size (20 high), not a small tile. */}
          <Show when={id === "youtube"}>
            <div class="flex h-7 min-w-0 items-center gap-2">
              <YouTubeIcon label />
              <span class="text-xs font-medium text-foreground">{socialPlatform("youtube").name}</span>
              <span class="min-w-0 truncate text-xs text-muted-foreground">
                {(props.youtubeChannels?.() ?? []).map(accountLabel).filter(Boolean).join(", ")}
              </span>
            </div>
          </Show>
          {fields(id)}
        </div>
      )}
    </Show>
  );
}
