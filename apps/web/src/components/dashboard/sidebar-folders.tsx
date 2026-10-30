/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Projects sidebar's folders: open one to see its projects, drop selected
// project cards on one to move them in, and rename or delete one from its menu.

import { For, Show, createSignal } from "solid-js";
import { toast } from "somoto";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import {
  createProjectFolder,
  deleteProjectFolder,
  moveProjectsToFolder,
  projectFolders,
  renameProjectFolder,
  restoreProjectFolder,
  type ProjectFolder,
} from "@/lib/project-folders";

import { DashboardSidebarSection, dashboardNavItemClass, navIconClass } from "./sidebar";

/** What a project card's drag carries: the keys of the projects it moves, as JSON. */
export const PROJECTS_DRAG_TYPE = "application/x-planvideo-projects";

/** The folder whose name is being typed in the sidebar, as after New folder. */
const [editing, setEditing] = createSignal<string | null>(null);

/** Makes a folder, holding `projects` if given, and puts its name up for typing. */
export function startNewFolder(projects: readonly string[] = []): ProjectFolder | undefined {
  const folder = createProjectFolder(projects);
  if (folder) setEditing(folder.id);
  return folder;
}

/** Moves the projects in, and says so. */
export function moveIntoFolder(keys: readonly string[], folder: ProjectFolder) {
  moveProjectsToFolder(keys, folder.id);
  toast(t("{count, plural, one {Moved to {name}} other {Moved # projects to {name}}}", { count: keys.length, name: folder.name }));
}

export function DashboardSidebarFolders(props: { activeId?: string; onOpen(id: string): void; onDeleted(id: string): void }) {
  const remove = (folder: ProjectFolder) => {
    deleteProjectFolder(folder.id);
    props.onDeleted(folder.id);
    toast(t("Deleted {name}", { name: folder.name }), {
      description: t("Its projects are still in All projects."),
      action: { label: t("Undo"), onClick: () => restoreProjectFolder(folder) },
    });
  };

  return (
    <DashboardSidebarSection
      title={t("Folders")}
      action={
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            aria-label={t("New folder")}
            class="grid size-6 place-items-center rounded-md text-(--plane-text-placeholder) outline-none press hover:bg-accent hover:text-(--plane-text-primary) focus-ring"
            onClick={() => startNewFolder()}
          >
            <PlaneIcon name="plus" class="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t("New folder")}</TooltipContent>
        </Tooltip>
      }
    >
      <Show
        when={projectFolders().length > 0}
        fallback={
          <button type="button" onClick={() => startNewFolder()} class={dashboardNavItemClass(false)}>
            <span class="flex min-w-0 items-center gap-1.5 py-px text-(--plane-text-tertiary)">
              <PlaneIcon name="folder" class="size-4" />
              <span class="truncate text-sm leading-5 font-medium">{t("New folder")}</span>
            </span>
          </button>
        }
      >
        <For each={projectFolders()}>
          {(folder) => (
            <FolderRow
              folder={folder}
              active={props.activeId === folder.id}
              onOpen={() => props.onOpen(folder.id)}
              onDelete={() => remove(folder)}
            />
          )}
        </For>
      </Show>
    </DashboardSidebarSection>
  );
}

function FolderRow(props: { folder: ProjectFolder; active: boolean; onOpen(): void; onDelete(): void }) {
  const [dropping, setDropping] = createSignal(false);
  const renaming = () => editing() === props.folder.id;

  const carriesProjects = (event: DragEvent) => !!event.dataTransfer?.types.includes(PROJECTS_DRAG_TYPE);

  const handleDragOver = (event: DragEvent) => {
    if (!carriesProjects(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropping(true);
  };

  const handleDrop = (event: DragEvent) => {
    setDropping(false);
    if (!carriesProjects(event)) return;
    event.preventDefault();
    let keys: unknown;
    try {
      keys = JSON.parse(event.dataTransfer?.getData(PROJECTS_DRAG_TYPE) || "[]");
    } catch {
      return;
    }
    if (!Array.isArray(keys)) return;
    const projects = keys.filter((key): key is string => typeof key === "string");
    if (projects.length) moveIntoFolder(projects, props.folder);
  };

  // Enter and a click elsewhere keep the name; Escape, or an empty name, keeps the one before.
  let cancelled = false;
  const finish = (input: HTMLInputElement) => {
    if (!renaming()) return;
    if (!cancelled) renameProjectFolder(props.folder.id, input.value);
    cancelled = false;
    setEditing(null);
  };

  return (
    <div
      class="group/folder relative"
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={handleDrop}
    >
      <Show
        when={!renaming()}
        fallback={
          <div class={cx(dashboardNavItemClass(true), "inset-ring inset-ring-(--plane-accent-primary)")}>
            <span class="flex min-w-0 flex-1 items-center gap-2 py-px">
              <PlaneIcon name="folder" class={cx("size-4", navIconClass(true))} />
              <input
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                type="text"
                value={props.folder.name}
                maxLength={40}
                aria-label={t("Folder name")}
                class="min-w-0 flex-1 bg-transparent text-sm leading-5 font-medium text-(--plane-text-primary) outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelled = true;
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => finish(event.currentTarget)}
              />
            </span>
          </div>
        }
      >
        <button
          type="button"
          aria-current={props.active ? "page" : undefined}
          onClick={props.onOpen}
          onDblClick={() => setEditing(props.folder.id)}
          class={cx(
            dashboardNavItemClass(props.active || dropping()),
            "pr-7",
            dropping() && "inset-ring inset-ring-(--plane-accent-primary)",
          )}
        >
          <span class="flex min-w-0 items-center gap-2 py-px">
            <PlaneIcon name="folder" class={cx("size-4 transition-colors", navIconClass(props.active || dropping()))} />
            <span class="min-w-0 truncate text-sm leading-5 font-medium">{props.folder.name}</span>
          </span>
        </button>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as="button"
            type="button"
            aria-label={t("{name} options", { name: props.folder.name })}
            class="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded-md text-(--plane-text-tertiary) opacity-0 outline-none hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) focus-visible:opacity-100 focus-ring group-hover/folder:opacity-100 data-expanded:opacity-100"
          >
            <PlaneIcon name="more" class="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="w-40 gap-0.5">
              <DropdownMenuItem tone="neutral" class="gap-2" onSelect={() => setEditing(props.folder.id)}>
                <PlaneIcon name="edit" class="size-3.5" />
                <span class="flex-1">{t("Rename")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem tone="neutral" class="gap-2" onSelect={props.onDelete}>
                <PlaneIcon name="trash" class="size-3.5" />
                <span class="flex-1">{t("Delete folder")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </Show>
    </div>
  );
}
