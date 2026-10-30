/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Switch, onCleanup, onMount } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { MARK_PATH } from "@/components/brand/logo";
import { PanelSection } from "@/components/ui/panel-section";
import {
  activeLayout,
  getLayoutFrame,
  layoutCropsPx,
  layoutSlots,
  layoutTarget,
  previewPlatform,
  setPreviewPlatform,
  type PreviewPlatform,
} from "@/engine/stream-layout";
import { CROP_COLORS, CROP_LABELS, LAYOUT_HEIGHT, LAYOUT_WIDTH, drawLayout } from "@/lib/stream-layouts";
import { msg, t } from "@/lib/i18n";

import type { JSX } from "solid-js";

const PLATFORMS: { id: PreviewPlatform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "shorts", label: "Shorts" },
  { id: "reels", label: "Reels" },
  { id: "none", label: msg("Clean") },
];

/** What the layout being set up looks like on a phone, with the app's buttons over it. */
export function LayoutPreviewPanel(): JSX.Element {
  const world = useWorld();
  let canvasRef!: HTMLCanvasElement;

  onMount(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const target = layoutTarget();
      const ctx = canvasRef.getContext("2d");
      if (!target || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvasRef.clientWidth * dpr);
      const height = Math.round((width * LAYOUT_HEIGHT) / LAYOUT_WIDTH);
      if (canvasRef.width !== width || canvasRef.height !== height) {
        canvasRef.width = width;
        canvasRef.height = height;
      }

      const frame = getLayoutFrame(world);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (!frame) return;
      drawLayout(ctx, frame, layoutSlots(), layoutCropsPx(), target.source, width / LAYOUT_WIDTH);
    };
    raf = requestAnimationFrame(draw);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <PanelSection title={t("Preview")}>
      <div class="flex gap-0.5 rounded-md bg-input p-0.5" role="tablist">
        <For each={PLATFORMS}>
          {(platform) => (
            <button
              type="button"
              role="tab"
              aria-selected={previewPlatform() === platform.id}
              class="h-6 flex-1 rounded text-[11px] transition-colors"
              classList={{
                "bg-background text-foreground": previewPlatform() === platform.id,
                "text-muted-foreground hover:text-foreground": previewPlatform() !== platform.id,
              }}
              style={{ cursor: "pointer" }}
              onClick={() => setPreviewPlatform(platform.id)}
            >
              {t(platform.label)}
            </button>
          )}
        </For>
      </div>

      <div class="relative w-full overflow-hidden rounded-xl border border-border bg-black" style={{ "aspect-ratio": "9 / 16" }}>
        <canvas ref={canvasRef} class="absolute inset-0 size-full" />
        <Switch>
          <Match when={previewPlatform() === "tiktok"}>
            <TikTokChrome />
          </Match>
          <Match when={previewPlatform() === "shorts"}>
            <ShortsChrome />
          </Match>
          <Match when={previewPlatform() === "reels"}>
            <ReelsChrome />
          </Match>
        </Switch>
      </div>

      <div class="flex flex-col gap-1.5">
        <For each={activeLayout().crops.filter((spec) => layoutCropsPx()[spec.id])}>
          {(spec) => (
            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span class="size-2 shrink-0 rounded-full" style={{ "background-color": CROP_COLORS[spec.id] }} />
              <span class="flex-1 truncate">{t(CROP_LABELS[spec.id])}</span>
              <span class="text-muted-foreground/55">{cropSize(spec.id)}</span>
            </div>
          )}
        </For>
      </div>
    </PanelSection>
  );
}

function cropSize(id: keyof ReturnType<typeof layoutCropsPx>): string {
  const box = layoutCropsPx()[id];
  return box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "";
}

// App chrome, drawn in the 1080×1920 space the layout is in. Shapes only:
// enough to show what the buttons and captions cover.

const HEART = "M50 88C20 66 4 50 4 32 4 17 16 6 30 6c9 0 16 5 20 12 4-7 11-12 20-12 14 0 26 11 26 26 0 18-16 34-46 56z";
const BUBBLE = "M50 8c25 0 44 16 44 38S75 84 50 84c-6 0-12-1-17-3L12 92l6-20C10 65 6 56 6 46 6 24 25 8 50 8z";
const BOOKMARK = "M22 6h56v88L50 72 22 94z";
const SHARE = "M56 10l40 36-40 36V60C30 60 14 68 4 88c4-30 20-52 52-56z";
const THUMB = "M8 44h18v48H8zM32 44L52 8c8 0 12 6 10 16l-4 16h28c6 0 10 6 8 12l-10 34c-2 4-6 6-10 6H32z";
const PLANE = "M92 8L8 42l34 14 14 34z";

function Icon(props: { d: string; x: number; y: number; size: number; outline?: boolean; rotate?: number }) {
  const scale = () => props.size / 100;
  return (
    <path
      d={props.d}
      transform={`translate(${props.x - props.size / 2} ${props.y - props.size / 2}) rotate(${props.rotate ?? 0} ${props.size / 2} ${props.size / 2}) scale(${scale()})`}
      fill={props.outline ? "none" : "white"}
      stroke={props.outline ? "white" : "none"}
      stroke-width={props.outline ? 8 : 0}
      stroke-linejoin="round"
    />
  );
}

function Label(props: { x: number; y: number; children: string; size?: number; weight?: number; anchor?: "start" | "middle" | "end"; opacity?: number }) {
  return (
    <text
      x={props.x}
      y={props.y}
      fill="white"
      fill-opacity={props.opacity ?? 1}
      font-family="Inter, sans-serif"
      font-size={String(props.size ?? 30)}
      font-weight={String(props.weight ?? 600)}
      text-anchor={props.anchor ?? "start"}
    >
      {props.children}
    </text>
  );
}

/** The profile picture: the app icon's mark on a white circle. The mark's viewBox is 32 wide, centred on 16. */
function Avatar(props: { cx: number; cy: number; r: number; ring?: boolean }) {
  const scale = () => (props.r * 2 * 0.62) / 32;
  return (
    <g>
      <circle
        cx={props.cx}
        cy={props.cy}
        r={props.r}
        fill="white"
        stroke={props.ring ? "white" : "none"}
        stroke-width={props.ring ? 4 : 0}
      />
      <path
        d={MARK_PATH}
        fill="black"
        transform={`translate(${props.cx} ${props.cy}) scale(${scale()}) translate(-16 -16)`}
      />
    </g>
  );
}

function Chrome(props: { children: JSX.Element }) {
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${LAYOUT_WIDTH} ${LAYOUT_HEIGHT}`}
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
    >
      <defs>
        <linearGradient id="chrome-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="black" stop-opacity="0" />
          <stop offset="1" stop-color="black" stop-opacity="0.45" />
        </linearGradient>
      </defs>
      <rect x="0" y="1380" width={LAYOUT_WIDTH} height="540" fill="url(#chrome-fade)" />
      {props.children}
    </svg>
  );
}

function TikTokChrome() {
  const x = 990;
  return (
    <Chrome>
      <Label x={430} y={130} size={36} opacity={0.6}>{t("Following")}</Label>
      <Label x={640} y={130} size={36}>{t("For You")}</Label>
      <rect x={672} y={150} width={70} height={6} rx={3} fill="white" />

      <Avatar cx={x} cy={1010} r={52} ring />
      <circle cx={x} cy={1062} r={20} fill="#fe2c55" />
      <rect x={x - 10} y={1059} width={20} height={6} fill="white" />
      <rect x={x - 3} y={1052} width={6} height={20} fill="white" />
      <Icon d={HEART} x={x} y={1190} size={84} />
      <Label x={x} y={1270} size={26} anchor="middle">12.4K</Label>
      <Icon d={BUBBLE} x={x} y={1350} size={80} />
      <Label x={x} y={1430} size={26} anchor="middle">318</Label>
      <Icon d={BOOKMARK} x={x} y={1505} size={70} />
      <Label x={x} y={1585} size={26} anchor="middle">1.2K</Label>
      <Icon d={SHARE} x={x} y={1660} size={76} />
      <Label x={x} y={1740} size={26} anchor="middle">{t("Share")}</Label>
      <circle cx={x} cy={1820} r={42} fill="#333" stroke="#555" stroke-width={12} />

      <Label x={40} y={1690} size={36} weight={700}>@plan.video</Label>
      <Label x={40} y={1748} size={30} weight={400}>{t("Your caption goes here")}</Label>
      <Label x={40} y={1806} size={28} weight={400} opacity={0.85}>{t("♫ Original sound")}</Label>
    </Chrome>
  );
}

function ShortsChrome() {
  const x = 985;
  return (
    <Chrome>
      <circle cx={880} cy={110} r={26} fill="none" stroke="white" stroke-width={7} />
      <rect x={898} y={126} width={8} height={30} rx={4} fill="white" transform="rotate(-45 902 141)" />
      <circle cx={1000} cy={90} r={7} fill="white" />
      <circle cx={1000} cy={112} r={7} fill="white" />
      <circle cx={1000} cy={134} r={7} fill="white" />

      <Icon d={THUMB} x={x} y={1080} size={78} />
      <Label x={x} y={1160} size={26} anchor="middle">12K</Label>
      <Icon d={THUMB} x={x} y={1240} size={78} rotate={180} />
      <Label x={x} y={1320} size={26} anchor="middle">{t("Dislike")}</Label>
      <Icon d={BUBBLE} x={x} y={1400} size={78} />
      <Label x={x} y={1480} size={26} anchor="middle">318</Label>
      <Icon d={SHARE} x={x} y={1560} size={74} />
      <Label x={x} y={1640} size={26} anchor="middle">{t("Share")}</Label>
      <rect x={x - 40} y={1700} width={80} height={80} rx={14} fill="#d9d9d9" stroke="white" stroke-width={4} />

      <Avatar cx={80} cy={1690} r={40} />
      <Label x={140} y={1702} size={32} weight={600}>@plan.video</Label>
      <rect x={420} y={1656} width={190} height={68} rx={34} fill="white" />
      <text x={515} y={1701} fill="black" font-family="Inter, sans-serif" font-size="28" font-weight="600" text-anchor="middle">
        {t("Subscribe")}
      </text>
      <Label x={40} y={1800} size={32} weight={400}>{t("Your title goes here")}</Label>
    </Chrome>
  );
}

function ReelsChrome() {
  const x = 995;
  return (
    <Chrome>
      <Label x={40} y={130} size={52} weight={700}>Reels</Label>
      <rect x={930} y={84} width={80} height={62} rx={16} fill="none" stroke="white" stroke-width={7} />
      <circle cx={970} cy={115} r={16} fill="none" stroke="white" stroke-width={7} />

      <Icon d={HEART} x={x} y={1220} size={76} outline />
      <Label x={x} y={1300} size={26} anchor="middle">12.4K</Label>
      <Icon d={BUBBLE} x={x} y={1380} size={74} outline />
      <Label x={x} y={1460} size={26} anchor="middle">318</Label>
      <Icon d={PLANE} x={x} y={1540} size={72} outline />
      <Label x={x} y={1620} size={26} anchor="middle">1.2K</Label>
      <circle cx={x} cy={1680} r={6} fill="white" />
      <circle cx={x - 22} cy={1680} r={6} fill="white" />
      <circle cx={x + 22} cy={1680} r={6} fill="white" />
      <rect x={x - 36} y={1752} width={72} height={72} rx={14} fill="#d9d9d9" stroke="white" stroke-width={4} />

      <Avatar cx={76} cy={1710} r={36} />
      <Label x={130} y={1722} size={32} weight={600}>plan.video</Label>
      <rect x={330} y={1680} width={130} height={60} rx={14} fill="none" stroke="white" stroke-width={4} />
      <Label x={395} y={1721} size={28} anchor="middle">{t("Follow")}</Label>
      <Label x={40} y={1810} size={30} weight={400}>{t("Your caption goes here")}</Label>
    </Chrome>
  );
}
