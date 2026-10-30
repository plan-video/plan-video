/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Library } from "@plan.video/runtime";
import { toast } from "somoto";

import { setSidebarTab } from "@/agent-chat";
import { importFiles, pickFiles } from "@/engine/asset-actions";
import { insertAsset } from "@/engine/insert-asset";
import { workflowScene } from "@/engine/workflow-capture";
import { mainClip, runWorkflow, runWorkflowOnAssets, type RunOptions } from "@/engine/workflow-run";
import { t } from "@/lib/i18n";

import { showWorkflow } from "./workflow-ui";

import type { Asset } from "@plan.video/assets";
import type { NewSceneOptions } from "@/engine/new-scene";
import type { Workflow } from "@/lib/workflows";
import type { World } from "koota";

export async function startWorkflow(
  world: World,
  workflow: Workflow,
  options: RunOptions & { assets?: Asset[]; sceneOptions?: NewSceneOptions },
): Promise<void> {
  const scene = workflowScene(world);
  if (scene && !options.assets && mainClip(world, scene)) {
    reveal(workflow);
    void runWorkflow(world, workflow, scene, options);
    return;
  }

  const library = world.get(Library);
  if (!library) return;
  const assets = options.assets ?? (await importFiles(library, await pickFiles({ multiple: false, accept: "video/*" }), ""));
  if (!assets.length) return;
  const video = assets.find((asset) => asset.type === "VIDEO");
  if (!video) {
    toast(t("Pick a video"), { description: t("A workflow works on a video clip.") });
    return;
  }

  reveal(workflow);
  if (!scene) {
    runWorkflowOnAssets(world, workflow, [video], options, options.sceneOptions);
    return;
  }
  if (!insertAsset(world, video, { parent: scene, start: 0 })) {
    toast(t("Nothing to insert into"), { description: t("Open a project first.") });
    return;
  }
  void runWorkflow(world, workflow, scene, options);
}

function reveal(workflow: Workflow) {
  showWorkflow(workflow.id);
  setSidebarTab("workflows");
}
