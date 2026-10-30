/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { batch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { isUrlSource, type Transcript } from "@plan.video/assets";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { AssetId, resolveTranscript } from "@plan.video/runtime";
import { useLibrary } from "@/engine/library";
import { getEditHistory } from "@/engine/history";
import { captionHistoryStamp, captionTranscriptRevision, saveCaptionTranscript } from "@/lib/caption-transcript";

import type { Entity } from "koota";

const SAVE_DELAY_MS = 200;

// Edits show at once and are written a moment later, so typing is not a write per key. Reloads after any
// panel or the timeline writes, unless an edit here is still due.
export function useCaptionTranscript(entity: () => Entity) {
  const world = useWorld();
  const library = useLibrary();
  const assetId = useTrait(entity, AssetId);

  const asset = createMemo(() => {
    const id = assetId()?.value;
    const lib = library();
    if (!id || !lib) return undefined;
    const found = lib.get(id);
    if (!found || found.type !== "TRANSCRIPT" || isUrlSource(found.source)) return undefined;
    return found;
  });

  const [transcript, setTranscript] = createSignal<Transcript | undefined>();
  const [loadedId, setLoadedId] = createSignal<string | undefined>();
  let appliedRevision = -1;
  let timer = 0;
  let dirty = false;

  createEffect(() => {
    captionHistoryStamp();
    dirty = false;
    window.clearTimeout(timer);
  });

  createEffect(() => {
    const revision = captionTranscriptRevision();
    const current = asset();
    if (!current) {
      setTranscript(undefined);
      setLoadedId(undefined);
      appliedRevision = -1;
      return;
    }

    const id = current.id;
    const sameAsset = untrack(loadedId) === id;
    if (sameAsset && revision === appliedRevision) return;
    if (sameAsset && dirty) return;

    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    void resolveTranscript(current).then(
      (next) => {
        if (cancelled) return;
        appliedRevision = revision;
        batch(() => {
          setLoadedId(id);
          setTranscript(next);
        });
      },
      () => {
        if (cancelled) return;
        appliedRevision = revision;
        batch(() => {
          setLoadedId(id);
          setTranscript([]);
        });
      },
    );
  });

  const save = (next: Transcript) => {
    const current = untrack(asset);
    const lib = untrack(library);
    if (!current || !lib) return;
    void saveCaptionTranscript(world, lib, current, next);
  };

  const commit = (next: Transcript, now = false) => {
    const currentAsset = untrack(asset);
    const previous = untrack(transcript);
    if (currentAsset && previous) {
      getEditHistory(world).recordTranscript(currentAsset.id, previous, next);
    }
    setTranscript(next);
    window.clearTimeout(timer);
    if (now) {
      dirty = false;
      save(next);
      return;
    }
    dirty = true;
    timer = window.setTimeout(() => {
      dirty = false;
      save(next);
    }, SAVE_DELAY_MS);
  };

  onCleanup(() => {
    window.clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    const pending = untrack(transcript);
    if (pending) save(pending);
  });

  return {
    asset,
    transcript,
    loaded: () => loadedId() !== undefined && loadedId() === asset()?.id,
    commit,
  };
}
