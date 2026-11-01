/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { toast } from "somoto";
import CheckIcon from "lucide-solid/icons/check";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronLeftIcon from "lucide-solid/icons/chevron-left";
import CircleAlertIcon from "lucide-solid/icons/circle-alert";
import CircleMinusIcon from "lucide-solid/icons/circle-minus";
import EllipsisIcon from "lucide-solid/icons/ellipsis";
import LoaderCircleIcon from "lucide-solid/icons/loader-circle";
import PlusIcon from "lucide-solid/icons/plus";

import { SidebarTabs } from "@/agent-chat";
import { useSchedulePost } from "@/components/editor/schedule-post-button";
import { Button } from "@/components/ui/button";
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
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/context/auth";
import { useDerived } from "@/engine/hooks";
import { workflowScene } from "@/engine/workflow-capture";
import { clearWorkflowRun, mainClip, stopWorkflow, workflowRun, type RunStep } from "@/engine/workflow-run";
import { DEFAULT_HIGHLIGHT, captionBrandStyle } from "@/lib/caption-brand";
import { askForAccount } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { loadTemplates, postTemplates, sortTemplates } from "@/lib/post-templates";
import {
  WORKFLOW_STEPS,
  activeSteps,
  deleteWorkflow,
  findWorkflow,
  loadWorkflows,
  renameWorkflow,
  restoreWorkflow,
  updateWorkflow,
  workflows,
  type Workflow,
  type WorkflowStepId,
} from "@/lib/workflows";

import { startWorkflow } from "./start";
import { STEP_INFO, StepIcon, StepValue, WorkflowArt, setSaveRequest, showWorkflow, shownWorkflowId, stepsLine } from "./workflow-ui";

export function WorkflowsPanel() {
  const auth = useAuth();
  createEffect(() => loadWorkflows(auth.user()?.id));
  createEffect(() => loadTemplates(auth.user()?.id));

  const shown = createMemo(() => {
    const id = shownWorkflowId();
    return id ? findWorkflow(id) : undefined;
  });

  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
        <div class="flex min-w-0 flex-1 items-center">
          <SidebarTabs />
        </div>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            aria-label={t("Save as workflow")}
            onClick={() => setSaveRequest({})}
          >
            <PlusIcon class="size-4" stroke-width={1.75} />
          </TooltipTrigger>
          <TooltipContent>{t("Save as workflow")}</TooltipContent>
        </Tooltip>
      </div>
      <Show when={shown()} keyed fallback={<WorkflowList />}>
        {(workflow) => <WorkflowDetail workflow={workflow} />}
      </Show>
    </div>
  );
}

function WorkflowList() {
  return (
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <For
        each={workflows()}
        fallback={
          <div class="m-1 flex flex-col gap-2.5 rounded-lg bg-accent p-3">
            <p class="text-xs text-muted-foreground">{t("Set a clip up the way you like it, then save it as a workflow to do it all again in one go.")}</p>
            <Button variant="secondary" class="w-full" onClick={() => setSaveRequest({})}>
              {t("Save as workflow")}
            </Button>
          </div>
        }
      >
        {(workflow) => <ListRow workflow={workflow} />}
      </For>
    </div>
  );
}

function ListRow(props: { workflow: Workflow }) {
  const running = () => {
    const run = workflowRun();
    return run?.state === "running" && run.workflowId === props.workflow.id;
  };
  return (
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-accent focus-ring"
      onClick={() => showWorkflow(props.workflow.id)}
    >
      <div class="h-12 w-[27px] shrink-0 overflow-hidden rounded-[4px] border border-border">
        <WorkflowArt workflow={props.workflow} />
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-450 text-foreground">{props.workflow.name}</div>
        <div class="truncate text-xs text-muted-foreground">{stepsLine(props.workflow) || t("No steps")}</div>
      </div>
      <Show when={running()}>
        <LoaderCircleIcon class="size-3.5 shrink-0 animate-spin text-muted-foreground" stroke-width={2} />
      </Show>
    </button>
  );
}

function rowsOf(workflow: Workflow): WorkflowStepId[] {
  const steps = workflow.steps;
  return WORKFLOW_STEPS.filter((id) => {
    if (id === "post") return true;
    if (id === "size") return !!steps.size && !steps.layout;
    if (id === "keywords" || id === "emoji") return !!steps.captions;
    return steps[id] !== undefined;
  });
}

function WorkflowDetail(props: { workflow: Workflow }) {
  const world = useWorld();
  const auth = useAuth();
  const schedulePost = useSchedulePost();

  const run = () => {
    const current = workflowRun();
    return current?.workflowId === props.workflow.id ? current : null;
  };
  const statusOf = (id: WorkflowStepId): RunStep | undefined => run()?.steps.find((step) => step.id === id);
  const waiting = () => run()?.steps.find((step) => step.status === "waiting");
  const notes = () => run()?.steps.filter((step) => step.note && step.id !== "post" && (step.status === "failed" || step.status === "done" || step.status === "skipped")) ?? [];
  const needsAccount = () => !auth.user() && run()?.state !== "running" && run()?.steps.some((step) => step.id === "captions" && step.status === "failed");
  const otherRunning = () => {
    const current = workflowRun();
    return current?.state === "running" && current.workflowId !== props.workflow.id ? current : null;
  };

  const target = useDerived(() => {
    const scene = workflowScene(world);
    return scene && mainClip(world, scene) ? scene : null;
  });

  const steps = () => activeSteps(props.workflow);

  const change = (next: Pick<Workflow, "steps" | "off">) => updateWorkflow(props.workflow.id, next);

  const setOn = (id: WorkflowStepId, on: boolean) => {
    const current = props.workflow;
    const nextSteps = { ...current.steps };
    if (on && id === "keywords" && !nextSteps.keywords) nextSteps.keywords = { color: captionBrandStyle()?.highlight ?? DEFAULT_HIGHLIGHT };
    if (on && id === "emoji" && !nextSteps.emoji) nextSteps.emoji = { on: true };
    const off = on ? current.off.filter((entry) => entry !== id) : [...current.off.filter((entry) => entry !== id), id];
    change({ steps: nextSteps, off });
  };

  const setPost = (template: Workflow["steps"]["post"]) => {
    const steps = { ...props.workflow.steps };
    if (template) steps.post = template;
    else delete steps.post;
    change({ steps, off: props.workflow.off.filter((entry) => entry !== "post") });
  };

  const start = () => void startWorkflow(world, props.workflow, { signedIn: !!auth.user() });

  const remove = () => {
    const removed = props.workflow;
    showWorkflow(null);
    deleteWorkflow(removed.id);
    toast(t("Workflow deleted"), { action: { label: t("Undo"), onClick: () => restoreWorkflow(removed) } });
  };

  const [renaming, setRenaming] = createSignal(false);

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            aria-label={t("All workflows")}
            onClick={() => showWorkflow(null)}
          >
            <ChevronLeftIcon class="size-4" stroke-width={1.75} />
          </TooltipTrigger>
          <TooltipContent>{t("All workflows")}</TooltipContent>
        </Tooltip>
        <Show
          when={renaming()}
          fallback={
            <span class="min-w-0 flex-1 truncate text-xs font-450" onDblClick={() => setRenaming(true)}>
              {props.workflow.name}
            </span>
          }
        >
          <input
            type="text"
            value={props.workflow.name}
            aria-label={t("Workflow name")}
            ref={(el) => queueMicrotask(() => el.select())}
            class="h-6 min-w-0 flex-1 rounded-md bg-input px-1.5 text-xs font-450 text-foreground outline-none focus-ring"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = props.workflow.name;
                event.currentTarget.blur();
              }
            }}
            onBlur={(event) => {
              renameWorkflow(props.workflow.id, event.currentTarget.value);
              setRenaming(false);
            }}
          />
        </Show>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger as={Button} size="icon" variant="ghost" class="text-muted-foreground" aria-label={t("More")}>
            <EllipsisIcon class="size-4" stroke-width={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-56">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>{t("Rename")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSaveRequest({ replace: props.workflow.id, name: props.workflow.name })}>
                {t("Update from this project")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={remove}>{t("Delete")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <div class="flex flex-col gap-0.5">
          <For each={run()?.steps.map((step) => step.id) ?? rowsOf(props.workflow)}>
            {(id) => (
              <StepRow
                workflow={props.workflow}
                id={id}
                on={steps().includes(id)}
                status={statusOf(id)}
                locked={!!run()}
                onToggle={(on) => setOn(id, on)}
                onPost={setPost}
              />
            )}
          </For>
        </div>
        <Show when={waiting()}>
          {(step) => (
            <div class="mx-1 mt-3 rounded-lg bg-accent p-3 text-xs text-foreground">
              {step().note}
            </div>
          )}
        </Show>
        <Show when={notes().length > 0}>
          <div class="mx-1 mt-3 flex flex-col gap-2.5 rounded-lg bg-accent p-3 text-xs">
            <For each={notes()}>
              {(step) => (
                <div class="flex flex-col gap-0.5">
                  <span class="font-450 text-foreground">{t(STEP_INFO[step.id].label)}</span>
                  <span classList={{ "text-destructive": step.status === "failed", "text-muted-foreground": step.status !== "failed" }}>{step.note}</span>
                </div>
              )}
            </For>
            <Show when={needsAccount()}>
              <Button variant="secondary" class="mt-1 w-full" onClick={() => askForAccount({ reason: "captions" })}>
                {t("Create account")}
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={otherRunning()}>
          {(other) => (
            <p class="mx-1 mt-3 text-xs text-muted-foreground">
              {t("“{name}” is running. Starting this one stops it.", { name: findWorkflow(other().workflowId)?.name ?? other().name })}
            </p>
          )}
        </Show>
      </div>

      <div class="flex shrink-0 flex-col gap-1.5 border-t border-border p-3">
        <Switch>
          <Match when={run()?.state === "running"}>
            <Button variant="secondary" class="w-full" onClick={stopWorkflow}>
              {t("Stop")}
            </Button>
          </Match>
          <Match when={run()}>
            {(finished) => (
              <>
                <Show when={finished().post && finished().state === "done"}>
                  <Button class="w-full" onClick={schedulePost}>
                    {t("Schedule post")}
                  </Button>
                </Show>
                <Button variant="secondary" class="w-full" onClick={clearWorkflowRun}>
                  {t("Done")}
                </Button>
              </>
            )}
          </Match>
          <Match when={true}>
            <Button class="w-full" disabled={steps().length === 0} onClick={start}>
              {target() ? t("Run on this clip") : t("Choose a clip")}
            </Button>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function StepRow(props: {
  workflow: Workflow;
  id: WorkflowStepId;
  on: boolean;
  status?: RunStep;
  locked: boolean;
  onToggle: (on: boolean) => void;
  onPost: (template: Workflow["steps"]["post"]) => void;
}) {
  const label = () => t(STEP_INFO[props.id].label);
  const dim = () => (props.locked ? props.status === undefined || props.status.status === "pending" : !props.on);

  return (
    <div class="flex h-8 min-w-0 items-center gap-2.5 rounded-md pl-2 pr-1.5" classList={{ "bg-accent": props.status?.status === "running" || props.status?.status === "waiting" }}>
      <span class="flex min-w-0 flex-1 items-center gap-2.5" classList={{ "text-disabled-foreground": dim(), "text-foreground": !dim() }}>
        <StepIcon step={props.id} class={dim() ? "size-3.5 shrink-0" : "size-3.5 shrink-0 text-muted-foreground"} />
        <span class="shrink-0 text-xs">{label()}</span>
        <Show
          when={props.id === "post" && !props.locked}
          fallback={
            <span
              class="min-w-0 flex-1 truncate text-right text-xs"
              classList={{ "text-muted-foreground": !dim() }}
            >
              <StepValue workflow={props.workflow} step={props.id} />
            </span>
          }
        >
          <PostPicker workflow={props.workflow} onPick={props.onPost} />
        </Show>
      </span>
      <Switch>
        <Match when={props.locked}>
          <StatusIcon status={props.status} />
        </Match>
        <Match when={props.id === "post"}>{null}</Match>
        <Match when={true}>
          <Toggle checked={props.on} onChange={props.onToggle} class="flex shrink-0 items-center">
            <SwitchInput aria-label={label()} />
            <SwitchControl variant="compact">
              <SwitchThumb variant="compact" />
            </SwitchControl>
          </Toggle>
        </Match>
      </Switch>
    </div>
  );
}

function StatusIcon(props: { status?: RunStep }) {
  return (
    <span class="grid size-4 shrink-0 place-items-center" title={props.status?.note}>
      <Switch>
        <Match when={props.status?.status === "pending"}>
          <span class="size-1 rounded-full bg-disabled-foreground" />
        </Match>
        <Match when={props.status?.status === "running" || props.status?.status === "waiting"}>
          <LoaderCircleIcon class="size-3.5 animate-spin text-foreground" stroke-width={2} />
        </Match>
        <Match when={props.status?.status === "done"}>
          <CheckIcon class="size-3.5 text-primary" stroke-width={2.25} />
        </Match>
        <Match when={props.status?.status === "skipped"}>
          <CircleMinusIcon class="size-3.5 text-muted-foreground" stroke-width={1.75} />
        </Match>
        <Match when={props.status?.status === "failed"}>
          <CircleAlertIcon class="size-3.5 text-destructive" stroke-width={1.75} />
        </Match>
      </Switch>
    </span>
  );
}

function PostPicker(props: { workflow: Workflow; onPick: (template: Workflow["steps"]["post"]) => void }) {
  const templates = createMemo(() => sortTemplates(postTemplates()));
  const chosen = () => props.workflow.steps.post;

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as="button"
        type="button"
        class="-mr-1 flex h-6 min-w-0 flex-1 items-center justify-end gap-0.5 rounded-md pl-1.5 pr-1 text-xs transition-colors hover:bg-accent focus-ring"
        classList={{ "text-muted-foreground": !!chosen(), "text-disabled-foreground": !chosen() }}
      >
        <span class="min-w-0 truncate">{chosen()?.name ?? t("None")}</span>
        <ChevronDownIcon class="size-3.5 shrink-0" stroke-width={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-60">
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel>{t("Post templates")}</DropdownMenuGroupLabel>
            <For each={templates()} fallback={<div class="px-2 py-1.5 text-xs text-muted-foreground">{t("No post templates yet. Make one under Templates on the dashboard.")}</div>}>
              {(template) => (
                <DropdownMenuItem onSelect={() => props.onPick(template)}>
                  <span class="min-w-0 flex-1 truncate">{template.name}</span>
                  <Show when={chosen()?.id === template.id}>
                    <CheckIcon class="size-3.5 shrink-0" stroke-width={2} />
                  </Show>
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onPick(undefined)}>
            <span class="min-w-0 flex-1">{t("None")}</span>
            <Show when={!chosen()}>
              <CheckIcon class="size-3.5 shrink-0" stroke-width={2} />
            </Show>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
