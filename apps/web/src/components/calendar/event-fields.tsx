/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A } from "@solidjs/router";
import { For, Match, Show, Switch, createEffect, createSignal, createUniqueId } from "solid-js";
import { reconcile, type SetStoreFunction } from "solid-js/store";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { askForAccount } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { appRoute } from "@/hooks/use-project-route";
import { AccountSelect } from "@/components/publish/controls";
import { DatePicker, TimePicker } from "@/components/publish/date-time-picker";
import { VaultPicker } from "@/components/publish/vault-picker";
import { accountsFor, accountsForPlatforms, connectionsFor, loadSocialConnections, socialConnections, type AccountChoices } from "@/lib/social-connections";
import { insertVaultText } from "@/lib/vault";
import { fieldControl, fieldControlBase, fieldLabel } from "./popup";
import {
  cn,
  DURATION_OPTIONS,
  PLATFORMS,
  STATUS_OPTIONS,
  durationLabel,
  platformName,
  platformShort,
} from "./utils";
import type { CalendarEvent, EventDraft, PostStatus } from "./types";

type EventFieldsProps = {
  draft: EventDraft;
  setDraft: SetStoreFunction<EventDraft>;
  showDate?: boolean;
};

function durationChoices(current: number) {
  return [...new Set([...DURATION_OPTIONS, current])].filter(Number.isFinite).sort((a, b) => a - b);
}

/** Title, date, time, platforms and the rest of a post, for create and edit. */
export function EventFields(props: EventFieldsProps) {
  const allDayId = createUniqueId();
  const captionId = createUniqueId();

  return (
    <>
      <label class="block">
        <span class={fieldLabel}>{t("Title")}</span>
        <input
          data-autofocus
          class={fieldControl}
          placeholder={t("What are you posting?")}
          value={props.draft.title}
          onInput={(event) => props.setDraft("title", event.currentTarget.value)}
        />
      </label>
      <Show when={props.showDate}>
        <div>
          <span class={fieldLabel}>{t("Date")}</span>
          <DatePicker label={t("Date")} value={props.draft.day} onChange={(day) => props.setDraft("day", day)} />
        </div>
      </Show>
      <label class="flex w-fit cursor-pointer select-none items-center gap-2 text-xs text-foreground" for={allDayId}>
        <input
          id={allDayId}
          type="checkbox"
          class="size-3.5 accent-(--primary)"
          checked={props.draft.allDay}
          onChange={(event) => props.setDraft("allDay", event.currentTarget.checked)}
        />
        {t("No set time")}
      </label>
      <div class={cn("grid grid-cols-2 gap-2.5", props.draft.allDay && "opacity-50")} aria-disabled={props.draft.allDay}>
        <div class="min-w-0">
          <span class={fieldLabel}>{t("Posts at")}</span>
          <TimePicker
            label={t("Posts at")}
            value={props.draft.start}
            disabled={props.draft.allDay}
            onChange={(time) => props.setDraft("start", time)}
          />
        </div>
        <label class="min-w-0">
          <span class={fieldLabel}>{t("Duration")}</span>
          <select
            class={fieldControl}
            disabled={props.draft.allDay}
            value={String(props.draft.duration)}
            onChange={(event) => props.setDraft("duration", Number(event.currentTarget.value))}
          >
            <For each={durationChoices(props.draft.duration)}>
              {(minutes) => <option value={String(minutes)}>{durationLabel(minutes)}</option>}
            </For>
          </select>
        </label>
      </div>
      <PlatformsField
        value={props.draft.platforms}
        accounts={props.draft.accounts}
        onChange={(platforms, accounts) => {
          props.setDraft("platforms", platforms);
          props.setDraft("accounts", reconcile(accounts));
        }}
      />
      <label class="block">
        <span class={fieldLabel}>{t("Status")}</span>
        <StatusSelect value={props.draft.status} onChange={(status) => props.setDraft("status", status)} />
      </label>
      <label class="block">
        <span class={fieldLabel}>{t("Link")}</span>
        <input
          class={fieldControl}
          placeholder="https://…"
          value={props.draft.link}
          onInput={(event) => props.setDraft("link", event.currentTarget.value)}
        />
      </label>
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label for={captionId} class="text-xs text-muted-foreground">
            {t("Caption")}
          </label>
          <VaultPicker
            class="-my-1 -mr-1 h-5"
            onPick={(item) => props.setDraft("description", insertVaultText(props.draft.description, item))}
          />
        </div>
        <textarea
          id={captionId}
          class={cn(fieldControlBase, "min-h-14 resize-none py-1.5 leading-relaxed")}
          placeholder={t("Write the caption or add notes")}
          rows={3}
          value={props.draft.description}
          onInput={(event) => props.setDraft("description", event.currentTarget.value)}
        />
      </div>
    </>
  );
}

export function StatusSelect(props: { onChange(status: PostStatus): void; value: PostStatus }) {
  const auth = useAuth();
  const choose = (select: HTMLSelectElement) => {
    const status = select.value as PostStatus;
    // Scheduling needs an account: a guest's post stays as it was, and they're asked to make one.
    if (status === "scheduled" && auth.isGuest()) {
      select.value = props.value;
      askForAccount({ reason: "schedule" });
      return;
    }
    props.onChange(status);
  };
  return (
    <select class={fieldControl} value={props.value} onChange={(event) => choose(event.currentTarget)}>
      <For each={STATUS_OPTIONS}>{(option) => <option value={option.value}>{t(option.label)}</option>}</For>
    </select>
  );
}

/** Where a post goes. Collapsed, it shows the picked platforms. */
export function PlatformsField(props: {
  accounts: AccountChoices;
  onChange(platforms: string[], accounts: AccountChoices): void;
  value: string[];
}) {
  const auth = useAuth();
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
  });

  const available = () => PLATFORMS.filter((platform) => connectionsFor(platform.id).length > 0);

  const apply = (ids: string[]) => {
    const order = PLATFORMS.map((platform) => platform.id as string);
    const platforms = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    props.onChange(platforms, accountsForPlatforms(platforms, props.accounts, { keepRemoved: true }));
  };

  const toggle = (id: string) => {
    apply(props.value.includes(id) ? props.value.filter((item) => item !== id) : [...props.value, id]);
  };

  return (
    <div>
      <button
        type="button"
        aria-expanded={open()}
        class="flex h-7 w-full items-center justify-between gap-2 rounded-md border border-(--border-input) bg-input px-2 text-left outline-none transition-colors hover:bg-accent focus-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <span class="text-xs text-muted-foreground">{t("Platforms")}</span>
        <span class="flex min-w-0 items-center gap-1.5">
          <Show when={!open()}>
            <Show when={props.value.length > 0} fallback={<span class="text-xs text-muted-foreground">{t("None yet")}</span>}>
              <PlatformBadges platforms={props.value} />
            </Show>
          </Show>
          <Icon name="chevron-down" class={cn("size-5 shrink-0 text-muted-foreground transition-transform", open() && "rotate-180")} />
        </span>
      </button>
      <Show when={open()}>
        <Show
          when={socialConnections().length > 0}
          fallback={
            <A href={appRoute("connections")} class="mt-1.5 block text-xs text-primary outline-none hover:underline focus-ring">
              {t("Connect an account")}
            </A>
          }
        >
          <div class="mt-1.5 flex flex-wrap gap-1">
            <For each={available()}>
              {(platform) => {
                const selected = () => props.value.includes(platform.id);
                const accounts = () => connectionsFor(platform.id);
                // The accounts it named here were removed: it goes out from none until one is picked.
                const unpicked = () => selected() && !accountsFor(platform.id, props.accounts).length;
                return (
                  <span
                    class={cn(
                      "flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-xs press",
                      selected()
                        ? "border-primary/60 bg-primary/15 text-foreground"
                        : "border-(--border-input) text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <button type="button" aria-pressed={selected()} class="flex items-center gap-1.5 rounded-sm outline-none focus-ring" onClick={() => toggle(platform.id)}>
                      <PlatformBadge id={platform.id} />
                      {platform.name}
                      <Show when={accounts().length === 1 && !unpicked()}>
                        <span class="text-muted-foreground">@{accounts()[0]!.handle}</span>
                      </Show>
                      <Show when={accounts().length > 1 && !selected()}>
                        <span class="text-muted-foreground">{t("{count, plural, one {# account} other {# accounts}}", { count: accounts().length })}</span>
                      </Show>
                    </button>
                    <Show when={selected() && (accounts().length > 1 || unpicked())}>
                      <AccountSelect
                        platform={platform.id}
                        value={props.accounts[platform.id]}
                        onChange={(ids) => props.onChange(props.value, { ...props.accounts, [platform.id]: ids })}
                      />
                    </Show>
                  </span>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export function PlatformBadge(props: { class?: string; id: string }) {
  return (
    <span
      title={platformName(props.id)}
      class={cn(
        "grid h-4 min-w-4 shrink-0 place-items-center rounded-sm bg-(--plane-fill-subtle) px-0.5 text-xxs font-medium leading-none text-foreground",
        props.class,
      )}
    >
      {platformShort(props.id)}
    </span>
  );
}

export function PlatformBadges(props: { max?: number; platforms: string[] }) {
  const visible = () => props.platforms.slice(0, props.max ?? props.platforms.length);
  const extra = () => props.platforms.length - visible().length;
  return (
    <span class="flex shrink-0 items-center gap-0.5">
      <For each={visible()}>{(id) => <PlatformBadge id={id} />}</For>
      <Show when={extra() > 0}>
        <span class="text-xs leading-none opacity-70">+{extra()}</span>
      </Show>
    </span>
  );
}

/** A solid badge for a post being sent that needs a look: going out, waiting to, or failed. A posted one has none. */
export function StatusMark(props: { event: Pick<CalendarEvent, "delivery" | "waiting"> }) {
  return (
    <Switch>
      <Match when={props.event.delivery === "sending" && props.event.waiting}>
        {(waiting) => <HeldMark title={t(waiting())} />}
      </Match>
      <Match when={props.event.delivery === "sending"}>
        <span title={t("Sending")} class="grid size-3.5 shrink-0 place-items-center">
          <Icon name="spinner-loader" class="size-6 shrink-0 animate-spin text-primary" />
        </span>
      </Match>
      <Match when={props.event.delivery === "failed"}>
        <span title={t("Didn't go out")} class="grid size-3.5 shrink-0 place-items-center rounded-full bg-destructive text-white">
          <svg viewBox="0 0 14 14" class="size-3.5" aria-hidden="true">
            <path d="M7 3.75v4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            <circle cx="7" cy="10.1" r="1" fill="currentColor" />
          </svg>
        </span>
      </Match>
    </Switch>
  );
}

/** A scheduled post that won't go out as it shows for now: a failed post's mark, in the colour of one past due. */
export function HeldMark(props: { title: string }) {
  return (
    <span title={props.title} class="grid size-3.5 shrink-0 place-items-center rounded-full bg-meter-yellow text-black">
      <svg viewBox="0 0 14 14" class="size-3.5" aria-hidden="true">
        <path d="M7 3.75v4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
        <circle cx="7" cy="10.1" r="1" fill="currentColor" />
      </svg>
    </span>
  );
}
