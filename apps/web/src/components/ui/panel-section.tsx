/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createEffect, createSignal, onCleanup, useContext, type Accessor, type JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

export const foldSearch = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// `query` is already folded. Each section that matches counts itself in, so the panel knows when nothing does.
export const PanelSearchContext = createContext<{ query: Accessor<string>; count(change: number): void }>({
  query: () => "",
  count: () => {},
});

type PanelSectionProps = {
  title: string | JSX.Element;
  subtitle?: JSX.Element;
  /** Words the search finds this section by, beyond what it shows: the options still behind its add button. */
  keywords?: string;
  actions?: JSX.Element;
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
    "keywords",
    "empty",
    "children",
    "ref",
    "class",
  ]);
  const search = useContext(PanelSearchContext);
  const searching = () => search.query() !== "";
  const [collapsed, setCollapsed] = createSignal(false);
  const [found, setFound] = createSignal(true);
  const open = () => local.empty || !collapsed() || searching();

  let titleEl: HTMLDivElement | undefined;
  let bodyEl: HTMLDivElement | undefined;

  // Reads the words on screen, so a section is found by its rows' labels and values too.
  createEffect(() => {
    const query = search.query();
    const text = query ? foldSearch(`${titleEl?.textContent} ${local.keywords ?? ""} ${bodyEl?.textContent ?? ""}`) : "";
    const matches = text.includes(query);
    setFound(matches);
    if (!query || !matches) return;
    search.count(1);
    onCleanup(() => search.count(-1));
  });

  return (
    <>
      <div class="flex items-center justify-between h-10 border-t border-border px-4" ref={local.ref} hidden={!found()}>
        <div class="flex min-w-0 items-center gap-1 text-xs font-450" ref={titleEl}>
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
          <Show when={!local.empty && !searching()}>
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
          ref={bodyEl}
          hidden={!found()}
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
