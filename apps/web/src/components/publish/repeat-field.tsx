/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";

import { fieldControl } from "@/components/publish/controls";
import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/publish/date-time-picker";
import {
  MAX_REPEAT_EVERY,
  MAX_REPEAT_RUNS,
  cadenceLabel,
  everyRecurrence,
  formatDay,
  nthRunDay,
  parseRecurrence,
  resolveRepeatEnd,
  runsUntil,
  type RepeatUnit,
} from "@/components/calendar/utils";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";

const PRESETS = ["", everyRecurrence(1, "day"), "weekday", everyRecurrence(1, "week"), everyRecurrence(2, "week"), everyRecurrence(1, "month")];
const CUSTOM = "custom";
const NONE = "none";
const UNITS: RepeatUnit[] = ["day", "week", "month"];
const UNIT_LABELS: Record<RepeatUnit, string> = {
  day: msg("{count, plural, one {day} other {days}}"),
  week: msg("{count, plural, one {week} other {weeks}}"),
  month: msg("{count, plural, one {month} other {months}}"),
};

function presetLabel(value: string, day: string) {
  if (!value) return t("Does not repeat");
  if (value === "weekday") return t("Every weekday, Monday to Friday");
  return cadenceLabel(value, day) ?? value;
}

export function RepeatField(props: { value: string; day: string; onChange(value: string): void; class?: string }) {
  const [picked, setCustom] = createSignal(false);
  const custom = () => picked() || !PRESETS.includes(props.value);
  const cadence = () => {
    const parsed = parseRecurrence(props.value);
    return parsed && parsed.unit !== "weekday" ? parsed : { unit: "day" as const, every: 2 };
  };

  const options = (): Choice[] => [
    ...PRESETS.map((value) => ({ id: value || NONE, label: presetLabel(value, props.day) })),
    { id: CUSTOM, label: t("Custom…") },
  ];

  return (
    <div class={cx("flex min-w-0 flex-col gap-1.5", props.class)}>
      <ChoiceSelect
        label={t("Repeat")}
        options={options()}
        value={custom() ? CUSTOM : props.value || NONE}
        onChange={(next) => {
          setCustom(next === CUSTOM);
          if (next === CUSTOM) props.onChange(everyRecurrence(cadence().every, cadence().unit));
          else props.onChange(next === NONE ? "" : next);
        }}
      />
      <Show when={custom()}>
        <div class="flex items-center gap-1.5">
          <span class="shrink-0 text-xs text-muted-foreground">{t("Every")}</span>
          <input
            type="number"
            inputmode="numeric"
            min={1}
            max={MAX_REPEAT_EVERY}
            aria-label={t("How many")}
            class={cx(fieldControl, "w-14 shrink-0 tabular-nums")}
            value={cadence().every}
            onInput={(event) => {
              const every = Number(event.currentTarget.value);
              if (Number.isInteger(every) && every >= 1 && every <= MAX_REPEAT_EVERY) props.onChange(everyRecurrence(every, cadence().unit));
            }}
            onBlur={(event) => (event.currentTarget.value = String(cadence().every))}
          />
          <ChoiceSelect
            label={t("Unit")}
            class="min-w-0 flex-1"
            options={UNITS.map((unit) => ({ id: unit, label: t(UNIT_LABELS[unit], { count: cadence().every }) }))}
            value={cadence().unit}
            onChange={(unit) => props.onChange(everyRecurrence(cadence().every, unit as RepeatUnit))}
          />
        </div>
      </Show>
    </div>
  );
}

const END_CHOICES: Choice[] = [
  { id: "never", label: msg("Never") },
  { id: "on", label: msg("On a date") },
  { id: "after", label: msg("After a number of posts") },
];
const DEFAULT_RUNS = 5;

/** `value` is `""`, `on:YYYY-MM-DD` or `after:N`. */
export function RepeatEndField(props: { value: string; repeat: string; day: string; onChange(value: string): void; class?: string }) {
  const mode = () => (props.value.startsWith("on:") ? "on" : props.value.startsWith("after:") ? "after" : "never");
  const onDay = () => props.value.slice(3);
  const count = () => Number(props.value.slice(6)) || DEFAULT_RUNS;
  const last = () => resolveRepeatEnd(props.value, props.repeat, props.day);
  const hint = () => {
    if (mode() === "after") return last() ? t("The last one goes out {date}.", { date: formatDay(last()!) }) : null;
    if (mode() !== "on") return null;
    if (onDay() < props.day) return t("Pick a day on or after the first post.");
    const runs = runsUntil(props.repeat, props.day, onDay());
    return t("{count, plural, one {# post in all.} other {# posts in all.}}", { count: runs });
  };

  const choose = (next: string) => {
    if (next === "never") props.onChange("");
    else if (next === "after") props.onChange(`after:${count()}`);
    else props.onChange(`on:${nthRunDay(props.repeat, props.day, DEFAULT_RUNS) ?? props.day}`);
  };

  return (
    <div class={cx("flex min-w-0 flex-col gap-1.5", props.class)}>
      <div class="flex min-w-0 items-center gap-1.5">
        <ChoiceSelect label={t("Ends")} class="min-w-0 flex-1" options={END_CHOICES} value={mode()} onChange={choose} />
        <Show when={mode() === "on"}>
          <div class="min-w-0 flex-1">
            <DatePicker label={t("Last day")} value={onDay()} min={props.day} onChange={(day) => props.onChange(`on:${day}`)} />
          </div>
        </Show>
        <Show when={mode() === "after"}>
          <input
            type="number"
            inputmode="numeric"
            min={1}
            max={MAX_REPEAT_RUNS}
            aria-label={t("How many posts")}
            class={cx(fieldControl, "w-14 shrink-0 tabular-nums")}
            value={count()}
            onInput={(event) => {
              const runs = Number(event.currentTarget.value);
              if (Number.isInteger(runs) && runs >= 1 && runs <= MAX_REPEAT_RUNS) props.onChange(`after:${runs}`);
            }}
            onBlur={(event) => (event.currentTarget.value = String(count()))}
          />
          <span class="shrink-0 text-xs text-muted-foreground">{t("{count, plural, one {post} other {posts}}", { count: count() })}</span>
        </Show>
      </div>
      <Show when={hint()}>
        <p class="text-xs leading-4 text-muted-foreground">{hint()}</p>
      </Show>
    </div>
  );
}

type Choice = { id: string; label: string };

function ChoiceSelect(props: { label: string; options: Choice[]; value: string; onChange(id: string): void; class?: string }) {
  return (
    <Select<Choice>
      class={props.class}
      options={props.options}
      value={props.options.find((option) => option.id === props.value)}
      onChange={(option) => option && props.onChange(option.id)}
      optionValue="id"
      optionTextValue="label"
      gutter={4}
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.label)}</SelectItem>}
    >
      <SelectTrigger aria-label={props.label} class="border border-(--border-input) focus-ring">
        <SelectValue<Choice>>{(state) => t(state.selectedOption()?.label ?? "")}</SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent data-calendar-keep-popup />
      </SelectPortal>
    </Select>
  );
}
