/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How much cloud storage the account uses, under the Library links.

import { Show, createResource } from "solid-js";

import { cloudEnabled, cloudUsage } from "@/lib/cloud-storage";
import { cx } from "@/lib/cva";
import { intlLocale, t } from "@/lib/i18n";
import { formatBytes } from "@/lib/social-media";

/** "5 GB", "1.2 GB", "340 MB". */
function size(bytes: number) {
  // Other languages in their own digits and units, as formatBytes writes them.
  const locale = intlLocale();
  const unit = (value: number, name: string) => new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }).format(value);
  if (bytes <= 0) return locale ? unit(0, "megabyte") : "0 MB";
  const gigabytes = Number((bytes / 1e9).toFixed(1));
  if (bytes >= 1e9) return locale ? unit(gigabytes, "gigabyte") : `${gigabytes} GB`;
  return formatBytes(bytes);
}

/** A thin bar filled to `value` of `of`, red when `alert`. */
function Meter(props: { value: number; of: number; alert: boolean }) {
  const share = () => (props.of > 0 ? Math.min(100, (props.value / props.of) * 100) : 0);
  return (
    <div class="h-1 w-full overflow-hidden rounded-full bg-(--plane-layer-3)">
      <div
        class={cx("h-full rounded-full", props.alert ? "bg-(--plane-danger-text)" : "bg-(--plane-accent-primary)")}
        style={{ width: `${share()}%` }}
      />
    </div>
  );
}

/** Cloud storage, under the Library links. Only where files are backed up. */
export function LibraryStorageMeter(props: { onOpen(): void }) {
  const [usage] = createResource(() => cloudEnabled || undefined, () => cloudUsage().catch(() => null));
  return (
    <Show when={usage.latest}>
      {(current) => (
        <button
          type="button"
          class="mb-3 flex w-full shrink-0 flex-col gap-2 rounded-md border border-(--plane-border-subtle) bg-(--plane-layer-1) p-3 text-left outline-none depth-card hover:border-(--border-input) focus-ring"
          onClick={() => props.onOpen()}
        >
          <span class="flex items-baseline justify-between gap-2 text-xs">
            <span class="font-medium text-(--plane-text-primary)">{t("Cloud storage")}</span>
            <span class="tabular-nums text-(--plane-text-tertiary)">
              {t("{used} of {limit}", { used: size(current().used), limit: size(current().limit) })}
            </span>
          </span>
          <Meter value={current().used} of={current().limit} alert={current().used >= current().limit * 0.9} />
        </button>
      )}
    </Show>
  );
}
