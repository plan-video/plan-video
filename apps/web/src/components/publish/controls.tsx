/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal, type JSX } from "solid-js";

import { tileViewBox } from "@/components/brand/tile-box";
import { YouTubeBare, YouTubeSlot, YouTubeWhiteTile } from "@/components/brand/youtube-icon";
import { AccountAvatar } from "@/components/publish/account-avatar";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Switch, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { POST_KINDS, SOCIAL_PLATFORMS, platformsFor, socialPlatform, sortPlatforms, type PlatformId, type PostKind } from "@/lib/social";
import { accountLabel, accountsFor, accountsForPlatforms, connectionsFor, toggleAccount, type AccountChoices } from "@/lib/social-connections";

export const fieldControlBase =
  "w-full min-w-0 rounded-md border border-(--border-input) bg-input px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:dark]";
export const fieldControl = `h-7 ${fieldControlBase}`;

const MARK_BOX = tileViewBox("0 0 24 24", 0.62);

export function PlatformLogo(props: { id: PlatformId; class?: string; compact?: boolean; bare?: boolean }) {
  const platform = () => socialPlatform(props.id);
  // Branches in the markup, not early returns: a component runs once, so a return would keep the first `id`'s look.
  return (
    <Show
      when={props.id === "youtube"}
      fallback={
        <span
          title={platform().name}
          class={cx(
            "grid size-5 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-inset ring-white/10 transition-opacity",
            props.class,
          )}
          style={{ background: platform().background }}
        >
          <svg viewBox={MARK_BOX} class="size-full" fill="white" aria-hidden="true">
            <path d={platform().logo} />
          </svg>
        </span>
      }
    >
      <Show when={!props.bare} fallback={<YouTubeBare title={platform().name} class={cx("size-5", props.class)} />}>
        <Show when={props.compact} fallback={<YouTubeSlot title={platform().name} class={props.class} />}>
          <YouTubeWhiteTile fill class={cx("size-5 rounded-md", props.class)} />
        </Show>
      </Show>
    </Show>
  );
}

export function PlatformLogos(props: { ids: readonly PlatformId[]; max?: number; class?: string; logoClass?: string; compact?: boolean }) {
  const shown = () => props.ids.slice(0, props.max ?? props.ids.length);
  const extra = () => props.ids.length - shown().length;
  return (
    <span class={cx("flex items-center gap-0.5", props.class)}>
      <For each={shown()}>
        {(id) =>
          props.compact && id === "youtube" ? (
            <YouTubeWhiteTile fill class={cx("rounded-md", props.logoClass ?? "size-4")} />
          ) : (
            <PlatformLogo id={id} class={props.logoClass ?? "size-4"} />
          )
        }
      </For>
      <Show when={extra() > 0}>
        <span class="pl-0.5 text-xs text-muted-foreground">+{extra()}</span>
      </Show>
    </span>
  );
}

/** Outlines from Lucide (ISC). */
function KindGlyph(props: { kind: PostKind; class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      class={cx("size-5 shrink-0", props.class)}
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {KIND_GLYPHS[props.kind]()}
    </svg>
  );
}

const KIND_GLYPHS: Record<PostKind, () => JSX.Element> = {
  text: () => (
    <>
      <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </>
  ),
  image: () => (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </>
  ),
  video: () => (
    <>
      <rect x="2" y="6" width="14" height="12" rx="3" />
      <path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5" />
    </>
  ),
  story: () => (
    <>
      <path d="M10.1 2.18a10 10 0 0 1 3.8 0" />
      <path d="M17.61 3.72a10 10 0 0 1 2.7 2.7" />
      <path d="M21.82 10.1a10 10 0 0 1 0 3.8" />
      <path d="M20.28 17.61a10 10 0 0 1-2.7 2.69" />
      <path d="M13.9 21.82a10 10 0 0 1-3.8 0" />
      <path d="M6.39 20.28a10 10 0 0 1-2.69-2.7" />
      <path d="M2.18 13.9a10 10 0 0 1 0-3.8" />
      <path d="M3.72 6.39a10 10 0 0 1 2.7-2.69" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
};

export function PostKindPicker(props: { value: PostKind; onChange(kind: PostKind): void; class?: string }) {
  return (
    <div class={cx("grid grid-cols-4 gap-1 rounded-xl bg-accent/60 p-1", props.class)} role="radiogroup" aria-label={t("Post type")}>
      <For each={POST_KINDS}>
        {(kind) => {
          const on = () => props.value === kind.id;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on()}
              class="group flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-2.5 press focus-ring"
              classList={{
                "bg-background shadow-xs": on(),
                "hover:bg-accent": !on(),
              }}
              onClick={() => props.onChange(kind.id)}
            >
              <KindGlyph
                kind={kind.id}
                class={`mr-1 size-4 transition-colors ${on() ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
              />
              <span class={`truncate text-sm transition-colors ${on() ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                {t(kind.name)}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

const KIND_DESCRIPTIONS: Record<PostKind, string> = {
  text: msg("Words and links, nothing attached"),
  image: msg("One picture, or several as a carousel"),
  video: msg("One video, or a project of yours"),
  story: msg("One picture or video, gone after a day"),
};

export function PostKindChooser(props: { onChoose(kind: PostKind): void }) {
  return (
    <div class="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t("Post type")}>
      <For each={POST_KINDS}>
        {(kind) => (
          <button
            type="button"
            role="radio"
            aria-checked="false"
            class="depth-card group flex min-w-0 flex-col items-start gap-4 rounded-xl border border-border-strong bg-accent/30 p-4 text-left hover:border-(--border-input) focus-ring"
            onClick={() => props.onChoose(kind.id)}
          >
            <span class="grid size-9 place-items-center rounded-md bg-accent text-muted-foreground transition-colors group-hover:text-foreground">
              <KindGlyph kind={kind.id} class="size-[18px]" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-sm font-medium text-foreground">{t(kind.name)}</span>
              <span class="text-xs text-muted-foreground">{t(KIND_DESCRIPTIONS[kind.id])}</span>
            </span>
            <PlatformLogos ids={platformsFor(kind.id)} class="mt-auto flex-wrap gap-1.5" logoClass="size-6 rounded-md ring-white/15" />
          </button>
        )}
      </For>
    </div>
  );
}

export function accountsLabel(accounts: readonly { platform: string; handle?: string }[]) {
  if (accounts.length === 1) return accountLabel(accounts[0]!);
  if (accounts.length === 2) return t("{first} and {second}", { first: accountLabel(accounts[0]!), second: accountLabel(accounts[1]!) });
  return t("{count, plural, one {# account} other {# accounts}}", { count: accounts.length });
}

export function AccountSelect(props: {
  platform: PlatformId | string;
  value?: readonly string[];
  onChange(accountIds: readonly string[]): void;
  short?: boolean;
}) {
  const list = () => connectionsFor(props.platform);
  const chosen = () => accountsFor(props.platform, { [props.platform]: props.value ?? [] });
  const name = () => socialPlatform(props.platform as PlatformId).name;
  const allOn = () => chosen().length === list().length;

  return (
    <Show when={list().length > 1 || (list().length > 0 && !chosen().length)}>
      <Popover placement="bottom-start">
        <PopoverTrigger
          type="button"
          aria-label={t("{platform} accounts", { platform: name() })}
          class="flex h-5 max-w-full items-center gap-0.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring data-[expanded]:text-foreground"
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        >
          <span class="truncate">
            {chosen().length
              ? props.short
                ? `${chosen().length.toLocaleString(intlLocale())} ${t("of {total}", { total: list().length })}`
                : accountsLabel(chosen())
              : list().length > 1
                ? t("Pick accounts")
                : t("Pick an account")}
            <Show when={chosen().length > 2 && !props.short}>
              <span class="text-muted-foreground/70"> {t("of {total}", { total: list().length })}</span>
            </Show>
          </span>
          <Icon name="chevron-down" class="size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent data-calendar-keep-popup class="z-[10000] flex w-64 flex-col overflow-hidden rounded-xl border-white/10 p-0">
            <div class="flex items-center gap-2 border-b border-border-strong px-3 py-2">
              <PlatformLogo id={props.platform as PlatformId} class="size-5 rounded-md" />
              <span class="flex-1 text-xs text-foreground">{t("Post from")}</span>
              <Show when={list().length > 1}>
                <button
                  type="button"
                  disabled={allOn()}
                  class="rounded px-1.5 py-0.5 text-xs text-primary press hover:bg-primary/10 focus-ring disabled:pointer-events-none disabled:text-muted-foreground"
                  onClick={() => props.onChange(list().map((account) => account.id))}
                >
                  {t("{count, plural, one {Select all #} other {Select all #}}", { count: list().length })}
                </button>
              </Show>
            </div>
            <div role="group" aria-label={t("{platform} accounts", { platform: name() })} class="max-h-64 overflow-y-auto overscroll-contain p-1">
              <For each={list()}>
                {(account) => {
                  const on = () => chosen().some((item) => item.id === account.id);
                  const last = () => on() && chosen().length === 1;
                  return (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on()}
                      title={last() ? t("A post needs at least one account here") : undefined}
                      class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-accent focus-ring"
                      onClick={() => {
                        if (last()) return;
                        props.onChange(toggleAccount({ [props.platform]: chosen().map((item) => item.id) }, props.platform, account.id)[props.platform] ?? []);
                      }}
                    >
                      <span
                        class={cx(
                          "grid size-4 shrink-0 place-items-center rounded-sm border transition-colors",
                          on() ? "border-primary bg-primary text-primary-foreground" : "border-white/25",
                          last() && "opacity-60",
                        )}
                      >
                        <Show when={on()}>
                          <CheckMark class="size-3" />
                        </Show>
                      </span>
                      <AccountAvatar account={account} class="size-5" />
                      <span class={cx("min-w-0 flex-1 truncate", on() ? "text-foreground" : "text-muted-foreground")}>@{account.handle}</span>
                    </button>
                  );
                }}
              </For>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </Show>
  );
}

export function PlatformPicker(props: {
  variant?: "tiles" | "logos";
  value: readonly PlatformId[];
  accounts?: AccountChoices;
  onChange(ids: PlatformId[], accounts: AccountChoices): void;
  columns?: number;
  available?: readonly PlatformId[];
  class?: string;
}) {
  const apply = (ids: PlatformId[], accounts: AccountChoices = props.accounts ?? {}) => {
    props.onChange(sortPlatforms(ids), accountsForPlatforms(ids, accounts, { keepRemoved: true }));
  };

  const toggle = (id: PlatformId) => {
    const picked = new Set(props.value);
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    apply([...picked]);
  };

  const offered = () => (props.available ? SOCIAL_PLATFORMS.filter((platform) => props.available!.includes(platform.id)) : SOCIAL_PLATFORMS);

  // All nine in a row when there's room, else rows of five or three, so a row never ends with one left over.
  if (props.variant === "logos") {
    return (
      <div class={cx("@container", props.class)}>
        <div class="grid grid-cols-3 gap-1 @sm:grid-cols-5 @2xl:grid-cols-9">
          <For each={offered()}>
            {(platform) => {
              const on = () => props.value.includes(platform.id);
              const accounts = () => connectionsFor(platform.id);
              const unpicked = () => on() && accounts().length > 0 && !accountsFor(platform.id, props.accounts).length;
              return (
                <div
                  class="group flex min-w-0 flex-col items-center rounded-md border press"
                  classList={{
                    "border-primary/70 bg-primary/10": on(),
                    "border-transparent hover:bg-accent": !on(),
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={on()}
                    class="flex w-full min-w-0 flex-col items-center gap-2 rounded-md px-1 pt-3 pb-2.5 focus-ring"
                    title={accounts().length === 1 ? accountLabel(accounts()[0]!) : undefined}
                    onClick={() => toggle(platform.id)}
                  >
                    <PlatformLogo id={platform.id} class="size-8 rounded-lg" />
                    <span class="max-w-full truncate text-xs" classList={{ "text-foreground": on(), "text-muted-foreground group-hover:text-foreground": !on() }}>
                      {platform.name}
                    </span>
                  </button>
                  <Show when={(accounts().length > 1 && on()) || unpicked()}>
                    <div class="-mt-2 flex max-w-full justify-center px-1 pb-2">
                      <AccountSelect
                        short
                        platform={platform.id}
                        value={props.accounts?.[platform.id]}
                        onChange={(ids) => apply([...props.value], { ...props.accounts, [platform.id]: ids })}
                      />
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    );
  }

  return (
    <div class="grid gap-1.5" style={{ "grid-template-columns": `repeat(${props.columns ?? 3}, minmax(0, 1fr))` }}>
      <For each={offered()}>
        {(platform) => {
          const on = () => props.value.includes(platform.id);
          const accounts = () => connectionsFor(platform.id);
          const unpicked = () => on() && accounts().length > 0 && !accountsFor(platform.id, props.accounts).length;
          return (
            <div
              class="group flex min-w-0 flex-col justify-center rounded-md border press"
              classList={{
                "border-primary/70 bg-primary/10": on(),
                "border-(--border-input) hover:bg-accent": !on(),
              }}
            >
              <button
                type="button"
                aria-pressed={on()}
                class="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-ring"
                onClick={() => toggle(platform.id)}
              >
                <PlatformLogo id={platform.id} class="size-6" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-xs" classList={{ "text-foreground": on(), "text-muted-foreground group-hover:text-foreground": !on() }}>
                    {platform.name}
                  </span>
                  <Show when={accounts().length === 1 && !unpicked()}>
                    <span class="truncate text-xs leading-3 text-muted-foreground">@{accounts()[0]!.handle}</span>
                  </Show>
                  <Show when={accounts().length > 1 && !on()}>
                    <span class="truncate text-xs leading-3 text-muted-foreground">{t("{count, plural, one {# account} other {# accounts}}", { count: accounts().length })}</span>
                  </Show>
                </span>
                <span
                  class="grid size-4 shrink-0 place-items-center rounded-full border transition-colors"
                  classList={{ "border-primary bg-primary text-primary-foreground": on(), "border-(--border-input)": !on() }}
                >
                  <Show when={on()}>
                    <CheckMark class="size-2.5" />
                  </Show>
                </span>
              </button>
              <Show when={(accounts().length > 1 && on()) || unpicked()}>
                <div class="-mt-1 pr-2.5 pb-1.5 pl-[42px]">
                  <AccountSelect
                    platform={platform.id}
                    value={props.accounts?.[platform.id]}
                    onChange={(ids) => apply([...props.value], { ...props.accounts, [platform.id]: ids })}
                  />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export function CheckMark(props: { class?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class={cx("size-2.5 shrink-0", props.class)}>
      <path d="M2.5 6.25 5 8.75 9.5 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function Segmented<T extends string>(props: {
  options: readonly { id: T; label: string; badge?: string }[];
  value: T | null;
  onChange(value: T): void;
  class?: string;
  label?: string;
}) {
  return (
    <div
      class={cx("grid gap-0.5 rounded-md bg-accent p-0.5", props.class)}
      style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label={props.label}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.id}
            class="cap-trim h-6 truncate rounded-md px-2 text-xs font-medium press focus-ring"
            classList={{
              "bg-background text-foreground shadow-xs": props.value === option.id,
              "text-muted-foreground hover:text-foreground": props.value !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            {t(option.label)}
            <Show when={option.badge}>
              <span class="ml-1 font-normal text-muted-foreground">{t(option.badge!)}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

export function SwitchRow(props: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }) {
  return (
    <Switch
      checked={props.checked}
      disabled={props.disabled}
      onChange={(checked) => {
        if (!props.disabled) props.onChange(checked);
      }}
      class="flex items-center justify-between gap-3 data-[disabled]:opacity-50"
    >
      <SwitchLabel class="min-w-0 flex-1 cursor-pointer text-sm font-normal data-[disabled]:cursor-not-allowed">
        <span class="block text-foreground">{props.label}</span>
        <Show when={props.description}>
          <span class="mt-0.5 block text-xs text-muted-foreground">{props.description}</span>
        </Show>
      </SwitchLabel>
      <SwitchInput />
      <SwitchControl variant="compact" class="cursor-pointer">
        <SwitchThumb variant="compact" />
      </SwitchControl>
    </Switch>
  );
}

export function Field(props: { label: string; trailing?: JSX.Element; children: JSX.Element; class?: string }) {
  return (
    <label class={cx("flex min-w-0 flex-col gap-1", props.class)}>
      <span class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {props.label}
        {props.trailing}
      </span>
      {props.children}
    </label>
  );
}

/** Unlike `Field`, a click on the name presses none of the controls. */
export function FieldGroup(props: { label: string; trailing?: JSX.Element; hint?: string; children: JSX.Element; class?: string }) {
  return (
    <div class={cx("flex min-w-0 flex-col gap-1", props.class)}>
      <span class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {props.label}
        {props.trailing}
      </span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-xs text-muted-foreground">{props.hint}</span>
      </Show>
    </div>
  );
}

export function TagInput(props: {
  label: string;
  value: readonly string[];
  onChange(next: string[]): void;
  clean(raw: string): string | null;
  placeholder?: string;
  prefix?: string;
  max?: number;
}) {
  const [draft, setDraft] = createSignal("");
  const [rejected, setRejected] = createSignal(false);
  let input!: HTMLInputElement;
  const full = () => props.max !== undefined && props.value.length >= props.max;

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return true;
    const next = [...props.value];
    let ok = true;
    for (const part of parts) {
      const value = props.clean(part);
      if (!value) ok = false;
      else if (!next.some((item) => item.toLowerCase() === value.toLowerCase()) && (props.max === undefined || next.length < props.max)) next.push(value);
    }
    if (next.length !== props.value.length) props.onChange(next);
    setRejected(!ok);
    return ok;
  };

  const commit = () => {
    if (add(draft())) setDraft("");
  };

  return (
    <div
      class={cx(fieldControlBase, "flex min-h-7 cursor-text flex-wrap items-center gap-1 px-1.5 py-1 focus-within:border-primary", rejected() && "border-destructive/70 focus-within:border-destructive/70")}
      onClick={() => input.focus()}
    >
      <For each={props.value}>
        {(item) => (
          <span class="flex h-5 max-w-full items-center gap-0.5 rounded bg-secondary pl-1.5 pr-0.5 text-xs text-foreground">
            <span class="truncate">
              {props.prefix}
              {item}
            </span>
            <button
              type="button"
              aria-label={t("Remove {item}", { item: `${props.prefix ?? ""}${item}` })}
              class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground press hover:bg-white/10 hover:text-foreground focus-ring"
              onClick={(event) => {
                event.stopPropagation();
                props.onChange(props.value.filter((other) => other !== item));
              }}
            >
              <Icon name="close-remove-small" class="size-4" />
            </button>
          </span>
        )}
      </For>
      <input
        ref={input}
        aria-label={props.label}
        class="h-5 min-w-24 flex-1 bg-transparent px-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        placeholder={full() ? "" : props.value.length ? t("Add another") : props.placeholder}
        disabled={full()}
        value={draft()}
        onInput={(event) => {
          const text = event.currentTarget.value;
          setRejected(false);
          if (/[,\n]/.test(text)) {
            const cut = text.lastIndexOf(",") > text.lastIndexOf("\n") ? text.lastIndexOf(",") : text.lastIndexOf("\n");
            const rest = text.slice(cut + 1);
            if (add(text.slice(0, cut))) setDraft(rest);
            else setDraft(text);
            event.currentTarget.value = draft();
          } else setDraft(text);
        }}
        onPaste={(event) => {
          const text = event.clipboardData?.getData("text") ?? "";
          if (!/[,\n]/.test(text)) return;
          event.preventDefault();
          if (add(draft() + text)) setDraft("");
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && !draft() && props.value.length) {
            props.onChange(props.value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function CharCount(props: { count: number; limit: number; class?: string }) {
  return (
    <span
      class={cx("tabular-nums", props.class)}
      classList={{
        "text-destructive": props.count > props.limit,
        "text-muted-foreground": props.count <= props.limit,
      }}
    >
      {props.count.toLocaleString(intlLocale())} / {props.limit.toLocaleString(intlLocale())}
    </span>
  );
}

export function FormSection(props: { title: string; hint?: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex min-h-6 items-center gap-2">
        <h2 class="shrink-0 text-sm font-medium text-foreground">{props.title}</h2>
        <Show when={props.hint}>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{props.hint}</span>
        </Show>
        <Show when={!props.hint}>
          <span class="flex-1" />
        </Show>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export const dropZoneAction =
  "flex h-7 items-center gap-1 rounded-md bg-secondary px-3 text-xs font-medium text-foreground press hover:bg-secondary-hover focus-ring";

export function DropZone(props: {
  title: string;
  hint: string;
  icon?: string;
  dragging: boolean;
  onPick(): void;
  pickLabel: string;
  actions?: JSX.Element;
  class?: string;
  handlers: {
    onDragOver(event: DragEvent): void;
    onDragEnter(event: DragEvent): void;
    onDragLeave(event: DragEvent): void;
    onDrop(event: DragEvent): void;
  };
}) {
  return (
    <div
      class={cx(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
        props.dragging ? "border-primary bg-primary/5" : "border-(--border-input)",
        props.class,
      )}
      {...props.handlers}
    >
      <span class="grid size-10 place-items-center rounded-full bg-accent text-muted-foreground">
        <Icon name={props.icon ?? "video"} class="size-6" />
      </span>
      <div class="flex flex-col gap-1">
        <p class="text-sm text-foreground">{props.title}</p>
        <p class="text-xs text-muted-foreground">{props.hint}</p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1.5">
        <button type="button" class={dropZoneAction} onClick={() => props.onPick()}>
          <span class="cap-centered">{props.pickLabel}</span>
        </button>
        {props.actions}
      </div>
    </div>
  );
}

export function createDropHandlers(onFiles: (files: File[]) => void, setDragging: (on: boolean) => void, read: (event: DragEvent) => File[]) {
  let depth = 0;
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
  return {
    onDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    },
    onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    },
    onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    },
    onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles(read(event));
    },
  };
}
