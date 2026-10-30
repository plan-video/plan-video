/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, type JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

type PanelSectionProps = {
  title: string | JSX.Element;
  subtitle?: JSX.Element;
  actions?: JSX.Element;
  /** Nothing in it yet: the header keeps its add action and drops the open/close toggle. */
  empty?: boolean;
  children?: JSX.Element;
  class?: string;
  ref?: HTMLDivElement;
};

export function PanelSection(props: PanelSectionProps) {
  const [local] = splitProps(props, [
    "title",
    "subtitle",
    "actions",
    "empty",
    "children",
    "ref",
    "class",
  ]);
  const [collapsed, setCollapsed] = createSignal(false);
  // An empty section has nothing to fold, so what is added to it shows.
  const open = () => local.empty || !collapsed();

  return (
    <>
      <div class="flex items-center justify-between h-10 border-t border-border px-4" ref={local.ref}>
        <div class="flex min-w-0 items-center gap-1 text-xs font-450">
          <Show
            when={typeof local.title === "string"}
            fallback={local.title}
          >
            {local.title}
          </Show>
          {local.subtitle}
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={open() && local.actions != null}>
            {local.actions}
          </Show>
          <Show when={!local.empty}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                aria-expanded={open()}
                aria-label={open() ? t("Close section") : t("Open section")}
                onClick={() => setCollapsed((value) => !value)}
              >
                <Icon name={open() ? "minus" : "plus-add"} />
              </TooltipTrigger>
              <TooltipContent>{open() ? t("Close") : t("Open")}</TooltipContent>
            </Tooltip>
          </Show>
        </div>
      </div>

      <Show when={open()}>
        <div
          class={cx(
            "[&:has(>*)]:pb-3 gap-2 w-full max-w-full min-w-0 px-4 flex flex-col data-[grid=true]:grid *:min-w-0 grid-cols-[1fr_1fr]",
            local.class
          )}
        >
          {local.children}
        </div>
      </Show>
    </>
  );
}
