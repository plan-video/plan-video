/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getParentNode, isScene, Source } from "@plan.video/runtime";
import { DapiError } from "@plan.video/dapi";
import { resolveNode } from "./nodes";

import type { Entity, World } from "koota";

/**
 * Scenes only: capture's frames must be an export's frames, and framing an
 * arbitrary node would run the project's code ahead of the frames being drawn,
 * which an export never does.
 */
export function requireScene(world: World, id: string, verb: string): Entity {
  const node = resolveNode(world, id);
  if (isScene(node)) return node;

  let scene = getParentNode(node);
  while (scene !== null && !isScene(scene)) scene = getParentNode(scene);
  const stamp = scene?.get(Source)?.value;
  throw new DapiError(
    "wrong-kind",
    stamp
      ? `"${id}" is not a scene — ${verb} renders what an export renders. ${capitalize(verb)} its scene "${stamp}" instead.`
      : `"${id}" is not a scene — ${verb} renders what an export renders, so it takes a scene id.`,
  );
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
