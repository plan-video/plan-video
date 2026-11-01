/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A, useNavigate } from "@solidjs/router";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import type { JSX } from "solid-js";

import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";

// Sizes are set outright: the dashboard and the editor each scale `text-sm` and
// `font-medium` their own way.
const BAND_BUTTON = "press inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[14px] font-[500] outline-none focus-ring";

export function GuestFrame(props: { children: JSX.Element }) {
  const navigate = useNavigate();

  return (
    <div class="flex h-dvh w-full flex-col bg-[#1c1c1c] px-2 pb-2 text-white max-md:px-0 max-md:pb-0">
      {/* Above the frame, so the tooltip that opens down from it lands over the demo. */}
      <div class="relative z-10 flex h-12 shrink-0 items-center px-2">
        <A href="/" aria-label={t("Back to plan.video")} class={`${BAND_BUTTON} pl-1.5 text-white hover:bg-white/[0.08]`}>
          <ChevronLeft class="size-4" />
          <span class="max-md:hidden">{t("Back to plan.video")}</span>
        </A>
        <div class="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 max-md:static max-md:ml-auto max-md:translate-x-0">
          <Tooltip placement="bottom" openDelay={120}>
            <TooltipTrigger
              as="span"
              tabIndex={0}
              class="mr-1.5 flex cursor-default items-center gap-1.5 rounded-[6px] whitespace-nowrap text-[14px] font-[400] text-white/70 outline-none focus-ring"
            >
              {t("Guest mode")}
              <PlaneIcon name="info" class="size-3.5" />
            </TooltipTrigger>
            <TooltipContent class="block max-w-60 px-2.5 py-2 text-[12px] leading-[18px] font-[400]! text-pretty text-muted-foreground">
              {t("A demo with sample posts, accounts and numbers. Nothing in it goes out, and it starts over each day.")}
            </TooltipContent>
          </Tooltip>
          <button type="button" class={`${BAND_BUTTON} border border-white/15 whitespace-nowrap text-white hover:bg-white/[0.08]`} onClick={() => navigate("/signup")}>
            {t("Create account")}
          </button>
        </div>
      </div>
      {/* Its own containing block, so what the app pins to the window stays inside the frame. */}
      <div class="relative min-h-0 flex-1 transform-gpu overflow-hidden rounded-[12px] max-md:rounded-none">{props.children}</div>
    </div>
  );
}
