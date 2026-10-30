/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";
import { cx } from "@/lib/cva";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { PromptInput } from "../genai/prompt-input";
import { ActionBar } from "../genai/action-bar";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Tool, ToolType } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";
import { useTool } from "@/engine";
import { setSidebarTab } from "@/agent-chat";
import { usePromptInput } from "@/context/prompt-input";
import { TOOLBAR_SLOTS, useLayout } from "@/context/layout";
import { TOOLBAR_SLOT_ANCHOR, TOOLBAR_SLOT_CLASS, isTopSlot } from "./toolbar-slot";
import { ZoomMenu } from "@/components/sidebar-right/inspector/inspector-header";
import { t } from "@/lib/i18n";
import { MoveIcon } from "./move-icon";
import HandIcon from "lucide-solid/icons/hand";
import FrameIcon from "lucide-solid/icons/frame";
import SquareIcon from "lucide-solid/icons/square";
import TypeIcon from "lucide-solid/icons/type";

import type { ToolbarSlot } from "@/context/layout";

/** How far the pointer goes, pressed on the toolbar, before the press is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * What floats over the canvas, at the bottom unless dragged to another of its
 * slots: the tools, and beside them the prompt for a generation or the
 * actions for what is selected.
 */
export function Toolbar() {
  const { promptInputOpen, promptInputConfig, openPromptInput } = usePromptInput();
  const { toolbarSlot, setToolbarSlot } = useLayout();

  // Dragged, the toolbar lifts off and follows the pointer, and the slots it
  // can go to show: the one nearest it at its size, where it lands when let
  // go of. It then glides in. Escape, or a cancelled pointer, sends it back.
  let toolbar!: HTMLDivElement;
  const [dropSlot, setDropSlot] = createSignal<ToolbarSlot>();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const dragging = () => dropSlot() !== undefined;
  /** Where the press began, and where in the toolbar it took hold of it. */
  let press: { x: number; y: number; pointerId: number; grabX: number; grabY: number } | undefined;

  const nearestSlot = (x: number, y: number, bounds: DOMRect) => {
    let nearest = toolbarSlot();
    let nearestDistance = Infinity;
    for (const slot of TOOLBAR_SLOTS) {
      const anchor = TOOLBAR_SLOT_ANCHOR[slot];
      const distance = Math.hypot(x - anchor.x * bounds.width, y - anchor.y * bounds.height);
      if (distance < nearestDistance) {
        nearest = slot;
        nearestDistance = distance;
      }
    }
    return nearest;
  };

  const stopListening = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("keydown", handleKeyDown, true);
  };

  /** Moves the toolbar into a slot, sliding it there from where it is now. */
  const settle = (slot: ToolbarSlot) => {
    const from = toolbar.getBoundingClientRect();
    setToolbarSlot(slot);
    setDropSlot(undefined);
    const to = toolbar.getBoundingClientRect();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    toolbar.animate(
      [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "translate(0, 0)" }],
      { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== press?.pointerId) return;
    if (!dragging()) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return;
      // Captured, the press no longer ends in a click on the button it began on.
      toolbar.setPointerCapture(event.pointerId);
      setSize({ width: toolbar.offsetWidth, height: toolbar.offsetHeight });
    }
    const bounds = toolbar.offsetParent!.getBoundingClientRect();
    const { width, height } = size();
    const x = Math.min(Math.max(event.clientX - bounds.left - press.grabX, 0), bounds.width - width);
    const y = Math.min(Math.max(event.clientY - bounds.top - press.grabY, 0), bounds.height - height);
    setPosition({ x, y });
    setDropSlot(nearestSlot(x + width / 2, y + height / 2, bounds));
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== press?.pointerId) return;
    press = undefined;
    stopListening();
    if (dragging()) settle(event.type === "pointerup" ? dropSlot()! : toolbarSlot());
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !dragging()) return;
    event.preventDefault();
    event.stopPropagation();
    press = undefined;
    stopListening();
    settle(toolbarSlot());
  };

  const handlePointerDown = (event: PointerEvent) => {
    // Menus open on the press: one begun on their trigger is theirs.
    if (event.button !== 0 || (event.target as Element).closest("[aria-haspopup]")) return;
    const rect = toolbar.getBoundingClientRect();
    press = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown, true);
  };

  // Hides tooltips meanwhile (index.css).
  createEffect(() => document.documentElement.toggleAttribute("data-toolbar-dragging", dragging()));

  onCleanup(() => {
    stopListening();
    document.documentElement.removeAttribute("data-toolbar-dragging");
  });

  // Up top, the menus open downwards, into the canvas.
  const top = () => isTopSlot(toolbarSlot());

  return (
    <>
      <Show when={promptInputOpen()}>
        <PromptInput initialConfig={promptInputConfig()} />
      </Show>
      <Show when={!promptInputOpen()}>
        <ActionBar openPromptInput={openPromptInput} />
      </Show>
      <Show when={dragging()}>
        <For each={TOOLBAR_SLOTS}>
          {(slot) => (
            <div
              class={cx(
                "absolute z-10 rounded-lg pointer-events-none transition-[width,background-color,border-color] duration-150",
                TOOLBAR_SLOT_CLASS[slot],
                slot === dropSlot()
                  ? "border border-dashed border-primary bg-primary/10"
                  : "border border-transparent bg-foreground/6",
              )}
              style={{
                width: `${slot === dropSlot() ? size().width : size().height}px`,
                height: `${size().height}px`,
              }}
            />
          )}
        </For>
      </Show>
      {/* Its own drag, never the browser's: no text selection, no dragged image or link. */}
      <div
        ref={toolbar}
        class={cx(
          "absolute z-10 flex items-center rounded-lg border border-border-input bg-background p-1 select-none touch-none",
          dragging()
            ? "cursor-grabbing shadow-[0_8px_24px_rgb(0_0_0/0.28)] [&_*]:cursor-grabbing"
            : TOOLBAR_SLOT_CLASS[toolbarSlot()],
        )}
        style={dragging() ? { left: `${position().x}px`, top: `${position().y}px` } : undefined}
        onPointerDown={handlePointerDown}
        onDragStart={(event) => event.preventDefault()}
      >
        <CanvasTools placement={top() ? "bottom-start" : "top-start"} />
        <Separator orientation="vertical" class="min-h-4 mx-1.5" />
        <ZoomMenu placement={top() ? "bottom-end" : "top-end"} />
      </div>
    </>
  );
}

/** The canvas tools, as a row of icon buttons: the picked one sits on a fill. */
export function CanvasTools(props: { placement?: "top-start" | "bottom-start" }) {
  const world = useWorld();
  const selectedTool = useTool();

  const handleToolChange = (tool: ToolType) => {
    world.set(Tool, { value: tool });
    if (tool === ToolType.SCENE) setSidebarTab("templates");
  }

  const toolClass = (on: boolean) => on
    ? "bg-secondary text-foreground hover:bg-secondary-hover"
    : "text-muted-foreground hover:text-foreground";

  const pointerTool = () => [ToolType.MOVE, ToolType.HAND].includes(selectedTool());

  return (
    <div class="flex items-center gap-0.5" data-tour="tools">
      <div class="flex items-center rounded-md" classList={{ "bg-secondary": pointerTool() }}>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon-square"
            variant="ghost"
            aria-label={selectedTool() === ToolType.HAND ? t('Hand') : t('Move')}
            class={pointerTool() ? "text-foreground hover:bg-secondary-hover" : "text-muted-foreground hover:text-foreground"}
            onClick={() => handleToolChange(
              selectedTool() === ToolType.HAND ? ToolType.HAND : ToolType.MOVE
            )}
          >
            <Show when={selectedTool() === ToolType.HAND} fallback={<MoveIcon />}>
              <HandIcon class="size-4" stroke-width={2} />
            </Show>
          </TooltipTrigger>
          <TooltipContent shortcut={selectedTool() === ToolType.HAND ? 'H' : 'V'}>
            {selectedTool() === ToolType.HAND ? t('Hand') : t('Move')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu placement={props.placement ?? "top-start"}>
          <Tooltip>
            <TooltipTrigger<typeof DropdownMenuTrigger>
              as={(triggerProps: object) => (
                <DropdownMenuTrigger<typeof Button>
                  {...triggerProps}
                  as={(buttonProps) => (
                    <Button {...buttonProps} size="icon-select" variant="ghost" aria-label={t("Select tool")} class="text-muted-foreground hover:bg-transparent hover:text-foreground data-[expanded]:bg-transparent">
                      <Icon name="chevron-down" />
                    </Button>
                  )}
                />
              )}
            />
            <TooltipContent>{t("Select tool")}</TooltipContent>
          </Tooltip>
          <DropdownMenuPortal>
            <DropdownMenuContent>
              <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.MOVE)}>
                <div classList={{ "visible": selectedTool() === ToolType.MOVE }} class="invisible">
                  <Icon name="confirm-check" class="text-foreground" />
                </div>
                <span class="grid size-6 place-items-center text-foreground"><MoveIcon /></span>
                <span class="min-w-12 mx-1">{t("Move")}</span>
                <DropdownMenuShortcut>V</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => handleToolChange(ToolType.HAND)}>
                <div classList={{ "visible": selectedTool() === ToolType.HAND }} class="invisible">
                  <Icon name="confirm-check" class="text-foreground" />
                </div>
                <span class="grid size-6 place-items-center text-foreground"><HandIcon class="size-4" stroke-width={2} /></span>
                <span class="min-w-12 mx-1">{t("Hand")}</span>
                <DropdownMenuShortcut>H</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
      <Separator orientation="vertical" class="min-h-4 mx-1.5" />
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon-square"
          variant="ghost"
          aria-label={t("Frame")}
          onClick={() => handleToolChange(ToolType.SCENE)}
          class={toolClass(selectedTool() === ToolType.SCENE)}
        >
          <FrameIcon class="size-4" stroke-width={2} />
        </TooltipTrigger>
        <TooltipContent shortcut="F">{t("Frame")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon-square"
          variant="ghost"
          aria-label={t("Rectangle")}
          onClick={() => handleToolChange(ToolType.RECT)}
          class={toolClass(selectedTool() === ToolType.RECT)}
        >
          <SquareIcon class="size-4" stroke-width={2} />
        </TooltipTrigger>
        <TooltipContent shortcut="R">{t("Rectangle")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon-square"
          variant="ghost"
          aria-label={t("Text")}
          onClick={() => handleToolChange(ToolType.TEXT)}
          class={toolClass(selectedTool() === ToolType.TEXT)}
        >
          <TypeIcon class="size-4" stroke-width={2} />
        </TooltipTrigger>
        <TooltipContent shortcut="T">{t("Text")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
