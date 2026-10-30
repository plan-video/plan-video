/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { For, Show, Match, Switch, createMemo, createResource, createSignal, type Accessor } from "solid-js";
import {
  formatAspectRatio,
  formatBytes,
  formatChannels,
  formatDuration,
  formatMimeTypeLabel,
  formatAssetDate
} from "@/utils/formatters";
import { AssetInfoPreview } from "./asset-info-preview";
import { msg, t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { settled } from "@/utils/signal";
import { toClientConfig } from "@/components/genai/use-generation-records";
import { useWorld } from "@plan.video/koota-solid";
import { assetName } from "@plan.video/assets";
import { useLibrary } from "@/engine/library";
import { useAssetSelection } from "@/engine/hooks";
import { insertAssetAtPlayhead, replaceAssetSource } from "@/engine/asset-actions";
import { retryGeneration } from "@/engine/generations";

import type { Asset, PartialAsset } from "@plan.video/assets";

/** Information about the library entry picked in the assets panel. */
export function AssetInfoPanel() {
  const selection = useAssetSelection();

  return (
    <Show when={selection.partial()} fallback={<AssetDetails />}>
      {(partial) => <PartialDetails partial={partial()} />}
    </Show>
  );
}

/**
 * A generation without bytes: where it stands, and — once it has failed —
 * the reason, and the way to ask again.
 */
function PartialDetails(props: { partial: PartialAsset }) {
  const world = useWorld();
  const library = useLibrary();

  const failed = () => props.partial.state === "error";

  const handleRetry = async () => {
    const lib = library();
    if (lib) await retryGeneration(world, lib, props.partial);
  };

  const handleDelete = async () => {
    await library()?.remove([props.partial]);
  };

  return (
    <div class="flex flex-col w-full px-4 border-t border-border">
      <div class="h-12 flex items-center justify-between">
        <span class="text-base font-strong">{t("Information")}</span>
      </div>

      <div class="py-3 border-t border-b border-border text-xs break-all">
        {assetName(props.partial)}
      </div>

      <div class="flex flex-col gap-1 my-2 text-xs text-muted-foreground">
        <div class="flex h-7 items-center gap-2">
          <span class="w-20 shrink-0">{t("Status")}</span>
          <span class="min-w-0 flex-1 text-right" classList={{ "text-destructive": failed() }}>
            {failed() ? t("Failed") : t("Generating…")}
          </span>
        </div>
        <Show when={props.partial.error}>
          {(error) => (
            <div class="flex flex-col gap-2 py-1">
              <span class="w-20 shrink-0">{t("Error")}</span>
              <span class="min-w-0 text-left wrap-break-words text-destructive">{error()}</span>
            </div>
          )}
        </Show>
        <div class="flex h-7 items-center gap-2">
          <span class="w-20 shrink-0">{t("Requested")}</span>
          <span class="min-w-0 flex-1 text-right truncate">{formatAssetDate(props.partial.createdAt)}</span>
        </div>
      </div>

      <div class="flex flex-col gap-2 my-2">
        <Show when={failed()}>
          <Button variant="default" class="w-full" onClick={handleRetry}>
            {t("Retry generation")}
          </Button>
        </Show>
        <Button variant="secondary" class="w-full" onClick={handleDelete}>
          {t("Delete")}
        </Button>
      </div>
    </div>
  );
}

function AssetDetails() {
  const world = useWorld();
  const library = useLibrary();
  const selection = useAssetSelection();

  const [nameExpanded, setNameExpanded] = createSignal(false);

  const handleReplace = async () => {
    const lib = library();
    const asset = selection.asset();
    if (!lib || !asset) return;
    // A relink mints a new id; keep the panel on the asset.
    const next = await replaceAssetSource(lib, asset);
    if (next) selection.select(next);
  };

  const handleInsert = () => {
    const asset = selection.asset();
    if (asset) insertAssetAtPlayhead(world, asset);
  };

  const metadataRows = useAssetMetadataRows(selection.asset);

  return (
    <div class="flex flex-col w-full px-4 border-t border-border">
      <div class="h-12 flex items-center justify-between">
        <span class="text-base font-strong">{t("Information")}</span>
      </div>
      <Show when={selection.asset()}>
        {asset => <AssetInfoPreview asset={asset()} />}
      </Show>

      <div class="flex flex-col gap-2 my-2">
        <Button variant="default" class="w-full" onClick={handleInsert}>
          {t("Insert at playhead")}
        </Button>
        <Button variant="secondary" class="w-full" onClick={handleReplace}>
          {t("Replace source")}
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setNameExpanded((v) => !v)}
        class="py-3 border-t border-b border-border mt-2 text-left outline-none"
      >
        <span
          class="text-xs leading-none block"
          classList={{
            "truncate": !nameExpanded(),
            "break-all": nameExpanded(),
          }}
        >
          {selection.asset() ? assetName(selection.asset()!) : t('Untitled')}
        </span>
      </button>
      <div class="flex flex-col gap-1 my-2">
        <For each={metadataRows().filter((row) => row.value != null)}>
          {(row) => (
            <Switch>
              <Match when={row.label === "Prompt"}>
                <div class="flex flex-col gap-2 py-1 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {t(row.label)}
                  </span>
                  <span class="min-w-0 text-left wrap-break-words">
                    {row.value}
                  </span>
                </div>
              </Match>
              <Match when={row.label !== "Prompt"}>
                <div class="flex h-7 items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {t(row.label)}
                  </span>
                  <span class="min-w-0 flex-1 text-right overflow-hidden text-ellipsis whitespace-nowrap" title={row.value ?? undefined}>
                    {row.value}
                  </span>
                </div>
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </div>
  );
}

export function useAssetMetadataRows(asset: Accessor<Asset | undefined>) {
  const generationId = createMemo(() => asset()?.generation?.id ?? null);

  const [config] = createResource(() => generationId(), async (id) => {
    if (!id || !supabase) return undefined;
    const { data, error } = await supabase
      .from("usage_records")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[asset-info] Failed to load generation record", error);
      return undefined;
    }
    return toClientConfig(data?.config);
  });

  return createMemo(() => {
    const a = asset();
    if (!a) return [];

    const visual = a.type === "IMAGE" || a.type === "VIDEO" || a.type === "SEQUENCE";
    const timed = a.type === "VIDEO" || a.type === "AUDIO" || a.type === "SEQUENCE";

    const dimensions = visual ? `${a.width}×${a.height}` : null;
    const resolution = a.type === "VIDEO" || a.type === "SEQUENCE" ? `${a.height}p` : null;
    const aspectRatio = visual ? formatAspectRatio(a.width, a.height) : null;
    const frameRate =
      a.type === "VIDEO" || a.type === "SEQUENCE"
        ? `${Math.round(a.frameRate)} FPS`
        : null;
    const duration = timed ? formatDuration(a.duration) : null;
    const fileSize = a.stat ? formatBytes(a.stat.size) : null;
    const format = formatMimeTypeLabel(a.mimeType);
    const channels =
      a.type === "AUDIO" || a.type === "VIDEO"
        ? formatChannels(a.channels)
        : null;
    const imported = formatAssetDate(a.createdAt);
    const modified = a.stat ? formatAssetDate(a.stat.mtime) : null;
    const c = settled(config);
    const prompt = c?.prompt ?? null;
    const model = c?.model ?? null;

    return [
      { label: msg("Dimensions"), value: dimensions },
      { label: msg("Resolution"), value: resolution },
      { label: msg("Aspect ratio"), value: aspectRatio },
      { label: msg("Frame rate"), value: frameRate },
      { label: msg("Duration"), value: duration },
      { label: msg("File size"), value: fileSize },
      { label: msg("Format"), value: format },
      { label: msg({ message: "Channels", context: "audio channels of a media file" }), value: channels },
      { label: msg("Imported"), value: imported },
      { label: msg("Modified"), value: modified },
      { label: msg("Source"), value: a.source },
      { label: msg("Prompt"), value: prompt },
      { label: msg("Model"), value: model },
    ];
  });
}
