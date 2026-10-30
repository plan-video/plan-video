/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";
import { importFiles as importFilesInto, pickFiles, saveAssetAs as saveAs } from "@plan.video/assets";
import { t } from "@/lib/i18n";
import { insertAsset } from "./insert-asset";
import { forgetAssetMedia } from "./timeline/media";
import { forgetAssetPeaks } from "./timeline/peaks";

import type { World } from "koota";

import type { Asset, AssetLibrary } from "@plan.video/assets";

export { droppedFiles, pickFiles } from "@plan.video/assets";

export async function saveAssetAs(asset: Pick<Asset, "handle" | "mimeType" | "path">): Promise<void> {
  try {
    await saveAs(asset);
  } catch (error) {
    toast.error(t("Failed to save"), { description: (error as Error).message });
  }
}

export async function importFiles(library: AssetLibrary, files: ReadonlyArray<File>, folder: string): Promise<Asset[]> {
  const report = await importFilesInto(library, files, folder);

  if (report.unnamed.length) {
    toast(t("Some files could not be imported"), { description: t("Only files on this computer can be added to the library.") });
  }
  for (const { source, error } of report.failed) {
    toast.error(t("Could not import {name}", { name: source.split(/[\\/]/).pop() }), { description: error.message });
  }
  return report.assets;
}

export async function pickAndImport(library: AssetLibrary, folder: string): Promise<Asset[]> {
  return importFiles(library, await pickFiles(), folder);
}

/** The JSX keeps naming the asset by path. A browser upload is copied into the project first. */
export async function replaceAssetSource(library: AssetLibrary, asset: Asset): Promise<Asset | null> {
  const [file] = await pickFiles({ multiple: false });
  if (!file) return null;
  try {
    let path = library.fs.pathOf?.(file) ?? null;
    if (!path) {
      path = `assets/${file.name || "file"}`;
      await library.fs.write(path, file);
    }
    const relinked = await library.relink(asset, path);
    // The timeline's cached picture and waveform are of the old file.
    forgetAssetMedia(asset.id);
    forgetAssetPeaks(asset.id);
    return relinked;
  } catch (error) {
    toast.error(t("Failed to replace"), { description: (error as Error).message });
    return null;
  }
}

export function insertAssetAtPlayhead(world: World, asset: Asset): void {
  if (!insertAsset(world, asset)) {
    toast(t("Nothing to insert into"), { description: t("Open a project first.") });
  }
}

