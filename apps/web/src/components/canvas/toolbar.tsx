/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cx } from "@/lib/cva";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PromptInput } from "../genai/prompt-input";
import { ActionBar } from "../genai/action-bar";
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Tool, ToolType } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";
import { getEditHistory, useTool } from "@/engine";
import { splitAtPlayhead } from "@/engine/split";
import { setSidebarTab } from "@/agent-chat";
import { usePromptInput } from "@/context/prompt-input";
import { TOOLBAR_SLOTS, useLayout } from "@/context/layout";
import { TOOLBAR_SLOT_ANCHOR, TOOLBAR_SLOT_CLASS, isTopSlot, useToolbarFloating } from "./toolbar-slot";
import { ZoomMenu } from "@/components/sidebar-right/inspector/inspector-header";
import { NetworkPreviewMenu } from "./network-preview";
import { t } from "@/lib/i18n";
import { shortcutLabel } from "@/lib/keymap";
import {
  ToolFrameIcon,
  ToolHandIcon,
  ToolMoveIcon,
  ToolRectangleIcon,
  ToolRedoIcon,
  ToolSplitIcon,
  ToolTextIcon,
  ToolUndoIcon,
} from "@/components/editor/rail-icons";

import type { ToolbarSlot } from "@/context/layout";

const DRAG_THRESHOLD = 4;

export function Toolbar() {
  const { promptInputOpen, promptInputConfig } = usePromptInput();
  const { toolbarSlot, setToolbarSlot } = useLayout();
  const floating = useToolbarFloating();

  let toolbar!: HTMLDivElement;
  const [dropSlot, setDropSlot] = createSignal<ToolbarSlot>();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const dragging = () => dropSlot() !== undefined;
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

  const top = () => isTopSlot(toolbarSlot());

  return (
    <>
      <Show when={promptInputOpen()}>
        <PromptInput initialConfig={promptInputConfig()} />
      </Show>
      <Show when={!promptInputOpen()}>
        <ActionBar />
      </Show>
      <Show when={floating() && dragging()}>
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
      <Show when={floating()}>
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
          <CanvasTools />
          <Separator orientation="vertical" class="min-h-4 mx-2" />
          <NetworkPreviewMenu placement={top() ? "bottom-end" : "top-end"} />
          <ZoomMenu placement={top() ? "bottom-end" : "top-end"} />
          <Separator orientation="vertical" class="min-h-4 mx-2" />
          <HistoryButtons />
        </div>
      </Show>
    </>
  );
}

function ToolButton(props: {
  label: string;
  shortcut?: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        as={Button}
        size="icon-square"
        variant="ghost"
        aria-label={props.label}
        disabled={props.disabled}
        class={cx("size-8 text-foreground hover:text-foreground", props.on && "bg-secondary hover:bg-secondary-hover")}
        onClick={props.onClick}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent shortcut={props.shortcut}>{props.label}</TooltipContent>
    </Tooltip>
  );
}

export function HistoryButtons() {
  const history = getEditHistory(useWorld());

  return (
    <div class="flex items-center gap-1">
      <ToolButton label={t("Undo")} shortcut="⌘Z" disabled={!history.canUndo()} onClick={() => history.undo()}>
        <ToolUndoIcon />
      </ToolButton>
      <ToolButton label={t("Redo")} shortcut="⇧⌘Z" disabled={!history.canRedo()} onClick={() => history.redo()}>
        <ToolRedoIcon />
      </ToolButton>
    </div>
  );
}

export function CanvasTools() {
  const world = useWorld();
  const selectedTool = useTool();

  const handleToolChange = (tool: ToolType) => {
    world.set(Tool, { value: tool });
    if (tool === ToolType.SCENE) setSidebarTab("templates");
  }

  return (
    <div class="flex items-center gap-1" data-tour="tools">
      <ToolButton
        label={t("Move")}
        shortcut={shortcutLabel("moveTool")}
        on={selectedTool() === ToolType.MOVE}
        onClick={() => handleToolChange(ToolType.MOVE)}
      >
        <ToolMoveIcon />
      </ToolButton>
      <ToolButton label={t("Split at playhead")} shortcut={shortcutLabel("split")} onClick={() => splitAtPlayhead(world)}>
        <ToolSplitIcon />
      </ToolButton>
      <ToolButton
        label={t("Hand")}
        shortcut={shortcutLabel("handTool")}
        on={selectedTool() === ToolType.HAND}
        onClick={() => handleToolChange(ToolType.HAND)}
      >
        <ToolHandIcon />
      </ToolButton>
      <Separator orientation="vertical" class="min-h-4 mx-2" />
      <ToolButton label={t("Frame")} shortcut="F" on={selectedTool() === ToolType.SCENE} onClick={() => handleToolChange(ToolType.SCENE)}>
        <ToolFrameIcon />
      </ToolButton>
      <ToolButton label={t("Rectangle")} shortcut="R" on={selectedTool() === ToolType.RECT} onClick={() => handleToolChange(ToolType.RECT)}>
        <ToolRectangleIcon />
      </ToolButton>
      <ToolButton label={t("Text")} shortcut="T" on={selectedTool() === ToolType.TEXT} onClick={() => handleToolChange(ToolType.TEXT)}>
        <ToolTextIcon />
      </ToolButton>
    </div>
  );
}
