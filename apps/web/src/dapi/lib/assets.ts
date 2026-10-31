/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetLibrary, isAbsoluteSource, isUrlSource } from "@plan.video/assets";
import { DapiError } from "@plan.video/dapi";
import { createBrowserProjectFS } from "@/projects/browser";

import type { Asset } from "@plan.video/assets";

/** Described without being added: a fresh throwaway library per request, so nothing is remembered between calls. */
export function resolveAsset(path: string): Promise<Asset> {
  if (!isAbsoluteSource(path) && !isUrlSource(path)) {
    throw new DapiError("invalid-input", `Could not resolve "${path}": only absolute paths and URLs resolve.`);
  }
  return new AssetLibrary(createBrowserProjectFS("")).resolve(path);
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
