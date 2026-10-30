/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { toast } from "somoto";
import CheckIcon from "lucide-solid/icons/check";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";

import { setSidebarTab, sidebarTab } from "@/agent-chat";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxControl, CheckboxInput } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useAuth } from "@/context/auth";
import { useEngineContext } from "@/engine/context";
import { readSceneSteps, sceneStill, workflowScene } from "@/engine/workflow-capture";
import { stopWorkflow, workflowRun } from "@/engine/workflow-run";
import { t } from "@/lib/i18n";
import { loadTemplates, postTemplates, sortTemplates, type PostTemplate } from "@/lib/post-templates";
import {
  WORKFLOW_STEPS,
  canSaveWorkflows,
  cleanName,
  createWorkflow,
  findWorkflow,
  loadWorkflows,
  replaceWorkflow,
  type WorkflowStepId,
  type WorkflowSteps,
} from "@/lib/workflows";

import { STEP_INFO, StepIcon, StepValue, saveRequest, setSaveRequest, showWorkflow } from "./workflow-ui";
import { workflowName } from "./workflows-panel";

/**
 * Everything workflows need while the editor is open, whichever panel is
 * showing: the Save as workflow dialog, a word when a run ends out of sight,
 * and stopping a run when the editor closes.
 */
export function WorkflowsHost() {
  const auth = useAuth();
  createEffect(() => loadWorkflows(auth.user()?.id));
  onCleanup(stopWorkflow);

  // A run can take minutes (captions): say when it ends if its panel isn't open.
  createEffect(
    on(
      () => workflowRun()?.state,
      (state, previous) => {
        const run = workflowRun();
        if (!run || previous !== "running" || state !== "done" || sidebarTab() === "workflows") return;
        const failed = run.steps.filter((step) => step.status === "failed").length;
        const show = () => {
          showWorkflow(run.workflowId);
          setSidebarTab("workflows");
        };
        const workflow = findWorkflow(run.workflowId);
        const name = workflow ? workflowName(workflow) : run.name;
        if (failed) toast.error(t("{name} finished with a problem", { name }), { action: { label: t("Show"), onClick: show } });
        else toast.success(t("{name} is done", { name }), { action: { label: t("Show"), onClick: show } });
      },
    ),
  );

  return <SaveWorkflowDialog />;
}

/** Steps a project can be saved with, in run order; where it posts is picked on its own row. */
const KEPT: WorkflowStepId[] = WORKFLOW_STEPS.filter((id) => id !== "post");

function SaveWorkflowDialog() {
  const world = useWorld();
  const auth = useAuth();
  const engine = useEngineContext();

  const [found, setFound] = createSignal<WorkflowSteps | null>(null);
  const [kept, setKept] = createSignal<Set<WorkflowStepId>>(new Set());
  const [post, setPost] = createSignal<PostTemplate | undefined>();
  const [name, setName] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  createEffect(() => loadTemplates(auth.user()?.id));

  // Read the project each time the dialog opens.
  createEffect(
    on(saveRequest, (request) => {
      if (!request) return;
      setFound(null);
      setName(request.name ?? "");
      setSaving(false);
      const scene = workflowScene(world);
      if (!scene) {
        setFound({});
        setKept(new Set<WorkflowStepId>());
        setPost(undefined);
        return;
      }
      void readSceneSteps(world, scene).then((steps) => {
        if (saveRequest() !== request) return;
        setFound(steps);
        setKept(new Set(KEPT.filter((id) => steps[id] !== undefined)));
        setPost(steps.post ?? (request.replace ? findWorkflow(request.replace)?.steps.post : undefined));
      });
    }),
  );

  // What the dialog lists: what was found. A layout sets the size, so the size row only shows
  // without one; it is kept either way, for when the layout is turned off later.
  const rows = createMemo(() => {
    const steps = found();
    if (!steps) return [];
    return KEPT.filter((id) => steps[id] !== undefined && !(id === "size" && steps.layout));
  });
  const preview = createMemo(() => ({ id: "", name: "", steps: { ...found(), post: post() }, off: [], createdAt: "", updatedAt: "" }));

  const steps = (): WorkflowSteps => {
    const all = found() ?? {};
    const picked = kept();
    const out: WorkflowSteps = {};
    for (const id of KEPT) {
      if (!picked.has(id) || all[id] === undefined) continue;
      (out as Record<string, unknown>)[id] = all[id];
    }
    const chosen = post();
    if (chosen) out.post = chosen;
    return out;
  };
  const canSave = () => !!cleanName(name()) && !!found() && Object.keys(steps()).length > 0 && !saving();

  const toggle = (id: WorkflowStepId, on: boolean) =>
    setKept((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const close = () => setSaveRequest(null);

  const save = async () => {
    const request = saveRequest();
    if (!request || !canSave()) return;
    if (!canSaveWorkflows()) {
      toast.error(t("Could not save the workflow"), { description: t("Sign in to keep workflows.") });
      return;
    }
    setSaving(true);
    const thumb = await sceneStill(world, (rect) => engine.snapshot(rect));
    const kept = steps();
    const id = request.replace && replaceWorkflow(request.replace, name(), kept, thumb) ? request.replace : createWorkflow(name(), kept, thumb)?.id;
    setSaving(false);
    if (!id) {
      toast.error(t("Could not save the workflow"));
      return;
    }
    close();
    toast.success(request.replace ? t("Workflow updated") : t("Workflow saved"));
    showWorkflow(id);
    setSidebarTab("workflows");
  };

  return (
    <Dialog open={saveRequest() !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent class="w-[420px] max-w-[calc(100%-2rem)] gap-5 p-5">
        <DialogHeader>
          <DialogTitle class="text-[13px] font-medium">{saveRequest()?.replace ? t("Update workflow") : t("Save as workflow")}</DialogTitle>
        </DialogHeader>

        <form
          class="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">{t("Name")}</span>
            <input
              type="text"
              value={name()}
              placeholder={t("Gaming clips")}
              maxLength={40}
              autofocus
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => event.stopPropagation()}
              class="h-8 rounded-md bg-input px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-ring"
            />
          </label>

          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">{t("Keeps")}</span>
            <Show
              when={found()}
              fallback={<div class="h-24 animate-pulse rounded-lg bg-accent" />}
            >
              <div class="flex flex-col rounded-lg bg-accent p-1">
                <For
                  each={rows()}
                  fallback={<p class="px-2 py-2.5 text-xs text-muted-foreground">{t("Nothing to keep yet. Add a clip and give it a layout, captions or a grade first.")}</p>}
                >
                  {(id) => (
                    <Checkbox checked={kept().has(id)} onChange={(on: boolean) => toggle(id, on)} class="flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 hover:bg-accent">
                      <CheckboxInput aria-label={t(STEP_INFO[id].label)} />
                      <CheckboxControl />
                      <span class="flex min-w-0 flex-1 items-center gap-2.5" classList={{ "text-disabled-foreground": !kept().has(id) }}>
                        <StepIcon step={id} class="size-3.5 shrink-0 text-muted-foreground" />
                        <span class="shrink-0 text-xs">{t(STEP_INFO[id].label)}</span>
                        <span class="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"><StepValue workflow={preview()} step={id} /></span>
                      </span>
                    </Checkbox>
                  )}
                </For>
                <div class="mx-2 my-1 h-px bg-border" />
                <div class="flex h-8 items-center gap-2.5 px-2">
                  <StepIcon step="post" class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="shrink-0 text-xs">{t("Post to")}</span>
                  <PostSelect value={post()} onChange={setPost} />
                </div>
              </div>
            </Show>
          </div>

          <DialogFooter class="gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!canSave()}>
              {saveRequest()?.replace ? t("Update workflow") : t("Save workflow")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PostSelect(props: { value?: PostTemplate; onChange: (template: PostTemplate | undefined) => void }) {
  const templates = createMemo(() => sortTemplates(postTemplates()));
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as="button"
        type="button"
        class="-mr-1 flex h-6 min-w-0 flex-1 items-center justify-end gap-0.5 rounded-md pl-1.5 pr-1 text-xs transition-colors hover:bg-accent focus-ring"
        classList={{ "text-muted-foreground": !!props.value, "text-disabled-foreground": !props.value }}
      >
        <span class="min-w-0 truncate">{props.value?.name ?? t("None")}</span>
        <ChevronDownIcon class="size-3.5 shrink-0" stroke-width={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="z-[60] w-60">
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel>{t("Post templates")}</DropdownMenuGroupLabel>
            <For each={templates()} fallback={<div class="px-2 py-1.5 text-xs text-muted-foreground">{t("No post templates yet. Make one under Templates on the dashboard.")}</div>}>
              {(template) => (
                <DropdownMenuItem onSelect={() => props.onChange(template)}>
                  <span class="min-w-0 flex-1 truncate">{template.name}</span>
                  <Show when={props.value?.id === template.id}>
                    <CheckIcon class="size-3.5 shrink-0" stroke-width={2} />
                  </Show>
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onChange(undefined)}>
            <span class="min-w-0 flex-1">{t("None")}</span>
            <Show when={!props.value}>
              <CheckIcon class="size-3.5 shrink-0" stroke-width={2} />
            </Show>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
