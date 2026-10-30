/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createSignal } from "solid-js";
import { toast } from "somoto";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TextField, TextFieldInput } from "@/components/ui/text-field";
import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n";
import { folderOfProject, projectFolders, type ProjectFolder } from "@/lib/project-folders";
import { duplicateProject, projectKey, renameProject, type ProjectRecord } from "@/projects";

import { DashboardCardButton, DashboardCardPreview, DashboardProjectThumbnail } from "./shared";
import { formatEditedAt } from "./utils";

type DashboardProjectCardProps = {
  project: ProjectRecord;
  /** Whether the card is part of its grid's selection. */
  active: boolean;
  /**
   * A click landed on the card. The event carries shift and cmd/ctrl, which
   * a grid uses for range and toggle. Right-click goes through `onMenuOpen`.
   */
  onSelect: (event?: MouseEvent) => void;
  /**
   * The context menu is opening. When omitted, the click handler runs, which
   * is a plain selection of this card.
   */
  onMenuOpen?: () => void;
  /** Escape was pressed on the card. */
  onDeselect: () => void;
  /** The card was double-clicked, or Open chosen from the menu. */
  onOpen: () => void;
  /** Delete was pressed on the card, or chosen from the menu. */
  onDelete: () => void;
  /** Other cards are selected too, so rename and duplicate don't apply. */
  bulk?: boolean;
  /** Menu label for delete; "Delete" when this card is the only one. */
  deleteLabel?: string;
  /** Position in the grid, so a drag can find the card without its folder path. */
  marqueeIndex?: number;
  /**
   * A rename or duplicate changed the projects on disk; the owner refetches
   * its list. Called after a rename regardless of outcome, since the folder
   * moves with the name and the list is stale either way.
   */
  onChanged: () => void;
  /** Move to folder chose a folder, or a new one, for the card and the rest of the selection; `null` takes them out. */
  onMove?: (folder: ProjectFolder | "new" | null) => void;
  /** The card can be dragged onto a sidebar folder. */
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
};

/**
 * A project in a dashboard grid: thumbnail, name, and last-edited time, with
 * the context menu that opens, renames, duplicates, and deletes it. Rename
 * happens inline, in place of the name, and lives here so every grid that
 * shows projects gets the same menu.
 */
export function DashboardProjectCard(props: DashboardProjectCardProps) {
  const [, setParams] = useSearchParams();
  const [renaming, setRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal("");

  const current = () => folderOfProject(projectKey(props.project));
  // New folder puts the folder's name up for typing in the sidebar, so it is
  // made once the menu has closed, and focus doesn't go back to the card.
  let newFolderOnClose = false;
  /** The folder the card is in already; a selection of several can still move there. */
  const isCurrent = (folder: ProjectFolder) => !props.bulk && current()?.id === folder.id;

  const startRenaming = () => {
    batch(() => {
      setRenameDraft(props.project.displayName);
      setRenaming(true);
    });
  };

  const stopRenaming = () => {
    batch(() => {
      setRenaming(false);
      setRenameDraft("");
    });
  };

  const handleOpen = () => {
    if (renaming()) return;
    props.onOpen();
  };

  const handleDuplicate = async () => {
    try {
      await duplicateProject(props.project.dir);
      track("project_duplicated");
      props.onChanged();
    } catch (e) {
      toast.error(t("Failed to duplicate project"), { description: (e as Error).message });
    }
  };

  const handleRenameInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setRenameDraft(event.currentTarget.value);
  };

  // The input mounts from a context-menu selection, which restores focus to
  // the trigger on close — so the input must claim focus itself, after that.
  const handleRenameInputRef = (el: HTMLInputElement) => {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  };

  const handleBlurRenameInput = () => {
    stopRenaming();
    props.onChanged();
  };

  const handleKeyDownRenameInput = async (event: KeyboardEvent) => {
    const input = event.currentTarget as HTMLInputElement;
    const trimmedName = renameDraft().trim();

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      stopRenaming();
      props.onChanged();
      input.blur();
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      // The folder moves with the name, so the list is refetched rather than
      // patched: every path in it has just changed.
      if (trimmedName.length > 0 && renaming()) {
        try {
          await renameProject(props.project.dir, trimmedName);
        } catch (e) {
          toast.error(t("Failed to rename project"), { description: (e as Error).message });
        }
      }

      stopRenaming();
      props.onChanged();
      input.blur();
    }
  };

  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) return;
        if (props.onMenuOpen) props.onMenuOpen();
        else props.onSelect();
      }}
    >
      <ContextMenuTrigger as="div" class="contents">
        <DashboardCardButton
          active={props.active}
          marqueeIndex={props.marqueeIndex}
          onClick={props.onSelect}
          onDoubleClick={handleOpen}
          onEscape={props.onDeselect}
          onDelete={props.onDelete}
          draggable={props.draggable && !renaming()}
          onDragStart={props.onDragStart}
        >
          <DashboardCardPreview>
            <DashboardProjectThumbnail cover={props.project.cover} cacheKey={props.project.dir} />
          </DashboardCardPreview>
          <div class="flex flex-col gap-1 px-2">
            <div class="relative h-4 w-full">
              <Show
                when={renaming()}
                fallback={
                  <p class="min-w-0 truncate text-xs font-medium text-foreground">
                    {props.project.displayName}
                  </p>
                }
              >
                <TextField class="contents">
                  <TextFieldInput
                    uiSize="compact"
                    type="text"
                    ref={handleRenameInputRef}
                    value={renameDraft()}
                    onInput={handleRenameInput}
                    onBlur={handleBlurRenameInput}
                    onKeyDown={handleKeyDownRenameInput}
                    placeholder={t("Project name")}
                    aria-label={t("Project name")}
                    class="absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 border border-ring bg-input px-1 py-0 ring-1 ring-inset ring-ring"
                  />
                </TextField>
              </Show>
            </div>
            <p class="min-w-0 truncate text-xs text-muted-foreground">
              {formatEditedAt(props.project.modifiedAt)}
            </p>
          </div>
        </DashboardCardButton>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent
          class="w-45 gap-0"
          onCloseAutoFocus={(event: Event) => {
            if (!newFolderOnClose) return;
            newFolderOnClose = false;
            event.preventDefault();
            props.onMove?.("new");
          }}
        >
          <Show when={!props.bulk}>
            <ContextMenuItem onSelect={handleOpen}>{t("Open")}</ContextMenuItem>
            <ContextMenuItem onSelect={() => setParams({ dashboard: "new-post", project: projectKey(props.project) })}>
              {t("Make a post")}
            </ContextMenuItem>
            <ContextMenuSeparator class="my-2" />
          </Show>
          <ContextMenuItem disabled={props.bulk} onSelect={startRenaming}>{t("Rename")}</ContextMenuItem>
          <ContextMenuItem disabled={props.bulk} onSelect={handleDuplicate}>{t("Duplicate")}</ContextMenuItem>
          <Show when={props.onMove}>
            {(move) => (
              <ContextMenuSub>
                <ContextMenuSubTrigger>{t("Move to folder")}</ContextMenuSubTrigger>
                <ContextMenuPortal>
                  <ContextMenuSubContent class="w-45 gap-0">
                    <For each={projectFolders()}>
                      {(folder) => (
                        <ContextMenuItem
                          disabled={isCurrent(folder)}
                          onSelect={() => move()(folder)}
                        >
                          <span class="min-w-0 truncate">{folder.name}</span>
                        </ContextMenuItem>
                      )}
                    </For>
                    <Show when={projectFolders().length > 0}>
                      <ContextMenuSeparator class="my-2" />
                    </Show>
                    <ContextMenuItem
                      onSelect={() => {
                        newFolderOnClose = true;
                      }}
                    >
                      {t("New folder")}
                    </ContextMenuItem>
                    <Show when={props.bulk || current()}>
                      <ContextMenuItem onSelect={() => move()(null)}>{t("Remove from folder")}</ContextMenuItem>
                    </Show>
                  </ContextMenuSubContent>
                </ContextMenuPortal>
              </ContextMenuSub>
            )}
          </Show>
          <ContextMenuSeparator class="my-2" />
          <ContextMenuItem onSelect={props.onDelete}>{props.deleteLabel ?? t("Delete")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
