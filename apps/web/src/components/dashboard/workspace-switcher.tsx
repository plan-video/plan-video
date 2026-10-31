/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createSignal, type JSX } from "solid-js";
import { toast } from "somoto";

import { fieldControl, fieldLabel } from "@/components/calendar/popup";
import { CALENDAR_COLOR_PRESETS, colorHex, swatchStyle } from "@/components/calendar/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MARK_PATH } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { useAuth } from "@/context/auth";
import { cx } from "@/lib/cva";
import { askForAccount } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { showInvite, teamInvites } from "@/lib/team";
import {
  activeWorkspace,
  createWorkspace,
  sharedWorkspaces,
  shownWorkspaceName,
  switchWorkspace,
  workspaceIcon,
  workspaces,
  type SharedWorkspace,
  type Workspace,
} from "@/lib/workspaces";

/** Three rows of seven with the custom swatch. */
export const WORKSPACE_COLORS: { value: string; label: string }[] = [
  ...CALENDAR_COLOR_PRESETS.map((value) => ({ value: value as string, label: value })),
  { value: "#7AA33A", label: msg("lime") },
  { value: "#6E7B3B", label: msg("olive") },
  { value: "#E07A5F", label: msg("coral") },
  { value: "#8B6A4F", label: msg("brown") },
  { value: "#A8916E", label: msg("sand") },
  { value: "#64748B", label: msg("slate") },
  { value: "#3F444C", label: msg("graphite") },
];

type BadgeWorkspace = Pick<Workspace, "name" | "color" | "icon" | "shape"> & { id?: string };

export function WorkspaceBadge(props: { workspace: BadgeWorkspace; class?: string }) {
  const icon = () => workspaceIcon(props.workspace);
  const shape = () => (props.workspace.shape === "circle" ? "rounded-full" : undefined);
  const initials = () => {
    const current = icon();
    const chosen = current.type === "letters" ? current.value : undefined;
    return chosen || [...props.workspace.name.trim()][0]?.toUpperCase() || "W";
  };

  return (
    <Switch>
      <Match when={icon().type === "mark"}>
        <svg
          viewBox="0 0 32 32"
          aria-hidden="true"
          class={cx("size-5 shrink-0 rounded-md bg-(--logo-tile) ring-1 ring-inset ring-(--plane-border-subtle)", props.class, shape())}
        >
          <g transform="translate(16 16) scale(0.72) translate(-16 -16)">
            <path class="fill-(--logo-ink)" d={MARK_PATH} />
          </g>
        </svg>
      </Match>
      <Match when={icon().type === "image" && icon()}>
        {(image) => (
          <span
            aria-hidden="true"
            class={cx("relative size-5 shrink-0 overflow-hidden rounded-md", props.class, shape())}
            style={swatchStyle(props.workspace.color)}
          >
            <img src={(image() as { value: string }).value} alt="" class="size-full object-cover" draggable={false} />
            <span class={cx("absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10")} />
          </span>
        )}
      </Match>
      <Match when={icon().type === "emoji" && icon()}>
        {(emoji) => (
          <span
            aria-hidden="true"
            class={cx(
              "grid size-5 shrink-0 place-items-center rounded-md text-xxs leading-none ring-1 ring-inset ring-white/10",
              props.class,
              shape(),
            )}
            style={{ "background-color": `color-mix(in srgb, ${colorHex(props.workspace.color)} 28%, transparent)` }}
          >
            <span class="scale-[1.15]">{(emoji() as { value: string }).value}</span>
          </span>
        )}
      </Match>
      <Match when={icon().type === "letters"}>
        <span
          aria-hidden="true"
          class={cx(
            "grid size-5 shrink-0 place-items-center rounded-md text-xxs font-medium leading-none text-white ring-1 ring-inset ring-white/10",
            props.class,
            shape(),
          )}
          style={swatchStyle(props.workspace.color)}
        >
          <span class={initials().length > 1 ? "text-[0.8em] tracking-[-0.02em]" : undefined}>{initials()}</span>
        </span>
      </Match>
    </Switch>
  );
}

export function WorkspaceColorPicker(props: { value: string; onChange(color: string): void; class?: string }) {
  const custom = () => !WORKSPACE_COLORS.some((option) => option.value === props.value);
  const swatch = "size-6 justify-self-center rounded-md ring-2 ring-offset-2 ring-offset-popover press";

  return (
    <div role="radiogroup" aria-label={t("Color")} class={cx("grid grid-cols-7 gap-2", props.class)}>
      <For each={WORKSPACE_COLORS}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-label={t(option.label)}
            aria-checked={props.value === option.value}
            class={cx(swatch, "outline-none focus-ring", props.value === option.value ? "ring-foreground" : "ring-transparent hover:ring-foreground/30")}
            style={swatchStyle(option.value)}
            onClick={() => props.onChange(option.value)}
          />
        )}
      </For>
      <label
        title={t("Custom color")}
        class={cx(
          swatch,
          "relative cursor-pointer overflow-hidden has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-(--ring) has-[:focus-visible]:-outline-offset-1",
          custom() ? "ring-foreground" : "ring-transparent hover:ring-foreground/30",
        )}
        style={
          custom()
            ? swatchStyle(props.value)
            : { background: "conic-gradient(from 180deg, #E5484F, #C48A22, #3A9558, #2A8498, #5A5EC4, #A84A8E, #E5484F)" }
        }
      >
        <input
          type="color"
          aria-label={t("Custom color")}
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          value={colorHex(props.value).toLowerCase()}
          onInput={(event) => props.onChange(event.currentTarget.value.toUpperCase())}
        />
        <Show when={custom()}>
          <PlaneIcon name="edit" class="pointer-events-none absolute inset-0 m-auto size-3 text-white" />
        </Show>
      </label>
    </div>
  );
}

const menuLabel = "mt-1 mb-0.5 px-2 text-xs text-(--plane-text-tertiary)";
const menuRow = "h-8 min-h-8 gap-2.5 pl-1.5";
const menuBadge = "size-5 rounded-[5px] text-[10px]";

function WorkspaceName(props: { name: string; active: boolean; children?: JSX.Element }) {
  return (
    <>
      <span class={cx("min-w-0 flex-1 truncate", props.active && "font-medium text-(--plane-text-primary)")}>{props.name}</span>
      {props.children}
      <Show when={props.active}>
        <PlaneIcon name="check" class="size-3.5 text-(--plane-text-primary)" />
      </Show>
    </>
  );
}

export function WorkspaceSwitcher(props: { onSettings(): void }) {
  const auth = useAuth();
  const [creating, setCreating] = createSignal(false);
  // A guest's work moves into one workspace when they sign up, so more wait for the account.
  const create = () => (auth.isGuest() ? askForAccount({ reason: "account" }) : setCreating(true));

  const choose = (workspace: Workspace) => {
    if (workspace.id === activeWorkspace().id) return;
    switchWorkspace(workspace.id);
    toast.success(t("Switched to {name}", { name: shownWorkspaceName(workspace.name) }));
  };

  const chooseShared = (workspace: SharedWorkspace) => {
    if (workspace.state !== "active") {
      toast(t("{name} is paused", { name: workspace.name }), {
        description: t("{owner}'s plan doesn't include team members right now. It opens again once they're on Pro or Agency.", {
          owner: workspace.ownerName || workspace.ownerEmail,
        }),
      });
      return;
    }
    if (workspace.id === activeWorkspace().id) return;
    switchWorkspace(workspace.id);
    toast.success(t("Switched to {name}", { name: workspace.name }));
  };

  return (
    <>
      <DropdownMenu placement="bottom-start">
        <DropdownMenuTrigger
          as="button"
          type="button"
          aria-label={t("Workspace: {name}", { name: shownWorkspaceName(activeWorkspace().name) })}
          class="group relative z-30 flex min-w-0 max-w-48 items-center justify-between gap-1 truncate rounded-md p-1 text-left outline-none press hover:bg-(--plane-layer-transparent-hover) focus-ring data-[expanded]:bg-(--plane-layer-transparent-active)"
        >
          <span class="flex min-w-0 flex-grow items-center gap-2 truncate">
            <WorkspaceBadge workspace={activeWorkspace()} class="size-7 rounded-md text-sm font-medium ring-(--plane-border-subtle)" />
            <span class="cap-centered min-w-0 truncate text-sm leading-5 font-medium text-(--plane-text-primary)">{shownWorkspaceName(activeWorkspace().name)}</span>
          </span>
          <PlaneIcon
            name="chevron-down"
            class="size-4 text-(--plane-text-placeholder) transition-transform duration-300 group-data-[expanded]:rotate-180"
          />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-64">
            <DropdownMenuGroup class="gap-px">
              <Show when={sharedWorkspaces().length || teamInvites().length}>
                <DropdownMenuGroupLabel class={menuLabel}>{t("Workspaces")}</DropdownMenuGroupLabel>
              </Show>
              <For each={workspaces()}>
                {(workspace) => (
                  <DropdownMenuItem tone="neutral" class={menuRow} onSelect={() => choose(workspace)}>
                    <WorkspaceBadge workspace={workspace} class={menuBadge} />
                    <WorkspaceName name={shownWorkspaceName(workspace.name)} active={workspace.id === activeWorkspace().id} />
                  </DropdownMenuItem>
                )}
              </For>
            </DropdownMenuGroup>
            <Show when={sharedWorkspaces().length}>
              <DropdownMenuSeparator class="my-1" />
              <DropdownMenuGroup class="gap-px">
                <DropdownMenuGroupLabel class={menuLabel}>{t("Shared with you")}</DropdownMenuGroupLabel>
                <For each={sharedWorkspaces()}>
                  {(workspace) => (
                    <DropdownMenuItem
                      tone="neutral"
                      class={cx(menuRow, workspace.state !== "active" && "text-(--plane-text-tertiary)")}
                      onSelect={() => chooseShared(workspace)}
                    >
                      <WorkspaceBadge workspace={workspace} class={cx(menuBadge, workspace.state !== "active" && "opacity-50")} />
                      <WorkspaceName name={workspace.name} active={workspace.id === activeWorkspace().id}>
                        <Show when={workspace.state !== "active"}>
                          <span class="text-xs text-(--plane-text-tertiary)">{t("Paused")}</span>
                        </Show>
                      </WorkspaceName>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuGroup>
            </Show>
            <Show when={teamInvites().length}>
              <DropdownMenuSeparator class="my-1" />
              <DropdownMenuGroup class="gap-px">
                <DropdownMenuGroupLabel class={menuLabel}>{t("Invites")}</DropdownMenuGroupLabel>
                <For each={teamInvites()}>
                  {(invite) => (
                    <DropdownMenuItem tone="neutral" class={menuRow} onSelect={() => showInvite(invite.id)}>
                      <WorkspaceBadge workspace={invite.look} class={menuBadge} />
                      <span class="min-w-0 flex-1 truncate">{invite.look.name}</span>
                      <span class="text-xs text-primary">{t({ message: "Join", context: "invite" })}</span>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuGroup>
            </Show>
            <DropdownMenuSeparator class="my-1" />
            <DropdownMenuItem tone="neutral" class={menuRow} onSelect={props.onSettings}>
              <span aria-hidden="true" class="grid size-5 shrink-0 place-items-center">
                <PlaneIcon name="settings" class="size-3.5" />
              </span>
              <span class="min-w-0 flex-1 truncate">{t("Workspace settings")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem tone="neutral" class={menuRow} onSelect={create}>
              <span aria-hidden="true" class="grid size-5 shrink-0 place-items-center">
                <PlaneIcon name="plus" class="size-3.5" />
              </span>
              <span class="min-w-0 flex-1 truncate">{t("New workspace")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <Show when={creating()}>
        <WorkspaceFormDialog onClose={() => setCreating(false)} />
      </Show>
    </>
  );
}

export function WorkspaceFormDialog(props: { onClose(): void }) {
  const [name, setName] = createSignal("");
  const [color, setColor] = createSignal(WORKSPACE_COLORS[workspaces().length % WORKSPACE_COLORS.length]!.value);
  const [error, setError] = createSignal<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = createWorkspace({ name: name(), color: color() });
    if ("error" in result) return setError(result.error);
    toast.success(t("Switched to {name}", { name: name().trim() }), {
      description: t("A new workspace starts with no accounts, posts or vault items. Give it a logo on the Workspace page."),
    });
    props.onClose();
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent showCloseButton={false} class="w-80 gap-0 overflow-hidden rounded-xl border-border-strong bg-popover p-0">
          <form onSubmit={submit}>
            <div class="flex items-center justify-between border-b border-border-strong py-2 pl-4 pr-2">
              <p class="text-xs text-foreground">{t("New workspace")}</p>
              <Button type="button" variant="ghost" size="icon-square" aria-label={t("Close")} onClick={props.onClose}>
                <Icon name="close-remove" class="size-6" />
              </Button>
            </div>
            <div class="space-y-4 p-4">
              <p class="text-xs text-muted-foreground">
                {t("One per brand or client. Its accounts, groups, posts, calendar and vault stay apart from your other workspaces.")}
              </p>
              <div class="flex items-end gap-2">
                <WorkspaceBadge workspace={{ name: name() || "W", color: color() }} class="mb-0.5 size-6 rounded-md text-xs" />
                <label class="block min-w-0 flex-1">
                  <span class={fieldLabel}>{t("Name")}</span>
                  <input
                    autofocus
                    class={fieldControl}
                    maxLength={40}
                    placeholder={t("e.g. Acme Coffee")}
                    value={name()}
                    onInput={(event) => {
                      setName(event.currentTarget.value);
                      setError(null);
                    }}
                  />
                </label>
              </div>
              <div>
                <span class={fieldLabel}>{t("Color")}</span>
                <WorkspaceColorPicker value={color()} onChange={setColor} />
              </div>
              <Show when={error()}>
                <p role="alert" class="text-xs text-destructive">{error()}</p>
              </Show>
            </div>
            <div class="flex justify-end gap-1.5 border-t border-border-strong px-4 py-3">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={!name().trim()}>
                {t("Create workspace")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
