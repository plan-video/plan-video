/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Field, FieldGroup, Segmented, fieldControl } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import { clock, readClock } from "@/lib/clip-studio";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

import { StoryboardThumb } from "./clip-list";

import type { TwitchVideo } from "@/lib/twitch-clips";

const LENGTHS = ["15", "30", "45", "60", "90"] as const;

/** Picks any stretch of the stream by hand, seeing where it is on Twitch's own frames. */
export function AddClip(props: { video: TwitchVideo; onAdd(at: number, length: number): void }) {
  const [open, setOpen] = createSignal(false);
  const [at, setAt] = createSignal(0);
  const [length, setLength] = createSignal<(typeof LENGTHS)[number]>("30");
  const most = () => Math.max(0, props.video.seconds - 3);

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger as={Button} variant="secondary" class={cx("gap-1 pl-1 max-md:w-7 max-md:px-0", open() && "bg-accent")} aria-label={t("Add a clip")}>
        <Icon name="plus-add" class="size-5" />
        <span class="max-md:sr-only">{t("Add a clip")}</span>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="z-[10000] flex w-80 flex-col gap-3 rounded-xl p-3">
          <StoryboardThumb board={props.video.storyboard} seconds={at() + Number(length()) / 2} class="w-full" />
          <SliderRow
            label={t("Starts at")}
            value={at()}
            min={0}
            max={most()}
            step={1}
            values={<span class="text-xs tabular-nums text-foreground">{clock(at())}</span>}
            onChange={setAt}
          />
          <Field label={t("Or type a time")}>
            <input
              class={cx(fieldControl, "tabular-nums")}
              placeholder="1:02:03"
              value={clock(at())}
              onChange={(event) => {
                const seconds = readClock(event.currentTarget.value);
                if (seconds === null) event.currentTarget.value = clock(at());
                else setAt(Math.min(most(), Math.max(0, seconds)));
              }}
            />
          </Field>
          <FieldGroup label={t("Length")}>
            <Segmented options={LENGTHS.map((id) => ({ id, label: t("{seconds} s", { seconds: id }) }))} value={length()} onChange={setLength} />
          </FieldGroup>
          <Button
            onClick={() => {
              props.onAdd(at(), Number(length()));
              setOpen(false);
            }}
          >
            {t("Add clip")}
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
