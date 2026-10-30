/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Assets } from "./assets";
import { TemplatePanel } from "./templates";
import { TextPanel } from "./text-presets";
import { ExtensionsPanel } from "./extensions";
import { TransitionsPanel } from "./transitions-panel";
import { EffectsPanel } from "./effects-panel";
import { WorkflowsPanel } from "@/components/workflows/workflows-panel";
import { sidebarTab } from "@/agent-chat";
import { useLayout } from "@/context/layout";
import { useEditorApi } from "@/dapi";
import { createSignal, Show } from "solid-js";
import { toast } from "somoto";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { ProjectMenu } from "./project-menu";
import { useProject } from "@/context/project";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { WindowsTitleBar } from "../ui/windows-title-bar";
import { Wordmark } from "../brand/logo";

export function SidebarLeft() {
  return (
    <div class="flex flex-col h-full overflow-hidden" data-tour="sidebar">
      <div classList={{ contents: sidebarTab() === "assets", hidden: sidebarTab() !== "assets" }}>
        <Assets />
      </div>
      <Show when={sidebarTab() === "workflows"}>
        <WorkflowsPanel />
      </Show>
      <Show when={sidebarTab() === "text"}>
        <TextPanel />
      </Show>
      <Show when={sidebarTab() === "transitions"}>
        <TransitionsPanel />
      </Show>
      <Show when={sidebarTab() === "effects"}>
        <EffectsPanel />
      </Show>
      <Show when={sidebarTab() === "templates"}>
        <TemplatePanel />
      </Show>
      <Show when={sidebarTab() === "extensions"}>
        <ExtensionsPanel />
      </Show>
    </div>
  );
}

function LayoutToggles() {
  const { toggleTimeline, toggleUI } = useLayout();

  return (
    <div class="flex items-center gap-1 relative z-30" style="-webkit-app-region: no-drag;">
      <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleTimeline}>
        <Icon name="sidebar-timeline" />
      </Button>
      <Button variant="ghost" size="icon" class="text-muted-foreground" onClick={toggleUI}>
        <Icon name="sidebar" />
      </Button>
    </div>
  )
}

type EditorTitleBarProps = {
  leftWidth: number;
  controlsWidth: number;
}

export function EditorTitleBar(props: EditorTitleBarProps) {
  return (
    <WindowsTitleBar
      leftWidth={props.leftWidth}
      controlsWidth={props.controlsWidth}
      class="bg-background"
      left={
        <>
          <div class="flex shrink-0 items-center" style="-webkit-app-region: no-drag;">
            <ProjectMenu />
          </div>
          <Wordmark class="min-w-0 flex-1 truncate text-xs" />
          <LayoutToggles />
        </>
      }
    >
      <div
        class="absolute left-1/2 top-1/2 flex max-w-[30%] -translate-x-1/2 -translate-y-1/2"
        style="-webkit-app-region: no-drag;"
      >
        <ProjectNameInput class="ml-0 w-auto min-w-8 max-w-full field-sizing-content text-center" />
      </div>
    </WindowsTitleBar>
  )
}

type ProjectNameInputProps = {
  class?: string;
}

export function ProjectNameInput(props: ProjectNameInputProps) {
  const project = useProject();
  const [projectNameDraft, setProjectNameDraft] = createSignal<string | null>(null);

  const handleProjectNameInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setProjectNameDraft(event.currentTarget.value);
  };

  const handleFocusNameInput = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    setProjectNameDraft(project.name());
    event.currentTarget.select();
  };

  const handleBlurNameInput = () => {
    setProjectNameDraft(null);
  };

  const handleKeyDownNameInput = async (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Enter") {
      const input = event.currentTarget;
      const trimmedName = projectNameDraft()?.trim() ?? "";

      // The project keeps its id through the rename, so the URL and the open editor are untouched.
      if (trimmedName.length > 0 && trimmedName !== project.name()) {
        try {
          await project.rename(trimmedName);
        } catch (e) {
          toast.error(t("Failed to rename project"), { description: (e as Error).message });
        }
      }

      setProjectNameDraft(null);
      input.blur();
    }

    if (event.key === "Escape") {
      event.currentTarget.blur();
      setProjectNameDraft(null);
    }
  };

  return (
    <input
      type="text"
      value={projectNameDraft() ?? project.name()}
      onInput={handleProjectNameInput}
      onFocus={handleFocusNameInput}
      onBlur={handleBlurNameInput}
      onKeyDown={handleKeyDownNameInput}
      placeholder={t("Project name")}
      class={cx("w-full bg-transparent focus-ring px-1 h-5 ml-1 rounded text-xs text-muted-foreground font-450 outline-none", props.class)}
    />
  )
}

export function FloatingProjectHeader() {
  const { isDesktop } = useEditorApi();
  const { toggleUI } = useLayout();

  return (
    <div data-desktop={isDesktop} class="h-10 rounded-lg border border-border shrink-0 flex items-center px-2 gap-1 fixed top-4 data-[desktop=true]:top-10 left-4 z-30 bg-background shadow-lg">
      <ProjectMenu />
      <Wordmark class="text-xs" />
      <Button variant="ghost" size="icon" class="text-muted-foreground ml-2" onClick={toggleUI}>
        <Icon name="sidebar" />
      </Button>
    </div>
  )
}
