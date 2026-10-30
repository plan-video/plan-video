/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

export type PageToggleOption<T extends string> = { value: T; label: string; key?: string };

export function PageToggle<T extends string>(props: {
  label: string;
  options: readonly PageToggleOption<T>[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <div role="group" aria-label={props.label} class="flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-(--plane-layer-3) p-[3px]">
      <For each={props.options}>
        {(option) => {
          const active = () => props.value === option.value;
          return (
            <button
              type="button"
              aria-pressed={active()}
              aria-keyshortcuts={option.key}
              class={cx(
                "cap-trim h-full rounded-sm px-2 text-xs font-medium outline-none press focus-ring",
                active()
                  ? "bg-(--plane-layer-transparent-active) text-(--plane-text-primary)"
                  : "text-(--plane-text-secondary) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary)",
              )}
              onClick={() => props.onChange(option.value)}
            >
              {t(option.label)}
            </button>
          );
        }}
      </For>
    </div>
  );
}
