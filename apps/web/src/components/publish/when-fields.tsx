/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, type JSX } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { suggestTimes } from "@/components/publish/best-times";
import { formatWhen, nextSlot } from "@/components/publish/save";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import type { PlatformId } from "@/lib/social";
import { zonedParts, zonedTime } from "@/lib/time-zone";

function quickPicks(): { label: string; at: Date }[] {
  const now = zonedParts(new Date());
  const at = (days: number, hours: number) => new Date(zonedTime(now.year, now.month, now.date + days, hours));
  const monday = at((8 - now.weekday) % 7 || 7, 12);

  return [
    { label: t("In an hour"), at: nextSlot(new Date(Date.now() + 60 * 60 * 1000)) },
    { label: t("Tonight"), at: at(0, 19) },
    { label: t("Tomorrow"), at: at(1, 9) },
    { label: t("Monday"), at: monday },
  ].filter((pick) => pick.at.getTime() > Date.now());
}

export function untilLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return t("{count, plural, one {in # minute} other {in # minutes}}", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60
      ? t("in {hours, plural, one {# hour} other {# hours}} {minutes, plural, one {# minute} other {# minutes}}", { hours, minutes: minutes % 60 })
      : t("{count, plural, one {in # hour} other {in # hours}}", { count: hours });
  return t("{count, plural, one {in # day} other {in # days}}", { count: Math.round(hours / 24) });
}

export type WhenQueue = {
  at: Date | null;
  hasSlots: boolean;
  selected: boolean;
  onChoose(): void;
  onSetUp(): void;
};

export function WhenOptions(props: {
  platforms: readonly PlatformId[];
  picked: Date | null;
  now: Date;
  onChoose(at: Date): void;
  queue?: WhenQueue;
  class?: string;
}) {
  const best = createMemo(() => suggestTimes(props.platforms, 1, props.now.getTime())[0] ?? null);
  const checked = (at: Date) => !props.queue?.selected && props.picked?.getTime() === at.getTime();

  return (
    <div class={cx("flex flex-col", props.class)} role="radiogroup" aria-label={t("When")}>
      <Show when={props.queue}>
        {(queue) => (
          <WhenRow
            checked={queue().selected}
            label={t("Next queue slot")}
            onClick={() => (queue().hasSlots ? queue().onChoose() : queue().onSetUp())}
          >
            <Show when={queue().hasSlots} fallback={<span class="text-primary">{t("Set up queue")}</span>}>
              <Show when={queue().at} fallback={t("Every queue slot is taken")}>
                {(at) => formatWhen(at())}
              </Show>
            </Show>
          </WhenRow>
        )}
      </Show>
      <For each={quickPicks()}>
        {(pick) => (
          <WhenRow checked={checked(pick.at)} label={pick.label} onClick={() => props.onChoose(pick.at)}>
            {formatWhen(pick.at)}
          </WhenRow>
        )}
      </For>
      <Show when={best()}>
        {(suggestion) => (
          <WhenRow checked={checked(suggestion().at)} label={t("Best for your audience")} onClick={() => props.onChoose(suggestion().at)}>
            {formatWhen(suggestion().at)}
          </WhenRow>
        )}
      </Show>
    </div>
  );
}

function WhenRow(props: { checked: boolean; label: string; onClick(): void; children: JSX.Element }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      class="flex h-8 w-full items-center gap-1 rounded-md px-2 text-left text-xs text-foreground transition-colors hover:bg-accent focus-ring"
      onClick={() => props.onClick()}
    >
      <span class="flex size-6 shrink-0 items-center justify-center">
        <Show when={props.checked}>
          <Icon name="confirm-check" class="size-6" />
        </Show>
      </span>
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <span class="shrink-0 tabular-nums text-muted-foreground">{props.children}</span>
    </button>
  );
}
