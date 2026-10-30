/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the workflow pieces share: each step's name, icon and what it is set
// to in words, the picture a workflow's card shows, and which workflow the
// panel has open.

import { Match, Show, Switch, createSignal, type Component } from "solid-js";
import CalendarClockIcon from "lucide-solid/icons/calendar-clock";
import CaptionsIcon from "lucide-solid/icons/captions";
import GanttIcon from "lucide-solid/icons/chart-no-axes-gantt";
import HighlighterIcon from "lucide-solid/icons/highlighter";
import PaletteIcon from "lucide-solid/icons/palette";
import PanelsTopLeftIcon from "lucide-solid/icons/panels-top-left";
import RectangleVerticalIcon from "lucide-solid/icons/rectangle-vertical";
import StickerIcon from "lucide-solid/icons/sticker";
import WorkflowIcon from "lucide-solid/icons/workflow";
import ZoomInIcon from "lucide-solid/icons/zoom-in";

import { CAPTION_PRESET_OPTIONS } from "@/components/sidebar-right/inspector/caption-types";
import { lookLabel } from "@/components/sidebar-right/inspector/grade-looks";
import { ALL_PRESETS } from "@/lib/layout-presets";
import { msg, t } from "@/lib/i18n";
import { getStreamLayout } from "@/lib/stream-layouts";
import { activeSteps, isStarter, type StarterArt, type Workflow, type WorkflowStepId } from "@/lib/workflows";

type IconProps = { class?: string; "stroke-width"?: number };

export const STEP_INFO: Record<WorkflowStepId, { label: string; icon: Component<IconProps> }> = {
  size: { label: msg("Size"), icon: RectangleVerticalIcon },
  layout: { label: msg("Layout"), icon: PanelsTopLeftIcon },
  grade: { label: msg("Color grade"), icon: PaletteIcon },
  autoZoom: { label: msg("Auto zoom"), icon: ZoomInIcon },
  captions: { label: msg("Captions"), icon: CaptionsIcon },
  keywords: { label: msg("Keywords in color"), icon: HighlighterIcon },
  emoji: { label: msg("Emoji"), icon: StickerIcon },
  progressBar: { label: msg("Progress bar"), icon: GanttIcon },
  post: { label: msg("Post to"), icon: CalendarClockIcon },
};

export function StepIcon(props: { step: WorkflowStepId; class?: string }) {
  const Icon = STEP_INFO[props.step].icon;
  return <Icon class={props.class ?? "size-3.5 shrink-0"} stroke-width={1.75} />;
}

const STRENGTHS: Record<string, string> = { subtle: msg("Subtle"), medium: msg("Medium"), strong: msg("Strong") };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What `step` is set to, in a few words; empty when its name says it all. */
export function stepValue(workflow: Workflow, step: WorkflowStepId): string {
  const steps = workflow.steps;
  switch (step) {
    case "size": {
      const size = steps.size;
      if (!size) return "";
      const preset = ALL_PRESETS.find((item) => item.width === size.width && item.height === size.height);
      return preset ? t(preset.label) : `${size.width}×${size.height}`;
    }
    case "layout":
      return steps.layout ? t(getStreamLayout(steps.layout.id).label) : "";
    case "grade": {
      const look = steps.grade?.look;
      return (look && lookLabel(look) && t(lookLabel(look)!)) || t("Custom");
    }
    case "autoZoom":
      return steps.autoZoom ? t(STRENGTHS[steps.autoZoom.strength] ?? "") : "";
    case "captions": {
      const props = steps.captions?.look.props ?? {};
      if (typeof props.look === "string" && props.look) return capitalize(props.look.replace(/[-_]/g, " "));
      const preset = CAPTION_PRESET_OPTIONS.find((option) => option.name === (props.preset ?? "classic"));
      return preset ? t(preset.label) : t("Custom");
    }
    case "progressBar":
      return steps.progressBar?.position === "top" ? t("Top") : t("Bottom");
    case "post":
      return steps.post?.name ?? t("None");
    default:
      return "";
  }
}

/** What `step` is set to, as the rows show it: in words, or for keywords, their colour. */
export function StepValue(props: { workflow: Workflow; step: WorkflowStepId }) {
  return (
    <Show when={props.step === "keywords" && props.workflow.steps.keywords} fallback={stepValue(props.workflow, props.step)}>
      {(keywords) => (
        <span
          class="inline-block size-2.5 rounded-full align-middle"
          style={{ background: `#${keywords().color.toString(16).padStart(6, "0")}` }}
        />
      )}
    </Show>
  );
}

/** A workflow's steps by name, for the line under it in a list. */
export function stepsLine(workflow: Workflow): string {
  return activeSteps(workflow)
    .filter((step) => step !== "keywords" && step !== "emoji")
    .map((step) => (step === "size" || step === "layout" ? stepValue(workflow, step) : t(STEP_INFO[step].label)))
    .join(" · ");
}

/* The picture on a workflow's card */

const ART: Record<StarterArt, string> = {
  stream: "/site/stream.webp",
  talking: "/site/creator.webp",
  podcast: "/site/vlogger.webp",
  travel: "/site/surf.webp",
};

/**
 * A workflow's card picture, 9:16: the still it was saved with, or for a
 * starter, footage with what the starter puts on it drawn over. `size` is
 * the card's height in pixels, which the type on it follows.
 */
export function WorkflowArt(props: { workflow: Workflow; height: number }) {
  const scale = () => props.height / 185;
  const px = (value: number) => `${Math.max(6, Math.round(value * scale()))}px`;

  return (
    <div class="relative size-full overflow-hidden bg-[#000]" aria-hidden="true">
      <Switch fallback={<Placeholder />}>
        <Match when={isStarter(props.workflow) && props.workflow}>
          {(starter) => (
            <>
              <img src={ART[starter().art]} alt="" draggable={false} class="absolute inset-0 size-full object-cover" classList={{ "saturate-[1.15] sepia-[.18]": starter().art === "travel" }} />
              {/* Too small to read in a list row: the footage says enough there. */}
              <Switch>
                <Match when={props.height < 90}>{null}</Match>
                <Match when={starter().art === "stream"}>
                  <Words size={px(12)} top="58%" words={["NO", "WAY", "HE", "HIT"]} hit={3} color="#FFCC00" />
                </Match>
                <Match when={starter().art === "talking"}>
                  <div class="absolute inset-x-1 text-center font-bold leading-tight text-white" style={{ top: "72%", "font-size": px(11), "text-shadow": "0 1px 2px rgba(0,0,0,.6)" }}>
                    this <span class="rounded-[3px] bg-[#FFD60A] px-[3px] text-[#111]">changed</span> everything
                  </div>
                </Match>
                <Match when={starter().art === "podcast"}>
                  <Words size={px(12)} top="64%" words={["I", "ALMOST", "QUIT"]} hit={1} color="#24D5FF" />
                  <div class="absolute inset-x-0 bottom-0 h-[3%] bg-white/30">
                    <div class="h-full w-[42%] bg-white" />
                  </div>
                </Match>
                <Match when={starter().art === "travel"}>
                  <div class="absolute inset-x-0 bottom-0 h-[2%] bg-white/25">
                    <div class="h-full w-[38%] bg-white" />
                  </div>
                </Match>
              </Switch>
            </>
          )}
        </Match>
        <Match when={props.workflow.thumb}>
          {(thumb) => <img src={thumb()} alt="" draggable={false} class="absolute inset-0 size-full object-cover" />}
        </Match>
      </Switch>
    </div>
  );
}

function Words(props: { words: string[]; hit: number; color: string; size: string; top: string }) {
  return (
    <div
      class="absolute inset-x-1 text-center font-extrabold uppercase leading-[1.1] tracking-[-0.01em] text-white"
      style={{ top: props.top, "font-size": props.size, "-webkit-text-stroke": `calc(${props.size} / 4.5) #000`, "paint-order": "stroke fill" }}
    >
      {props.words.map((word, index) => (
        <>
          <span style={index === props.hit ? { color: props.color } : undefined}>{word}</span>
          {index < props.words.length - 1 ? " " : ""}
        </>
      ))}
    </div>
  );
}

function Placeholder() {
  return (
    <div class="absolute inset-0 grid place-items-center bg-accent text-muted-foreground">
      <WorkflowIcon class="size-5" stroke-width={1.5} />
    </div>
  );
}

/* Panel state, shared with the canvas picker and the project menu */

const [openId, setOpenId] = createSignal<string | null>(null);
/** The workflow the Workflows panel shows; null for the list. */
export { openId as shownWorkflowId, setOpenId as showWorkflow };

export type SaveRequest = { replace?: string; name?: string };
const [saveRequest, setSaveRequest] = createSignal<SaveRequest | null>(null);
/** The Save as workflow dialog: open with what it should do, null while closed. */
export { saveRequest, setSaveRequest };
