/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";
import { For, Show, batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate, useSearchParams } from "@solidjs/router";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FolderArt, ProjectsArt } from "./empty-art";
import {
  DashboardViewSection,
  createNewProject,
  setCardPileDragImage,
} from "./shared";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { DashboardProjectCard } from "./project-card";
import { parseTimestamp } from "./utils";
import { DashboardSearchPanel } from "./search-bar";
import { createProjectMarquee } from "./project-marquee";
import { PROJECTS_DRAG_TYPE, moveIntoFolder, startNewFolder } from "./sidebar-folders";
import { projectRoute, useReturnHere } from "@/hooks/use-project-route";
import { track } from "@/lib/analytics";
import { msg, t } from "@/lib/i18n";
import { moveProjectsToFolder, projectFolder } from "@/lib/project-folders";
import { isInputTarget } from "@/utils";
import {
  listProjects,
  projectKey,
  projectsRevision,
  warmProjectCovers,
  type ProjectInfo,
} from "@/projects";

import type { ProjectSortOption } from "./types";

export function DashboardProjectsView() {
  const navigate = useNavigate();
  const returnHere = useReturnHere();
  const [params, setParams] = useSearchParams();
  const folder = () => projectFolder(typeof params.folder === "string" ? params.folder : undefined);
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<ProjectSortOption>("last-viewed");
  const [projects, { refetch: refetchProjects }] = createResource(projectsRevision, async () => {
    const list = await listProjects();
    const recent = [...list].sort((a, b) => parseTimestamp(b.modifiedAt) - parseTimestamp(a.modifiedAt));
    await warmProjectCovers(recent.slice(0, 16));
    void warmProjectCovers(recent.slice(16));
    return list;
  });
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [pendingDelete, setPendingDelete] = createSignal<ProjectInfo[] | null>(null);

  const selectedSortOption = () =>
    SORT_OPTIONS.find((option) => option.id === sort()) ?? SORT_OPTIONS[0];

  const normalizedSearch = createMemo(() => search().trim().toLowerCase());

  const folderProjects = createMemo(() => {
    const entries = projects() ?? [];
    const open = folder();
    if (!open) return entries;
    const keys = new Set(open.projects);
    return entries.filter((project) => keys.has(projectKey(project)));
  });

  const filteredProjects = createMemo(() => {
    const query = normalizedSearch();
    const entries = folderProjects();
    if (!query) return entries;

    return entries.filter((project) => project.displayName.toLowerCase().includes(query));
  });

  const sortedProjects = createMemo(() => {
    const sortMode = sort();
    const entries = [...filteredProjects()];

    if (sortMode === "alphabetical") {
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return entries;
    }

    if (sortMode === "date-created") {
      entries.sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
      return entries;
    }

    entries.sort((a, b) => parseTimestamp(b.modifiedAt) - parseTimestamp(a.modifiedAt));
    return entries;
  });

  const visibleProjects = () => sortedProjects();

  const selectedProjects = () => visibleProjects().filter((project) => selected().has(project.dir));

  const replaceSelection = (dirs: Iterable<string>, nextAnchor?: string | null) => {
    batch(() => {
      setSelected(new Set(dirs));
      if (nextAnchor !== undefined) setAnchor(nextAnchor);
    });
  };

  const clearSelection = () => {
    // The closing menu's click lands on the grid; the confirmation is already open, so it isn't a deselect.
    if (pendingDelete()) return;
    if (selected().size === 0 && anchor() === null) return;
    replaceSelection([], null);
  };

  const selectFromPointer = (dir: string, event?: MouseEvent) => {
    if (pendingDelete()) return;
    if (event?.shiftKey) {
      const list = visibleProjects().map((project) => project.dir);
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
      const projects = visibleProjects();
      const dirs = indexes.flatMap((index) => {
        const project = projects[Number(index)];
        return project ? [project.dir] : [];
      });
      const next = new Set(base);
      for (const dir of dirs) next.add(dir);
      replaceSelection(next, dirs[dirs.length - 1] ?? anchorBeforeDrag);
    },
    onRevert: (previous) => replaceSelection(previous, anchorBeforeDrag),
    grabs: (index) => {
      const project = visibleProjects()[Number(index)];
      return !!project && selected().has(project.dir);
    },
  });

  const movingWith = (project: ProjectInfo) => {
    const chosen = selectedProjects();
    return chosen.some((entry) => entry.dir === project.dir) ? chosen : [project];
  };

  const moveProjects = (project: ProjectInfo, target: Parameters<typeof moveIntoFolder>[1] | "new" | null) => {
    const keys = movingWith(project).map(projectKey);
    if (target === "new") startNewFolder(keys);
    else if (target) moveIntoFolder(keys, target);
    else moveProjectsToFolder(keys, null);
  };

  const startDrag = (project: ProjectInfo, event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    const moving = movingWith(project);
    event.dataTransfer.setData(PROJECTS_DRAG_TYPE, JSON.stringify(moving.map(projectKey)));

    const card = event.currentTarget as HTMLElement;
    const grid = card.closest('[data-slot="card-grid"]');
    const visible = visibleProjects();
    const others = moving
      .filter((entry) => entry.dir !== project.dir)
      .map((entry) => grid?.querySelector<HTMLElement>(`[data-marquee-index="${visible.findIndex((shown) => shown.dir === entry.dir)}"]`))
      .filter((element): element is HTMLElement => !!element);
    setCardPileDragImage(event, [card, ...others], moving.length);
  };

  createEffect(on([normalizedSearch, () => folder()?.id], () => clearSelection(), { defer: true }));

  const requestDelete = (dir?: string) => {
    const chosen = selectedProjects();
    if (chosen.length > 0 && (dir === undefined || chosen.some((project) => project.dir === dir))) {
      setPendingDelete(chosen);
      return;
    }
    if (!dir) return;

    const project = visibleProjects().find((entry) => entry.dir === dir);
    if (project) setPendingDelete([project]);
  };

  const openProject = (project: ProjectInfo) => {
    track('project_opened');
    navigate(projectRoute(projectKey(project)), { state: returnHere() });
  };

  const handleDeleted = (project: ProjectInfo) => {
    setSelected((current) => {
      if (!current.has(project.dir)) return current;
      const next = new Set(current);
      next.delete(project.dir);
      return next;
    });
    if (anchor() === project.dir) setAnchor(null);
    refetchProjects();
  };

  // Delete and ⌘A belong to the grid even with focus on the page (a marquee leaves it there).
  // Runs after a focused card's own handler, so a selection wins over that card.
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputTarget(event) || event.altKey || pendingDelete()) return;

      if (event.key === "Escape") {
        if (selected().size === 0) return;
        event.preventDefault();
        clearSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const dirs = visibleProjects().map((project) => project.dir);
        replaceSelection(dirs, dirs[0] ?? null);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      const onProjectCard = !!target?.closest("[data-marquee-index]");
      if (selected().size === 0 && !onProjectCard) return;

      event.preventDefault();
      if (selected().size > 0) requestDelete();
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // Stays locked after success: the editor can take a while to open and a second click would create a second project.
  const handleCreateProject = async () => {
    if (creating()) return;
    setCreating(true);

    try {
      const project = await createNewProject();
      if (!project) {
        setCreating(false);
        return;
      }
      const open = folder();
      if (open) moveProjectsToFolder([projectKey(project)], open.id);
      refetchProjects();
      void openProject(project);
    } catch (e) {
      setCreating(false);
      toast.error(t("Failed to create project"), { description: (e as Error).message });
    }
  };

  return (
    <DashboardSearchPanel
      value={search}
      onChange={setSearch}
      placeholder={t("Search projects")}
      shown={visibleProjects().length}
      total={folderProjects().length}
      empty={folderProjects().length === 0}
      action={
        <Select<(typeof SORT_OPTIONS)[number]>
          options={SORT_OPTIONS}
          value={selectedSortOption()}
          onChange={(option) => option && setSort(option.id)}
          optionValue="id"
          optionTextValue="label"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {t(itemProps.item.rawValue.label)}
            </SelectItem>
          )}
        >
          <SelectTrigger aria-label={t("Sort projects")}>
            <SelectValue<(typeof SORT_OPTIONS)[number]>>
              {(state) => t(state.selectedOption()?.label ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      }
    >
      <DashboardViewSection
        class="pb-4"
        selecting={marquee.rect() !== null}
        onPointerDown={marquee.onPointerDown}
        onBackgroundClick={clearSelection}
      >
        <Show when={projects()}>
          <Show
            when={visibleProjects().length > 0}
            fallback={
              <Show
                when={!normalizedSearch()}
                fallback={<p class="col-span-full px-2 py-16 text-center text-sm text-muted-foreground">{t("No projects match that search.")}</p>}
              >
                <Show
                  when={folder() && (projects() ?? []).length > 0}
                  fallback={
                    <div class="col-span-full flex flex-col items-center gap-4 px-2 pt-8 pb-16 text-center">
                      <ProjectsArt />
                      <div class="flex flex-col gap-1">
                        <h2 class="text-sm font-medium text-foreground">{t("No projects yet")}</h2>
                        <p class="max-w-sm text-xs text-muted-foreground">{t("Edit a video here, then post it from New post.")}</p>
                      </div>
                      <Button class="px-3" disabled={creating()} onClick={() => void handleCreateProject()}>
                        {t("New project")}
                      </Button>
                    </div>
                  }
                >
                  <div class="col-span-full flex flex-col items-center gap-4 px-2 pt-8 pb-16 text-center">
                    <FolderArt />
                    <div class="flex flex-col gap-1">
                      <h2 class="text-sm font-medium text-foreground">{t("This folder is empty")}</h2>
                      <p class="max-w-xs text-xs text-balance text-muted-foreground">{t("Drag projects onto it in the sidebar, or use Move to folder in a project's menu.")}</p>
                    </div>
                    <div class="flex gap-2">
                      <Button variant="secondary" class="px-3" onClick={() => setParams({ folder: undefined })}>
                        {t("All projects")}
                      </Button>
                      <Button class="px-3" disabled={creating()} onClick={() => void handleCreateProject()}>
                        {t("New project")}
                      </Button>
                    </div>
                  </div>
                </Show>
              </Show>
            }
          >
            <For each={visibleProjects()}>
              {(project, index) => {
                const inSelection = () => selected().has(project.dir);
                const bulk = () => inSelection() && selected().size > 1;
                return (
                  <DashboardProjectCard
                    project={project}
                    marqueeIndex={index()}
                    active={inSelection()}
                    bulk={bulk()}
                    deleteLabel={bulk() ? t("Delete {count}", { count: selected().size }) : t("Delete")}
                    onSelect={(event) => selectFromPointer(project.dir, event)}
                    onMenuOpen={() => selectFromMenu(project.dir)}
                    onDeselect={clearSelection}
                    onOpen={() => openProject(project)}
                    onDelete={() => requestDelete(project.dir)}
                    onChanged={refetchProjects}
                    onMove={(target) => moveProjects(project, target)}
                    draggable={inSelection()}
                    onDragStart={(event) => startDrag(project, event)}
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
        projects={pendingDelete()}
        onClose={() => setPendingDelete(null)}
        onDeleted={handleDeleted}
      />
    </DashboardSearchPanel>
  );
}

const SORT_OPTIONS: Array<{ id: ProjectSortOption; label: string }> = [
  { id: "last-viewed", label: msg("Last modified") },
  { id: "alphabetical", label: msg("Alphabetical") },
  { id: "date-created", label: msg("Date created") },
];
