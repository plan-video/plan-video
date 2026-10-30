/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { toast } from "somoto";

import { DashboardFilterCount, DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";
import { TemplatesArt } from "@/components/dashboard/empty-art";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { cadencePhrase, localDateKey } from "@/components/calendar/utils";
import { TimePicker } from "@/components/publish/date-time-picker";
import { PlatformLogos, PlatformPicker, Segmented, fieldControl, fieldControlBase } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { intlLocale, msg, t } from "@/lib/i18n";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  emptyTemplate,
  loadTemplates,
  postTemplates,
  queueTemplate,
  restoreTemplate,
  searchTemplates,
  toggleTemplatePin,
  updateTemplate,
  type PostTemplate,
  type TemplateDraft,
  type TemplateWhen,
} from "@/lib/post-templates";
import { captionLength, listNames } from "@/lib/social";
import { loadSocialConnections } from "@/lib/social-connections";

type Editing = { id: string | null; draft: TemplateDraft };

const WHEN_OPTIONS: { id: TemplateWhen; label: string }[] = [
  { id: "none", label: msg("No set time") },
  { id: "time", label: msg("At a time") },
  { id: "queue", label: msg("Queue slot") },
];

function repeatLabel(repeat: string): string | null {
  return repeat ? cadencePhrase(repeat, localDateKey(new Date())) : null;
}

function whenLabel(template: Pick<PostTemplate, "when" | "time" | "repeat">): string {
  if (template.when === "queue") return t("Next queue slot");
  if (template.when === "none") return t("No set time");
  const repeats = repeatLabel(template.repeat);
  return repeats ? t("At {time}, {repeats}", { time: template.time, repeats }) : t("At {time}", { time: template.time });
}

function copyDraft(template: TemplateDraft): TemplateDraft {
  return structuredClone({
    name: template.name,
    platforms: [...template.platforms],
    accounts: unwrap(template.accounts),
    caption: template.caption,
    overrides: unwrap(template.overrides),
    settings: unwrap(template.settings),
    signature: template.signature,
    thread: unwrap(template.thread),
    when: template.when,
    time: template.time,
    repeat: template.repeat,
  });
}

export function DashboardTemplatesView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = createSignal("");
  const [editing, setEditing] = createSignal<Editing | null>(null);

  createEffect(() => {
    loadTemplates(auth.user()?.id);
    loadSocialConnections(auth.user()?.id);
  });

  const results = () => searchTemplates(postTemplates(), query());

  const startNew = () => setEditing({ id: null, draft: emptyTemplate() });
  const startEdit = (template: PostTemplate) => setEditing({ id: template.id, draft: copyDraft(template) });

  const use = (template: PostTemplate) => {
    queueTemplate(template);
    setParams({ dashboard: "new-post", date: undefined, view: undefined });
  };

  const remove = (template: PostTemplate) => {
    deleteTemplate(template.id);
    toast(t("Deleted {name}", { name: template.name }), { action: { label: t("Undo"), onClick: () => restoreTemplate(template) } });
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (editing()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]"))) return;
      if (event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      startNew();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader>
        <Show when={postTemplates().length}>
          <DashboardFilterCount shown={results().length} total={postTemplates().length} />
          <DashboardHeaderSearch value={query()} placeholder={t("Search")} label={t("Search templates")} onInput={setQuery} class="w-48" />
          <PlaneButton variant="primary" size="lg" class="gap-1 pl-1.5" onClick={startNew}>
            <PlaneIcon name="plus" class="size-3.5" />
            {t("New")}
          </PlaneButton>
        </Show>
      </DashboardPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex w-full flex-col gap-3 px-6 pt-6 pb-24">
          <Show when={postTemplates().length} fallback={<EmptyTemplates onNew={startNew} onCompose={() => setParams({ dashboard: "new-post" })} />}>
            <Show
              when={results().length}
              fallback={<p class="py-16 text-center text-xs text-muted-foreground">{t("No template matches “{query}”.", { query: query() })}</p>}
            >
              <div class="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                <For each={results()}>
                  {(template) => (
                    <TemplateCard
                      template={template}
                      onEdit={() => startEdit(template)}
                      onUse={() => use(template)}
                      onDuplicate={() => {
                        const made = duplicateTemplate(template.id);
                        if (made && "error" in made) toast.error(t(made.error));
                      }}
                      onDelete={() => remove(template)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={editing()} keyed>
        {(current) => <TemplateEditor editing={current} onClose={() => setEditing(null)} onDelete={remove} />}
      </Show>
    </div>
  );
}

function EmptyTemplates(props: { onNew(): void; onCompose(): void }) {
  return (
    <div class="flex flex-col items-center gap-8 pt-8 text-center">
      <div class="flex flex-col items-center gap-4">
        <TemplatesArt />
        <div class="flex flex-col gap-1">
          <h2 class="text-sm font-medium text-foreground">{t("Set a post up once, start from it every time")}</h2>
          <p class="text-xs text-muted-foreground">{t("Where it goes, the caption, each platform's settings and the time. You bring the video.")}</p>
        </div>
      </div>
      <div class="grid w-full max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
        <StartTile
          icon="plus"
          title={t("New template")}
          hint={t("Pick the platforms, write the caption and choose when posts go out.")}
          onClick={() => props.onNew()}
        />
        <StartTile
          icon="edit"
          title={t("Save one from New post")}
          hint={t("Set a post up, then choose Save as template from the Templates menu.")}
          onClick={() => props.onCompose()}
        />
      </div>
    </div>
  );
}

function StartTile(props: { icon: "plus" | "edit"; title: string; hint: string; onClick(): void }) {
  return (
    <button
      type="button"
      class="depth-card flex flex-col items-start gap-1.5 rounded-xl border border-border-strong bg-accent/30 p-3 text-left hover:border-(--border-input) focus-ring"
      onClick={() => props.onClick()}
    >
      <span class="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <PlaneIcon name={props.icon} class="size-3.5 text-muted-foreground" />
        {props.title}
      </span>
      <span class="text-xs leading-4 text-muted-foreground">{props.hint}</span>
    </button>
  );
}

function TemplateCard(props: {
  template: PostTemplate;
  onEdit(): void;
  onUse(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const own = () => Object.keys(props.template.overrides).length;
  const meta = () =>
    [whenLabel(props.template), props.template.uses ? t("{count, plural, =1 {Used once} other {Used # times}}", { count: props.template.uses }) : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <article class="depth-card group flex min-w-0 flex-col rounded-xl border border-border-strong bg-accent/30 hover:border-(--border-input)">
      <div class="flex items-center gap-2 pl-3 pr-1.5 pt-2">
        <button type="button" class="min-w-0 flex-1 truncate rounded-md text-left text-xs font-medium text-foreground focus-ring" onClick={() => props.onEdit()}>
          {props.template.name}
        </button>
        <button
          type="button"
          aria-pressed={props.template.pinned}
          aria-label={props.template.pinned ? t("Unpin") : t("Pin to the top")}
          class="grid size-7 shrink-0 place-items-center rounded-md press hover:bg-accent focus-ring"
          classList={{ "opacity-0 group-hover:opacity-100 focus-visible:opacity-100": !props.template.pinned }}
          onClick={() => toggleTemplatePin(props.template.id)}
        >
          <Icon name={props.template.pinned ? "favorited" : "favorite"} class="size-4 text-muted-foreground" />
        </button>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as="button"
            type="button"
            aria-label={t("More")}
            class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
          >
            <Icon name="more-three-dots-small-horizontal" class="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-40">
              <DropdownMenuItem tone="neutral" onSelect={() => props.onEdit()}>
                {t("Edit")}
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={() => props.onDuplicate()}>
                {t("Duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" onSelect={() => toggleTemplatePin(props.template.id)}>
                {props.template.pinned ? t("Unpin") : t("Pin to the top")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete()}>
                {t("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>

      <div class="mx-3 mt-1.5 flex h-5 items-center gap-2">
        <Show when={props.template.platforms.length} fallback={<span class="text-xs text-muted-foreground">{t("No platforms picked")}</span>}>
          <PlatformLogos ids={props.template.platforms} logoClass="size-4.5" />
        </Show>
      </div>

      <button
        type="button"
        class="mx-3 mt-2 line-clamp-4 min-h-10 whitespace-pre-line break-words rounded-md text-left text-xs leading-5 text-muted-foreground focus-ring"
        onClick={() => props.onEdit()}
      >
        <Show when={props.template.caption.trim()} fallback={<span class="italic text-muted-foreground/70">{t("No caption")}</span>}>
          {props.template.caption}
        </Show>
      </button>

      <Show when={own()}>
        <p class="mx-3 mt-1.5 text-xs text-muted-foreground">
          {t("{count, plural, one {{names} has a caption of its own} other {{names} have captions of their own}}", {
            count: own(),
            names: listNames(props.template.platforms.filter((id) => props.template.overrides[id] !== undefined)),
          })}
        </p>
      </Show>

      <Show when={props.template.thread.length}>
        <p class="mx-3 mt-1.5 text-xs text-muted-foreground">
          {t("{count, plural, one {Has a thread of # follow-up} other {Has a thread of # follow-ups}}", { count: props.template.thread.length })}
        </p>
      </Show>

      <div class="mt-auto flex items-center gap-2 pl-3 pr-2 pt-3 pb-2">
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{meta()}</span>
        <Button variant="secondary" onClick={() => props.onUse()}>
          {t("Use")}
        </Button>
      </div>
    </article>
  );
}

function TemplateEditor(props: { editing: Editing; onClose(): void; onDelete(template: PostTemplate): void }) {
  const [draft, setDraft] = createStore<TemplateDraft>(copyDraft(props.editing.draft));
  const [error, setError] = createSignal<string | null>(null);
  let name: HTMLInputElement | undefined;
  const isNew = () => props.editing.id === null;
  const own = () => draft.platforms.filter((id) => draft.overrides[id] !== undefined);

  const save = () => {
    const id = props.editing.id;
    if (id === null) {
      const made = createTemplate(draft);
      if ("error" in made) return setError(made.error);
      toast.success(t("Template saved"), { description: draft.name.trim() || undefined });
    } else {
      const failed = updateTemplate(id, draft);
      if (failed) return setError(failed);
    }
    props.onClose();
  };

  const remove = () => {
    const template = postTemplates().find((row) => row.id === props.editing.id);
    if (!template) return;
    props.onDelete(template);
    props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          class="flex max-h-[min(720px,90vh)] w-[600px] max-w-11/12 flex-col gap-0 overflow-hidden rounded-xl border-border p-0"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            name?.focus();
          }}
        >
          <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-4 pr-1.5">
            <p class="min-w-0 flex-1 truncate text-xs text-foreground">{isNew() ? t("New template") : t("Edit template")}</p>
            <Button size="icon-square" variant="ghost" aria-label={t("Close")} onClick={() => props.onClose()}>
              <Icon name="close-remove" class="text-foreground" />
            </Button>
          </div>

          <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Name")}</span>
              <input
                ref={name}
                class={fieldControl}
                placeholder={t("Weekly clip")}
                value={draft.name}
                onInput={(event) => {
                  setDraft("name", event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>

            <div class="flex flex-col gap-1.5">
              <span class="text-xs text-muted-foreground">{t("Post to")}</span>
              <PlatformPicker
                value={draft.platforms}
                accounts={draft.accounts}
                onChange={(ids, accounts) => {
                  setDraft("platforms", ids);
                  setDraft("accounts", reconcile(accounts));
                  setError(null);
                }}
              />
            </div>

            <label class="flex flex-col gap-1">
              <span class="flex items-center justify-between text-xs text-muted-foreground">
                {t("Caption")}
                <span class="tabular-nums">
                  {t("{count, plural, one {{number} character} other {{number} characters}}", {
                    count: captionLength(draft.caption),
                    number: captionLength(draft.caption).toLocaleString(intlLocale()),
                  })}
                </span>
              </span>
              <textarea
                class={cx(fieldControlBase, "min-h-32 resize-y py-2 leading-relaxed")}
                placeholder={t("Write the caption the posts start with. You can change it on each post.")}
                value={draft.caption}
                onInput={(event) => {
                  setDraft("caption", event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>
            <Show when={own().length}>
              <p class="-mt-2 text-xs text-muted-foreground">
                {t(
                  "{count, plural, one {{names} keeps a caption of its own, from the post it was saved from.} other {{names} keep captions of their own, from the post it was saved from.}}",
                  { count: own().length, names: listNames(own()) },
                )}
              </p>
            </Show>
            <Show when={draft.thread.length}>
              <p class="-mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <span class="min-w-0 flex-1">
                  {t("{count, plural, one {Keeps a thread of # follow-up, from the post it was saved from.} other {Keeps a thread of # follow-ups, from the post it was saved from.}}", {
                    count: draft.thread.length,
                  })}
                </span>
                <button type="button" class="shrink-0 rounded-md text-foreground underline-offset-2 hover:underline focus-ring" onClick={() => setDraft("thread", [])}>
                  {t("Remove")}
                </button>
              </p>
            </Show>

            <div class="flex flex-col gap-1.5">
              <span class="text-xs text-muted-foreground">{t("Goes out")}</span>
              <div class="flex items-center gap-2">
                <Segmented label={t("Goes out")} class="flex-1" options={WHEN_OPTIONS} value={draft.when} onChange={(next) => setDraft("when", next)} />
                <Show when={draft.when === "time"}>
                  <div class="w-32 shrink-0">
                    <TimePicker label={t("Time")} value={draft.time} onChange={(time) => setDraft("time", time)} />
                  </div>
                </Show>
              </div>
              <Show when={draft.when === "time" && draft.repeat}>
                <p class="flex items-center gap-1 text-xs text-muted-foreground">
                  <span class="min-w-0 flex-1 truncate">{t("Repeats {repeats}.", { repeats: repeatLabel(draft.repeat) })}</span>
                  <button type="button" class="rounded-md text-foreground underline-offset-2 hover:underline focus-ring" onClick={() => setDraft("repeat", "")}>
                    {t("Post once")}
                  </button>
                </p>
              </Show>
              <Show when={draft.when === "queue"}>
                <p class="text-xs text-muted-foreground">{t("Each post takes the next free slot in your queue.")}</p>
              </Show>
            </div>

            <Show when={error()}>
              <p class="text-xs text-destructive">{t(error() ?? "")}</p>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
            <Show when={!isNew()}>
              <Button variant="ghost" class="-ml-2 text-destructive" onClick={remove}>
                {t("Delete")}
              </Button>
            </Show>
            <span class="flex-1" />
            <Button variant="secondary" onClick={() => props.onClose()}>
              {t("Cancel")}
            </Button>
            <Button class="px-3" disabled={!draft.name.trim()} onClick={save}>
              {isNew() ? t("Save") : t("Save changes")}
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
