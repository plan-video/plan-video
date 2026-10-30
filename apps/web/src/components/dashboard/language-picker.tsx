/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { LANGUAGES, language, setLanguage, t, type Language } from "@/lib/i18n";

export function LanguagePicker() {
  const [open, setOpen] = createSignal(false);
  let list: HTMLDivElement | undefined;

  const current = () => LANGUAGES.find((entry) => entry.code === language()) ?? LANGUAGES[0];
  const options = () => [...(list?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];

  const pick = (code: Language) => {
    setOpen(false);
    void setLanguage(code).catch(() => {
      // Offline, its words couldn't be fetched: the app stays in the language it's in.
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = (index: number) => all[(index + all.length) % all.length]?.focus();
    if (event.key === "ArrowDown") to(at + 1);
    else if (event.key === "ArrowUp") to(at - 1);
    else if (event.key === "Home") to(0);
    else if (event.key === "End") to(all.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={`${t("Language")}: ${current().name}`}
        class="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-secondary pl-2 pr-1 text-xs text-foreground press hover:bg-secondary-hover focus-ring data-[expanded]:bg-secondary-hover"
      >
        <span class="cap-centered truncate" lang={current().code}>
          {current().name}
        </span>
        <Icon name="chevron-down" class="size-5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="w-56 overflow-hidden rounded-xl border-(--plane-border-strong) p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            requestAnimationFrame(() => options().find((option) => option.getAttribute("aria-selected") === "true")?.focus());
          }}
        >
          <div ref={list} role="listbox" aria-label={t("Language")} class="max-h-80 overflow-y-auto overscroll-contain p-1" onKeyDown={onKeyDown}>
            <For each={LANGUAGES}>
              {(entry) => {
                const selected = () => entry.code === language();
                return (
                  <div
                    role="option"
                    tabindex="-1"
                    lang={entry.code}
                    aria-selected={selected()}
                    class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-foreground outline-none hover:bg-accent focus:bg-accent"
                    onClick={() => pick(entry.code)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      pick(entry.code);
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-4 scale-[2.4] text-primary" />
                      </Show>
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
