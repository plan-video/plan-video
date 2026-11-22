/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createMemo, createSignal, type JSX } from "solid-js";
import { useQuery, useTrait, useWorld } from "@plan.video/koota-solid";
import { ChildOf, Position, Root, Size, focusRect, getActiveEntity, getCameraMatrix, getEntityChildren, isScene } from "@plan.video/runtime";
import Bookmark from "lucide-solid/icons/bookmark";
import Camera from "lucide-solid/icons/camera";
import Disc3 from "lucide-solid/icons/disc-3";
import Ellipsis from "lucide-solid/icons/ellipsis";
import EllipsisVertical from "lucide-solid/icons/ellipsis-vertical";
import Forward from "lucide-solid/icons/forward";
import Heart from "lucide-solid/icons/heart";
import Maximize from "lucide-solid/icons/maximize";
import MessageCircle from "lucide-solid/icons/message-circle";
import Play from "lucide-solid/icons/play";
import Plus from "lucide-solid/icons/plus";
import Repeat2 from "lucide-solid/icons/repeat-2";
import Search from "lucide-solid/icons/search";
import Send from "lucide-solid/icons/send";
import Settings from "lucide-solid/icons/settings";
import Share2 from "lucide-solid/icons/share-2";
import SkipForward from "lucide-solid/icons/skip-forward";
import Smartphone from "lucide-solid/icons/smartphone";
import ThumbsDown from "lucide-solid/icons/thumbs-down";
import ThumbsUp from "lucide-solid/icons/thumbs-up";
import Volume2 from "lucide-solid/icons/volume-2";
import VolumeX from "lucide-solid/icons/volume-x";
import X from "lucide-solid/icons/x";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformLogo } from "@/components/publish/controls";
import { fitPadding, getDocumentEditor, useActiveScene, useCamera } from "@/engine";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import { NETWORK_PREVIEWS, postFrame, previewBounds, previewScreen, previewUnit } from "@/lib/network-previews";
import { socialPlatform } from "@/lib/social";

import type { Entity, World } from "koota";
import type { Insets, NetworkPreview } from "@/lib/network-previews";

const [previewId, setPreviewId] = createSignal<string | null>(null);

const currentPreview = () => NETWORK_PREVIEWS.find((preview) => preview.id === previewId()) ?? null;

const previewName = (preview: NetworkPreview) => preview.name ?? socialPlatform(preview.network).name;

const PREVIEW_GROUPS = [
  { id: "screen", label: msg("Full screen") },
  { id: "feed", label: msg("In the feed") },
] as const;

function previewedScene(world: World): Entity | null {
  return getActiveEntity(world) ?? getEntityChildren(world, world.get(Root)!).find((entity) => isScene(entity)) ?? null;
}

/** A vertical app's screen around a wide video, or a post around it, is bigger than the video: brought into view whole, and the scene alone again once it's off. */
function showPreview(world: World, preview: NetworkPreview | null): void {
  setPreviewId(preview?.id ?? null);
  const scene = previewedScene(world);
  const position = scene?.get(Position);
  const size = scene?.get(Size);
  if (!position || !size) return;
  const video = { x: position.x, y: position.y, width: size.width, height: size.height };
  focusRect(world, preview ? previewBounds(video, preview) : video, fitPadding(world));
  getDocumentEditor(world).reportEdit(world.get(Root)!, "camera", getCameraMatrix(world));
}

export function NetworkPreviewMenu(props: { placement?: "bottom-end" | "top-end" }) {
  const world = useWorld();
  const on = () => currentPreview();

  return (
    <DropdownMenu placement={props.placement ?? "top-end"}>
      <Tooltip placement="top">
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button
                  {...buttonProps}
                  variant="ghost"
                  aria-label={t("Preview on a network")}
                  class={cx(
                    "h-8 gap-0.5 px-1.5 text-foreground hover:text-foreground data-[expanded]:text-foreground",
                    on() && "bg-secondary hover:bg-secondary-hover",
                  )}
                >
                  <Show when={on()} fallback={<Smartphone class="size-4" stroke-width={2} />}>
                    {(preview) => <PlatformLogo id={preview().network} compact class="size-4 rounded-[4px]" />}
                  </Show>
                  <Icon name="chevron-down" class="size-5 shrink-0" />
                </Button>
              )}
            />
          )}
        />
        <TooltipPortal>
          <TooltipContent>{on() ? previewName(on()!) : t("Preview on a network")}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-52">
          <For each={PREVIEW_GROUPS}>
            {(group, index) => (
              <>
                <Show when={index() > 0}>
                  <DropdownMenuSeparator />
                </Show>
                <DropdownMenuGroup>
                  <DropdownMenuGroupLabel>{t(group.label)}</DropdownMenuGroupLabel>
                  <For each={NETWORK_PREVIEWS.filter((preview) => preview.group === group.id)}>
                    {(preview) => (
                      <DropdownMenuItem class="gap-2" onSelect={() => showPreview(world, preview)}>
                        <PlatformLogo id={preview.network} compact class="size-4 rounded-[4px]" />
                        <span class="min-w-0 flex-1 truncate">{previewName(preview)}</span>
                        <Show when={previewId() === preview.id}>
                          <Icon name="confirm-check" class="-my-1 -mr-1 shrink-0 text-foreground" />
                        </Show>
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuGroup>
              </>
            )}
          </For>
          <Show when={on()}>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => showPreview(world, null)}>{t("Turn off preview")}</DropdownMenuItem>
          </Show>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

export function NetworkPreviewOverlay() {
  return (
    <Show when={currentPreview()}>
      {(preview) => <SceneOverlay preview={preview()} />}
    </Show>
  );
}

function SceneOverlay(props: { preview: NetworkPreview }) {
  const world = useWorld();
  const active = useActiveScene();
  const roots = useQuery(ChildOf(world.get(Root)!));
  const scene = createMemo(() => (roots(), active() ?? previewedScene(world)));

  return (
    <Show when={scene()} keyed>
      {(entity) => <SceneFrame scene={entity} preview={props.preview} />}
    </Show>
  );
}

function SceneFrame(props: { scene: Entity; preview: NetworkPreview }) {
  const camera = useCamera();
  const position = useTrait(() => props.scene, Position);
  const size = useTrait(() => props.scene, Size);

  // Scenes are roots and never rotate, so their Position and Size are their place on the stage.
  const video = createMemo(() => {
    const { a = 1, d = 1, e = 0, f = 0 } = camera() ?? {};
    const { x = 0, y = 0 } = position() ?? {};
    const { width = 0, height = 0 } = size() ?? {};
    return { x: e + a * x, y: f + d * y, width: a * width, height: d * height };
  });
  const screen = createMemo(() => previewScreen(video(), props.preview.screen));
  // The video inside the screen, in shares of the screen.
  const inner = createMemo(() => {
    const s = screen();
    const v = video();
    if (s.width <= 0 || s.height <= 0) return { left: 0, top: 0, width: 1, height: 1 };
    return { left: (v.x - s.x) / s.width, top: (v.y - s.y) / s.height, width: v.width / s.width, height: v.height / s.height };
  });

  const px = (value: number) => `${value}px`;
  const share = (value: number) => `${value * 100}%`;
  const post = () => props.preview.screen === null;

  return (
    <div class="pointer-events-none absolute inset-0 z-2 overflow-hidden select-none" aria-hidden="true">
      <Show when={screen().width > 1 && screen().height > 1}>
        <div
          class="absolute font-sans leading-tight text-white"
          style={{
            left: px(screen().x),
            top: px(screen().y),
            width: px(screen().width),
            height: px(screen().height),
            "--u": px(previewUnit(video(), props.preview)),
          }}
        >
          <Show when={post()}>
            <PostCard preview={props.preview} />
          </Show>
          <div class="absolute inset-0 overflow-hidden">
            <Show when={!post()}>
              <div
                class="absolute"
                style={{
                  left: share(inner().left),
                  top: share(inner().top),
                  width: share(inner().width),
                  height: share(inner().height),
                  "box-shadow": "0 0 0 100vmax #000",
                }}
              />
            </Show>
            <SafeArea safe={props.preview.safe} />
          </div>
          <div class="absolute inset-0 [text-shadow:0_0_calc(var(--u)*0.6)_rgb(0_0_0/0.45)] [&_svg]:drop-shadow-[0_0_calc(var(--u)*0.5)_rgb(0_0_0/0.35)]">
            <Chrome preview={props.preview} />
          </div>
        </div>
      </Show>
    </div>
  );
}

function SafeArea(props: { safe: Insets }) {
  return (
    <div
      class="absolute rounded-[calc(var(--u)*1)] outline-[1.5px] outline-dashed outline-white/80"
      style={{
        left: `${props.safe.left * 100}%`,
        right: `${props.safe.right * 100}%`,
        top: `${props.safe.top * 100}%`,
        bottom: `${props.safe.bottom * 100}%`,
        "box-shadow": "0 0 0 100vmax rgb(0 0 0 / 0.3)",
      }}
    />
  );
}

type Place = { left?: number; right?: number; top?: number; bottom?: number };

/** Placed in --u: a hundredth of the app's screen, or of the column a post sits in, so it all scales with the zoom. */
function At(props: Place & { class?: string; children: JSX.Element }) {
  const cq = (value: number | undefined) => (value === undefined ? undefined : `calc(var(--u)*${value})`);
  return (
    <div
      class={cx("absolute", props.class)}
      style={{ left: cq(props.left), right: cq(props.right), top: cq(props.top), bottom: cq(props.bottom) }}
    >
      {props.children}
    </div>
  );
}

type IconComponent = (props: { class?: string; style?: JSX.CSSProperties; "stroke-width"?: number; fill?: string }) => JSX.Element;

function Glyph(props: { icon: IconComponent; size: number; fill?: boolean }) {
  return (
    <props.icon
      style={{ width: `calc(var(--u)*${props.size})`, height: `calc(var(--u)*${props.size})` }}
      stroke-width={2}
      fill={props.fill ? "currentColor" : "none"}
    />
  );
}

/** The column of buttons full-screen apps keep on the right. */
function Actions(props: { items: { icon: IconComponent; count?: string; fill?: boolean }[]; size: number; gap: number }) {
  return (
    <div class="flex flex-col items-center" style={{ gap: `calc(var(--u)*${props.gap})` }}>
      <For each={props.items}>
        {(item) => (
          <div class="flex flex-col items-center" style={{ gap: "calc(var(--u)*0.8)" }}>
            <Glyph icon={item.icon} size={props.size} fill={item.fill} />
            <Show when={item.count}>
              <span class="font-semibold" style={{ "font-size": "calc(var(--u)*3)" }}>{item.count}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function Avatar(props: { size: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <div
      class={cx("shrink-0 rounded-full bg-linear-to-br from-[#9aa4b2] to-[#5b6472] ring-white", props.class)}
      style={{ width: `calc(var(--u)*${props.size})`, height: `calc(var(--u)*${props.size})`, ...props.style }}
    />
  );
}

function Text(props: { size: number; class?: string; children: JSX.Element }) {
  return (
    <span class={cx("block truncate", props.class)} style={{ "font-size": `calc(var(--u)*${props.size})` }}>
      {props.children}
    </span>
  );
}

function Progress(props: { color: string; done: number; height: number }) {
  return (
    <div class="absolute inset-x-0 bottom-0 bg-white/30" style={{ height: `calc(var(--u)*${props.height})` }}>
      <div class="h-full" style={{ width: `${props.done * 100}%`, background: props.color }} />
    </div>
  );
}

function Chrome(props: { preview: NetworkPreview }) {
  return (
    <Switch>
      <Match when={props.preview.chrome === "tiktok"}>
        <TikTokChrome />
      </Match>
      <Match when={props.preview.chrome === "reels"}>
        <ReelsChrome />
      </Match>
      <Match when={props.preview.chrome === "story"}>
        <StoryChrome />
      </Match>
      <Match when={props.preview.chrome === "facebook-reels"}>
        <FacebookReelsChrome />
      </Match>
      <Match when={props.preview.chrome === "shorts"}>
        <ShortsChrome />
      </Match>
      <Match when={props.preview.chrome === "youtube"}>
        <YouTubeChrome />
      </Match>
      <Match when={props.preview.chrome === "post" || props.preview.chrome === "pin"}>
        <PostBadges />
      </Match>
    </Switch>
  );
}

function TikTokChrome() {
  return (
    <>
      <At left={0} right={0} top={5} class="flex items-center justify-center font-semibold" >
        <div class="flex items-center" style={{ gap: "calc(var(--u)*5)", "font-size": "calc(var(--u)*4.4)" }}>
          <span class="text-white/70">{t("Following")}</span>
          <span class="relative">
            {t("For You")}
            <span class="absolute inset-x-[25%] rounded-full bg-white" style={{ bottom: "calc(var(--u)*-1.6)", height: "calc(var(--u)*0.7)" }} />
          </span>
        </div>
      </At>
      <At right={4} top={5}>
        <Glyph icon={Search} size={6.5} />
      </At>
      <At right={2.5} bottom={24} class="flex flex-col items-center" >
        <div class="relative" style={{ "margin-bottom": "calc(var(--u)*5)" }}>
          <Avatar size={11} class="ring-[calc(var(--u)*0.4)]" />
          <div
            class="absolute left-1/2 grid -translate-x-1/2 place-items-center rounded-full bg-[#fe2c55]"
            style={{ bottom: "calc(var(--u)*-2.2)", width: "calc(var(--u)*4.6)", height: "calc(var(--u)*4.6)" }}
          >
            <Glyph icon={Plus} size={3.4} />
          </div>
        </div>
        <Actions
          size={8.5}
          gap={3.6}
          items={[
            { icon: Heart, count: "84.2K", fill: true },
            { icon: MessageCircle, count: "1,204", fill: true },
            { icon: Bookmark, count: "9,310", fill: true },
            { icon: Forward, count: "2,877", fill: true },
          ]}
        />
      </At>
      <At right={3} bottom={8}>
        <div class="grid place-items-center rounded-full bg-[#222]" style={{ width: "calc(var(--u)*10)", height: "calc(var(--u)*10)" }}>
          <Avatar size={5.5} />
        </div>
      </At>
      <At left={4} right={20} bottom={7} class="flex flex-col" >
        <div style={{ gap: "calc(var(--u)*1.4)" }} class="flex flex-col">
          <Text size={4.4} class="font-semibold">{t("Your name")}</Text>
          <Text size={3.9}>{t("Your caption shows here")} #fyp</Text>
          <div class="flex items-center" style={{ gap: "calc(var(--u)*1.6)" }}>
            <Glyph icon={Disc3} size={3.8} />
            <Text size={3.6}>{t("Original sound")}</Text>
          </div>
        </div>
      </At>
      <Progress color="rgb(255 255 255 / 0.9)" done={0.35} height={0.5} />
    </>
  );
}

function ReelsChrome() {
  return (
    <>
      <At left={4} top={5}>
        <Text size={6} class="font-bold">{t("Reels")}</Text>
      </At>
      <At right={4} top={5}>
        <Glyph icon={Camera} size={7} />
      </At>
      <At right={3.5} bottom={10}>
        <div class="flex flex-col items-center" style={{ gap: "calc(var(--u)*5)" }}>
          <Actions
            size={7.5}
            gap={4.5}
            items={[
              { icon: Heart, count: "84.2K" },
              { icon: MessageCircle, count: "1,204" },
              { icon: Repeat2, count: "512" },
              { icon: Send, count: "2,877" },
              { icon: Ellipsis },
            ]}
          />
          <div class="rounded-[calc(var(--u)*1.4)] border-[calc(var(--u)*0.5)] border-white bg-[#5b6472]" style={{ width: "calc(var(--u)*7)", height: "calc(var(--u)*7)" }} />
        </div>
      </At>
      <At left={4} right={18} bottom={8}>
        <div class="flex flex-col" style={{ gap: "calc(var(--u)*2.4)" }}>
          <div class="flex items-center" style={{ gap: "calc(var(--u)*2.4)" }}>
            <Avatar size={8} />
            <Text size={4} class="font-semibold">{t("Your name")}</Text>
            <span class="shrink-0 rounded-[calc(var(--u)*1.6)] border border-white/80 font-semibold" style={{ "font-size": "calc(var(--u)*3.4)", padding: "calc(var(--u)*0.8) calc(var(--u)*2.6)" }}>
              {t("Follow")}
            </span>
          </div>
          <Text size={3.9}>{t("Your caption shows here")}</Text>
          <div class="flex items-center" style={{ gap: "calc(var(--u)*1.6)" }}>
            <Glyph icon={Disc3} size={3.6} />
            <Text size={3.5}>{t("Original sound")}</Text>
          </div>
        </div>
      </At>
    </>
  );
}

function StoryChrome() {
  return (
    <>
      <At left={2} right={2} top={2.5}>
        <div class="flex" style={{ gap: "calc(var(--u)*1)" }}>
          <div class="h-[calc(var(--u)*0.6)] flex-1 rounded-full bg-white" />
          <div class="h-[calc(var(--u)*0.6)] flex-1 overflow-hidden rounded-full bg-white/40">
            <div class="h-full w-2/5 bg-white" />
          </div>
          <div class="h-[calc(var(--u)*0.6)] flex-1 rounded-full bg-white/40" />
        </div>
      </At>
      <At left={3.5} right={3.5} top={6} class="flex items-center" >
        <div class="flex min-w-0 flex-1 items-center" style={{ gap: "calc(var(--u)*2.4)" }}>
          <Avatar size={8.5} />
          <Text size={3.9} class="font-semibold">{t("Your name")}</Text>
          <Text size={3.6} class="shrink-0 text-white/70">2h</Text>
        </div>
        <div class="flex items-center" style={{ gap: "calc(var(--u)*4)" }}>
          <Glyph icon={Ellipsis} size={6} />
          <Glyph icon={X} size={7} />
        </div>
      </At>
      <At left={3.5} right={3.5} bottom={4} class="flex items-center" >
        <div class="flex w-full items-center" style={{ gap: "calc(var(--u)*4)" }}>
          <div
            class="flex min-w-0 flex-1 items-center rounded-full border border-white/70"
            style={{ height: "calc(var(--u)*11)", padding: "0 calc(var(--u)*4.5)" }}
          >
            <Text size={3.9}>{t("Send message")}</Text>
          </div>
          <Glyph icon={Heart} size={7} />
          <Glyph icon={Send} size={7} />
        </div>
      </At>
    </>
  );
}

function FacebookReelsChrome() {
  return (
    <>
      <At left={4} top={5}>
        <Text size={6} class="font-bold">{t("Reels")}</Text>
      </At>
      <At right={4} top={5} class="flex" >
        <div class="flex" style={{ gap: "calc(var(--u)*5)" }}>
          <Glyph icon={Search} size={6.5} />
          <Glyph icon={Camera} size={6.5} />
        </div>
      </At>
      <At right={3.5} bottom={14}>
        <Actions
          size={8}
          gap={4.5}
          items={[
            { icon: ThumbsUp, count: "84K" },
            { icon: MessageCircle, count: "1.2K" },
            { icon: Share2, count: "2.8K" },
            { icon: Ellipsis },
          ]}
        />
      </At>
      <At left={4} right={20} bottom={9}>
        <div class="flex flex-col" style={{ gap: "calc(var(--u)*2.4)" }}>
          <div class="flex items-center" style={{ gap: "calc(var(--u)*2.4)" }}>
            <Avatar size={8.5} />
            <Text size={4} class="font-semibold">{t("Your name")}</Text>
            <span class="shrink-0 rounded-[calc(var(--u)*1.4)] bg-white/25 font-semibold" style={{ "font-size": "calc(var(--u)*3.4)", padding: "calc(var(--u)*0.8) calc(var(--u)*2.6)" }}>
              {t("Follow")}
            </span>
          </div>
          <Text size={3.9}>{t("Your caption shows here")}</Text>
        </div>
      </At>
      <Progress color="#fff" done={0.35} height={0.6} />
    </>
  );
}

function ShortsChrome() {
  return (
    <>
      <At right={4} top={5} class="flex" >
        <div class="flex" style={{ gap: "calc(var(--u)*6)" }}>
          <Glyph icon={Search} size={6.5} />
          <Glyph icon={EllipsisVertical} size={6.5} />
        </div>
      </At>
      <At right={3} bottom={9}>
        <div class="flex flex-col items-center" style={{ gap: "calc(var(--u)*5)" }}>
          <Actions
            size={8}
            gap={4.5}
            items={[
              { icon: ThumbsUp, count: "84K", fill: true },
              { icon: ThumbsDown, fill: true },
              { icon: MessageCircle, count: "1,204", fill: true },
              { icon: Forward, count: "2,877", fill: true },
              { icon: Repeat2 },
            ]}
          />
          <div class="rounded-[calc(var(--u)*1.4)] border-[calc(var(--u)*0.5)] border-white bg-[#5b6472]" style={{ width: "calc(var(--u)*8)", height: "calc(var(--u)*8)" }} />
        </div>
      </At>
      <At left={4} right={20} bottom={7}>
        <div class="flex flex-col" style={{ gap: "calc(var(--u)*2.6)" }}>
          <Text size={4.1}>{t("Your caption shows here")}</Text>
          <div class="flex items-center" style={{ gap: "calc(var(--u)*2.4)" }}>
            <Avatar size={8} />
            <Text size={4} class="font-semibold">{t("Your name")}</Text>
            <span class="shrink-0 rounded-full bg-white font-semibold text-black [text-shadow:none]" style={{ "font-size": "calc(var(--u)*3.4)", padding: "calc(var(--u)*1.2) calc(var(--u)*3.4)" }}>
              {t("Subscribe")}
            </span>
          </div>
        </div>
      </At>
      <Progress color="#ff0033" done={0.35} height={0.6} />
    </>
  );
}

function YouTubeChrome() {
  return (
    <>
      <div class="absolute inset-x-0 top-0 bg-linear-to-b from-black/60 to-transparent" style={{ height: "calc(var(--u)*12)" }} />
      <div class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent" style={{ height: "calc(var(--u)*14)" }} />
      <At left={2.5} right={2.5} top={2}>
        <Text size={2.4} class="font-medium">{t("Your caption shows here")}</Text>
      </At>
      <At left={2.5} right={2.5} bottom={5.6}>
        <div class="relative rounded-full bg-white/30" style={{ height: "calc(var(--u)*0.45)" }}>
          <div class="h-full w-[35%] rounded-full bg-[#ff0033]" />
          <div class="absolute top-1/2 -translate-1/2 rounded-full bg-[#ff0033]" style={{ left: "35%", width: "calc(var(--u)*1.3)", height: "calc(var(--u)*1.3)" }} />
        </div>
      </At>
      <At left={2.5} right={2.5} bottom={1.4} class="flex items-center" >
        <div class="flex w-full items-center" style={{ gap: "calc(var(--u)*2.6)" }}>
          <Glyph icon={Play} size={2.6} fill />
          <Glyph icon={SkipForward} size={2.4} fill />
          <Glyph icon={Volume2} size={2.6} />
          <Text size={1.7} class="tabular-nums">0:42 / 2:10</Text>
          <div class="flex-1" />
          <Glyph icon={Settings} size={2.4} />
          <Glyph icon={Maximize} size={2.4} />
        </div>
      </At>
    </>
  );
}

function PostBadges() {
  return (
    <>
      <At left={3} bottom={3}>
        <span class="block rounded-[calc(var(--u)*1)] bg-black/60 font-medium tabular-nums [text-shadow:none]" style={{ "font-size": "calc(var(--u)*3)", padding: "calc(var(--u)*0.5) calc(var(--u)*1.4)" }}>
          0:42
        </span>
      </At>
      <At right={3} bottom={3}>
        <div class="grid place-items-center rounded-full bg-black/60" style={{ width: "calc(var(--u)*6.5)", height: "calc(var(--u)*6.5)" }}>
          <Glyph icon={VolumeX} size={3.6} />
        </div>
      </At>
    </>
  );
}

const CARD = "bg-black";

/** The post around the video: everything here sits outside it, so nothing covers what's being edited. */
function PostCard(props: { preview: NetworkPreview }) {
  const network = () => props.preview.network;
  const frame = () => postFrame(props.preview);
  const indented = () => frame().left > frame().right;
  const pin = () => props.preview.chrome === "pin";
  const pad = () => frame().left;
  const head = () => frame().top - 3;
  const foot = () => frame().bottom;
  const side = () => frame().right;

  const actions = (): IconComponent[] =>
    network() === "facebook" || network() === "linkedin"
      ? [ThumbsUp, MessageCircle, Repeat2, Send]
      : [MessageCircle, Repeat2, Heart, Share2];

  const cq = (value: number) => `calc(var(--u)*${value})`;

  return (
    <div class="absolute rounded-[calc(var(--u)*3)] text-white outline outline-white/15" style={{ left: cq(-pad()), right: cq(-side()), top: cq(-head() - 3), bottom: cq(-foot()) }}>
      <div class={cx("absolute inset-x-0 top-0 rounded-t-[calc(var(--u)*3)]", CARD)} style={{ height: cq(head() + 3) }} />
      <div class={cx("absolute inset-x-0 bottom-0 rounded-b-[calc(var(--u)*3)]", CARD)} style={{ height: cq(foot()) }} />
      <div class={cx("absolute left-0", CARD)} style={{ top: cq(head() + 3), bottom: cq(foot()), width: cq(pad()) }} />
      <div class={cx("absolute right-0", CARD)} style={{ top: cq(head() + 3), bottom: cq(foot()), width: cq(side()) }} />

      <Show when={!pin()}>
        <Show
          when={indented()}
          fallback={
            <div class="absolute flex flex-col" style={{ left: cq(4), right: cq(4), top: cq(3), gap: cq(2.4) }}>
              <div class="flex items-center" style={{ gap: cq(2.4) }}>
                <Avatar size={9} />
                <div class="min-w-0 flex-1">
                  <Text size={3.6} class="font-semibold">{t("Your name")}</Text>
                  <Text size={3} class="text-white/55">1m</Text>
                </div>
                <Glyph icon={Ellipsis} size={5} />
              </div>
              <Text size={3.6}>{t("Your caption shows here")}</Text>
            </div>
          }
        >
          <div class="absolute" style={{ left: cq(3), top: cq(3) }}>
            <Avatar size={10} />
          </div>
          <div class="absolute flex flex-col" style={{ left: cq(pad()), right: cq(side()), top: cq(3), gap: cq(1.6) }}>
            <div class="flex items-center" style={{ gap: cq(1.6) }}>
              <Text size={3.6} class="font-semibold">{t("Your name")}</Text>
              <Text size={3.4} class="shrink-0 text-white/55">· 1m</Text>
              <div class="flex-1" />
              <Glyph icon={Ellipsis} size={5} />
            </div>
            <Text size={3.6}>{t("Your caption shows here")}</Text>
          </div>
        </Show>
        <div class="absolute flex items-center justify-between text-white/65" style={{ left: cq(pad()), right: cq(side() + 4), bottom: cq(3.5) }}>
          <For each={actions()}>{(icon) => <Glyph icon={icon} size={5} />}</For>
        </div>
      </Show>

      <Show when={pin()}>
        <div class="absolute inset-x-0 bottom-0 flex flex-col" style={{ padding: `${cq(2.5)} ${cq(1)}`, gap: cq(1.6) }}>
          <div class="flex items-center">
            <Text size={4} class="min-w-0 flex-1 font-semibold">{t("Your caption shows here")}</Text>
            <Glyph icon={Ellipsis} size={5} />
          </div>
          <div class="flex items-center" style={{ gap: cq(2) }}>
            <Avatar size={6} />
            <Text size={3.4} class="text-white/70">{t("Your name")}</Text>
          </div>
        </div>
      </Show>
    </div>
  );
}
