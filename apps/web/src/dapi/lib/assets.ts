/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getLibrary } from "@plan.video/runtime";
import { AssetLibrary, isAbsoluteSource, isUrlSource } from "@plan.video/assets";
import { DapiError } from "@plan.video/dapi";
import { createProjectFS } from "@/projects/fs";

import type { Asset } from "@plan.video/assets";
import type { ToolContext } from "../handler";

/**
 * Absolute paths and URLs are described without being added. With no project
 * open, a fresh throwaway library per request, so nothing is remembered between calls.
 */
export function resolveAsset(ctx: ToolContext, path: string): Promise<Asset> {
  const world = ctx.session()?.world;
  if (world) return getLibrary(world).resolve(path);
  if (!isAbsoluteSource(path) && !isUrlSource(path)) {
    throw new DapiError(
      "no-project",
      `Could not resolve "${path}": with no project open only absolute paths and URLs resolve — open a project to use library paths.`,
    );
  }
  return new AssetLibrary(createProjectFS("")).resolve(path);
}

export function requireAssetType<T extends Asset["type"]>(
  asset: Asset,
  types: readonly T[],
  expected: string,
): asserts asset is Extract<Asset, { type: T }> {
  if (!(types as readonly string[]).includes(asset.type)) {
    throw new DapiError("wrong-kind", `Asset ${asset.id} is not ${expected}.`);
  }
}
