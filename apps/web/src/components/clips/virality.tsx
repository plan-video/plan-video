/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";

import { FieldGroup } from "@/components/publish/controls";
import type { ClipEdit } from "@/lib/clip-studio";
import { msg, t } from "@/lib/i18n";
import type { ViralityMarks } from "@/lib/stream-clips";

const PARTS: { id: keyof ViralityMarks; label: string; tip?: string }[] = [
  { id: "hook", label: msg("Hook"), tip: msg("Start it closer to the action, so the first seconds grab people.") },
  { id: "payoff", label: msg("Payoff"), tip: msg("End it right after the big moment, so it doesn't fade out.") },
  { id: "standalone", label: msg("Makes sense alone"), tip: msg("Say what's going on in the hook title, for people who never saw the stream.") },
  { id: "buzz", label: msg("Stream's reaction") },
];

/** Below this, the weakest part with a tip gets one. */
const WEAK = 5;

export function Virality(props: { clip: ClipEdit }) {
  const tip = () => {
    const marks = props.clip.marks;
    if (!marks) return null;
    const weakest = PARTS.filter((part) => part.tip && marks[part.id] <= WEAK).sort((a, b) => marks[a.id] - marks[b.id])[0];
    return weakest?.tip ?? null;
  };
  return (
    <FieldGroup
      label={t("Virality")}
      trailing={
        <Show when={props.clip.score !== null}>
          <span class="text-[13px] font-medium tabular-nums text-foreground">{props.clip.score}</span>
        </Show>
      }
    >
      <div class="flex flex-col gap-3">
        <Show when={props.clip.marks}>
          {(marks) => (
            <dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-xs">
              <For each={PARTS}>
                {(part) => (
                  <>
                    <dt class="text-muted-foreground">{t(part.label)}</dt>
                    <dd class="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                      <div class="h-full rounded-full bg-primary" style={{ width: `${marks()[part.id] * 10}%` }} />
                    </dd>
                    <dd class="w-4 text-right tabular-nums text-foreground">{marks()[part.id]}</dd>
                  </>
                )}
              </For>
            </dl>
          )}
        </Show>
        <Show when={props.clip.reason}>
          <p class="text-xs text-foreground">{props.clip.reason}</p>
        </Show>
        <Show when={tip()}>
          {(text) => <p class="text-xs text-muted-foreground">{t(text())}</p>}
        </Show>
      </div>
    </FieldGroup>
  );
}
