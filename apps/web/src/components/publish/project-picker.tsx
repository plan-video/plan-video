/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The dashboard cannot render a project, so the video itself is still the export, attached to the post.

import { For, Show, createEffect, createResource, createSignal, onCleanup, type JSX } from "solid-js";

import { formatEditedAt } from "@/components/dashboard/utils";
import { CapLabel } from "@/components/ui/cap-label";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { listProjects, loadProjectCover, projectKey, projectsRevision, type ProjectInfo, type ProjectRecord } from "@/projects";

export type LinkedProject = {
  key: string;
  name: string;
  modifiedAt: string;
  cover: string | null;
};

export async function linkProject(project: ProjectInfo & { cover?: Blob | null }): Promise<LinkedProject> {
  const cover = project.cover ? await loadProjectCover(project.dir, project.cover) : null;
  return { key: projectKey(project), name: project.displayName, modifiedAt: project.modifiedAt, cover };
}

export async function findProject(key: string): Promise<ProjectRecord | null> {
  const projects = await listProjects();
  return projects.find((project) => projectKey(project) === key) ?? null;
}

/** A signal rather than a resource: the picker sits under the page's Suspense, and a pending read there blanks the page. */
function useProjects() {
  const [projects, setProjects] = createSignal<ProjectRecord[]>();
  createEffect(() => {
    projectsRevision();
    let current = true;
    onCleanup(() => {
      current = false;
    });
    listProjects()
      .then((list) => current && setProjects([...list].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))))
      .catch((error) => {
        console.error("[projects] could not list projects", error);
        if (current) setProjects([]);
      });
  });
  return projects;
}

export function ProjectPicker(props: {
  onPick(project: ProjectRecord): void;
  children: JSX.Element;
  class?: string;
  placement?: "bottom" | "bottom-start" | "bottom-end";
}) {
  const projects = useProjects();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");

  const list = () => projects() ?? [];

  const results = () => {
    const needle = query().trim().toLowerCase();
    const ready = list();
    return needle ? ready.filter((project) => project.displayName.toLowerCase().includes(needle)) : ready;
  };

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  return (
    <Popover placement={props.placement ?? "bottom"} open={open()} onOpenChange={openChange}>
      <PopoverTrigger type="button" class={cx(props.class, open() && "bg-accent text-foreground")}>
        <CapLabel>{props.children}</CapLabel>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="z-[10000] w-80 overflow-hidden rounded-xl p-0">
          <SearchInput placeholder={t("Search projects")} value={query()} onValue={setQuery} />
          <div class="flex max-h-80 flex-col gap-0.5 overflow-y-auto p-2">
            <Show
              when={results().length}
              fallback={
                <p class="px-2 py-6 text-center text-xs text-muted-foreground">
                  {!projects() ? t("Loading projects…") : list().length ? t("Nothing matches.") : t("No projects yet.")}
                </p>
              }
            >
              <For each={results()}>
                {(project) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-accent focus-ring"
                    onClick={() => {
                      props.onPick(project);
                      openChange(false);
                    }}
                  >
                    <ProjectCover project={project} class="h-9 w-14 rounded-md" />
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="truncate text-xs text-foreground">{project.displayName}</span>
                      <span class="truncate text-xs text-muted-foreground">{formatEditedAt(project.modifiedAt)}</span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/** A signal, not a resource: a resource here suspends the page each time the list opens. */
function ProjectCover(props: { project: ProjectRecord; class?: string }) {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const { dir, cover } = props.project;
    setUrl(null);
    if (!cover) return;
    let current = true;
    onCleanup(() => {
      current = false;
    });
    void loadProjectCover(dir, cover).then((next) => current && setUrl(next));
  });
  return <CoverImage src={url()} class={props.class} />;
}

export function CoverImage(props: { src: string | null; class?: string }) {
  return (
    <span class={cx("grid shrink-0 place-items-center overflow-hidden bg-accent", props.class)}>
      <Show when={props.src} fallback={<Icon name="project-file" class="size-5 text-muted-foreground" />}>
        {(src) => <img src={src()} alt="" class="size-full object-cover" draggable={false} />}
      </Show>
    </span>
  );
}

export function useProjectName(key: () => string | null) {
  const [name] = createResource(key, async (current) => (await findProject(current))?.displayName ?? null);
  return name;
}
