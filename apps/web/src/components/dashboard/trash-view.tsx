/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { projectRoute, useReturnHere } from "@/hooks/use-project-route";
import {
  listTrashedProjects,
  projectKey,
  projectsRevision,
  restoreProject,
  type ProjectRecord,
} from "@/projects";
import { isInputTarget } from "@/utils";

import { TrashArt } from "@/components/dashboard/empty-art";
import { TRASH_RETENTION_DAYS } from "@/lib/db";
import { t } from "@/lib/i18n";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { createProjectMarquee } from "./project-marquee";
import { DashboardSearchPanel } from "./search-bar";
import {
  DashboardCardButton,
  DashboardCardPreview,
  DashboardProjectThumbnail,
  DashboardViewSection,
} from "./shared";
import { formatTrashRemaining } from "./utils";

type PendingErase = {
  projects: ProjectRecord[];
  emptyAll: boolean;
};

export function DashboardTrashView() {
  const navigate = useNavigate();
  const returnHere = useReturnHere();
  const [projects] = createResource(projectsRevision, () => listTrashedProjects());
  const [search, setSearch] = createSignal("");
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [pendingErase, setPendingErase] = createSignal<PendingErase | null>(null);

  const normalizedSearch = createMemo(() => search().trim().toLowerCase());

  const visible = createMemo(() => {
    const query = normalizedSearch();
    const all = projects() ?? [];
    if (!query) return all;
    return all.filter((project) => project.displayName.toLowerCase().includes(query));
  });

  const selectedProjects = () => visible().filter((project) => selected().has(project.dir));

  const replaceSelection = (dirs: Iterable<string>, nextAnchor?: string | null) => {
    batch(() => {
      setSelected(new Set(dirs));
      if (nextAnchor !== undefined) setAnchor(nextAnchor);
    });
  };

  const clearSelection = () => {
    // The menu (and the dialog) close under the pointer, and that click lands
    // on the grid. The confirmation is already open, so it is not a deselect.
    if (pendingErase()) return;
    if (selected().size === 0 && anchor() === null) return;
    replaceSelection([], null);
  };

  // Shift extends from the card that was clicked last, cmd/ctrl toggles one
  // card, and a plain click keeps only the card under the pointer.
  const selectFromPointer = (dir: string, event?: MouseEvent) => {
    if (pendingErase()) return;
    if (event?.shiftKey) {
      const list = visible().map((project) => project.dir);
      const start = list.indexOf(anchor() ?? dir);
      const end = list.indexOf(dir);
      if (start < 0 || end < 0) {
        replaceSelection([dir], dir);
        return;
      }
      const [from, to] = start < end ? [start, end] : [end, start];
      setSelected(new Set(list.slice(from, to + 1)));
      return;
    }

    if (event && (event.metaKey || event.ctrlKey)) {
      const next = new Set(selected());
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      replaceSelection(next, dir);
      return;
    }

    replaceSelection([dir], dir);
  };

  // Right-click keeps a selection that already includes the card, so the
  // menu's delete covers all of it. A card outside the selection becomes
  // the selection.
  const selectFromMenu = (dir: string) => {
    if (selected().has(dir)) return;
    replaceSelection([dir], dir);
  };

  let anchorBeforeDrag: string | null = null;
  const marquee = createProjectMarquee({
    selection: selected,
    onBegin: () => {
      anchorBeforeDrag = anchor();
    },
    onChange: (indexes, base) => {
      const projects = visible();
      const dirs = indexes.flatMap((index) => {
        const project = projects[Number(index)];
        return project ? [project.dir] : [];
      });
      const next = new Set(base);
      for (const dir of dirs) next.add(dir);
      replaceSelection(next, dirs[dirs.length - 1] ?? anchorBeforeDrag);
    },
    onRevert: (previous) => replaceSelection(previous, anchorBeforeDrag),
  });

  // A search hides cards the selection was made of; start over rather than
  // keep a selection the grid can no longer show.
  createEffect(on(normalizedSearch, () => clearSelection(), { defer: true }));

  const requestErase = (dir?: string) => {
    const chosen = selectedProjects();
    if (chosen.length > 0 && (dir === undefined || chosen.some((project) => project.dir === dir))) {
      setPendingErase({ projects: chosen, emptyAll: false });
      return;
    }
    if (!dir) return;

    const project = visible().find((entry) => entry.dir === dir);
    if (project) setPendingErase({ projects: [project], emptyAll: false });
  };

  const restore = async (project: ProjectRecord, open: boolean) => {
    try {
      await restoreProject(project.dir);
      if (!open) return;
      navigate(projectRoute(projectKey(project)), { state: returnHere() });
    } catch (e) {
      toast.error(t("Failed to restore project"), { description: (e as Error).message });
    }
  };

  const restoreSelection = async () => {
    // Snapshot first. Each restore refreshes the trash list, which would
    // otherwise shrink the selection while this loop is still walking it.
    const projects = [...selectedProjects()];
    for (const project of projects) {
      await restore(project, false);
    }
  };

  const handleDeleted = (project: ProjectRecord) => {
    setSelected((current) => {
      if (!current.has(project.dir)) return current;
      const next = new Set(current);
      next.delete(project.dir);
      return next;
    });
    if (anchor() === project.dir) setAnchor(null);
  };

  // Delete and ⌘A belong to the grid even when focus is on the page rather
  // than a card — a marquee leaves it there. A focused card handles its own
  // key, and this runs after it, so a selection wins over that one card.
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputTarget(event) || event.altKey || pendingErase()) return;

      if (event.key === "Escape") {
        if (selected().size === 0) return;
        event.preventDefault();
        clearSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const dirs = visible().map((project) => project.dir);
        replaceSelection(dirs, dirs[0] ?? null);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      const onProjectCard = !!target?.closest("[data-marquee-index]");
      if (selected().size === 0 && !onProjectCard) return;

      event.preventDefault();
      if (selected().size > 0) requestErase();
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <DashboardSearchPanel
      value={search}
      onChange={setSearch}
      placeholder={t("Search trash")}
      shown={visible().length}
      total={(projects() ?? []).length}
      empty={projects()?.length === 0}
      action={
        <Button
          variant="secondary"
          disabled={(projects() ?? []).length === 0}
          onClick={() => setPendingErase({ projects: projects() ?? [], emptyAll: true })}
        >
          {t("Empty trash")}
        </Button>
      }
    >
      <DashboardViewSection
        class="pb-4"
        selecting={marquee.rect() !== null}
        onPointerDown={marquee.onPointerDown}
        onBackgroundClick={clearSelection}
      >
        <Show
          when={projects()}
          fallback={<p class="col-span-full px-2 py-16 text-center text-sm text-muted-foreground">&nbsp;</p>}
        >
          <Show
            when={visible().length > 0}
            fallback={
              <Show
                when={!search().trim()}
                fallback={<p class="col-span-full px-2 py-16 text-center text-sm text-muted-foreground">{t("No projects match that search.")}</p>}
              >
                <div class="col-span-full flex flex-col items-center gap-4 px-2 pt-8 pb-16 text-center">
                  <TrashArt />
                  <div class="flex flex-col gap-1">
                    <h2 class="text-sm font-medium text-foreground">{t("Trash is empty")}</h2>
                    <p class="text-xs text-muted-foreground">{t("Projects you delete wait here for {days, plural, one {# day} other {# days}}, so you can bring them back.", { days: TRASH_RETENTION_DAYS })}</p>
                  </div>
                </div>
              </Show>
            }
          >
            <For each={visible()}>
              {(project, index) => {
                const inSelection = () => selected().has(project.dir);
                const bulk = () => inSelection() && selected().size > 1;
                return (
                  <TrashProjectCard
                    project={project}
                    marqueeIndex={index()}
                    active={inSelection()}
                    restoreLabel={bulk() ? t("Restore {count}", { count: selected().size }) : t("Restore")}
                    deleteLabel={bulk() ? t("Delete {count}", { count: selected().size }) : t("Delete permanently")}
                    onSelect={(event) => selectFromPointer(project.dir, event)}
                    onMenuOpen={() => selectFromMenu(project.dir)}
                    onDeselect={clearSelection}
                    onRestore={() => {
                      if (bulk()) void restoreSelection();
                      else void restore(project, false);
                    }}
                    onOpen={() => restore(project, true)}
                    onDelete={() => requestErase(project.dir)}
                  />
                );
              }}
            </For>
          </Show>
        </Show>
      </DashboardViewSection>

      <Show when={marquee.rect()}>
        {(box) => (
          <Portal>
            <div
              data-slot="project-marquee"
              class="pointer-events-none fixed z-50 border border-primary bg-primary/20"
              style={{
                left: `${box().x}px`,
                top: `${box().y}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
            />
          </Portal>
        )}
      </Show>

      <DeleteProjectDialog
        permanent
        emptyTrash={pendingErase()?.emptyAll}
        projects={pendingErase()?.projects ?? null}
        onClose={() => setPendingErase(null)}
        onDeleted={handleDeleted}
      />
    </DashboardSearchPanel>
  );
}

type TrashProjectCardProps = {
  project: ProjectRecord;
  active: boolean;
  marqueeIndex?: number;
  restoreLabel?: string;
  deleteLabel?: string;
  onSelect: (event?: MouseEvent) => void;
  onMenuOpen: () => void;
  onDeselect: () => void;
  onRestore: () => void;
  onOpen: () => void;
  onDelete: () => void;
};

function TrashProjectCard(props: TrashProjectCardProps) {
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) return;
        props.onMenuOpen();
      }}
    >
      <ContextMenuTrigger as="div" class="contents">
        <DashboardCardButton
          active={props.active}
          marqueeIndex={props.marqueeIndex}
          onClick={props.onSelect}
          onDoubleClick={props.onOpen}
          onEscape={props.onDeselect}
          onDelete={props.onDelete}
        >
          <DashboardCardPreview>
            <DashboardProjectThumbnail cover={props.project.cover} cacheKey={props.project.dir} />
          </DashboardCardPreview>
          <div class="flex flex-col gap-1 px-2">
            <p class="min-w-0 truncate text-xs text-foreground">{props.project.displayName}</p>
            <p class="min-w-0 truncate text-xs text-muted-foreground">
              {formatTrashRemaining(props.project.trashedAt ?? "")}
            </p>
          </div>
        </DashboardCardButton>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-45 gap-0">
          <ContextMenuItem onSelect={props.onRestore}>{props.restoreLabel ?? t("Restore")}</ContextMenuItem>
          <ContextMenuSeparator class="my-2" />
          <ContextMenuItem variant="destructive" onSelect={props.onDelete}>
            {props.deleteLabel ?? t("Delete permanently")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
