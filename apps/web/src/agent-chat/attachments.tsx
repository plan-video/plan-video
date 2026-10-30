/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Nothing is read or uploaded: an attachment is a path the agent reads where it
// is, so drops only work where the shell can say where a file lives (desktop).

import { Show, createSignal } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { RemoveButton } from "@/components/ui/remove-button";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";

// `path` is null off the desktop, where the browser won't say where a dropped file lives.
export type Attachment = {
  key: string;
  name: string;
  kind: "file" | "folder";
  path: string | null;
};

export const attachmentPaths = (attachments: Attachment[]): string[] =>
  attachments.flatMap((entry) => (entry.path ? [entry.path] : []));

export function attachmentFromPath(path: string): Attachment {
  const name = path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
  return { key: path, name, kind: /\.[A-Za-z0-9]{1,8}$/.test(name) ? "file" : "folder", path };
}

// Folders are told apart through the entry API, the only thing a drop says
// about a directory.
export function droppedAttachments(event: DragEvent): Attachment[] {
  const items = Array.from(event.dataTransfer?.items ?? []);
  const result: Attachment[] = [];

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    const file = item.getAsFile();
    if (!file) continue;

    const path = window.desktop?.getPathForFile(file) || null;
    const name = entry?.name || file.name;
    result.push({
      key: path ?? `${name}:${file.size}:${file.lastModified}`,
      name,
      kind: entry?.isDirectory ? "folder" : "file",
      path,
    });
  }

  return result;
}

export function mergeAttachments(current: Attachment[], dropped: Attachment[]): Attachment[] {
  const known = new Set(current.map((entry) => entry.key));
  return [...current, ...dropped.filter((entry) => !known.has(entry.key))];
}

// Drag events fire on every child the pointer crosses, so the overlay is held
// up by a count of nested enters rather than the last event seen.
export function createDropZone(onDrop: (dropped: Attachment[]) => void) {
  let counter = 0;
  const [dragging, setDragging] = createSignal(false);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter++;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter--;
    if (counter <= 0) {
      counter = 0;
      setDragging(false);
    }
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter = 0;
    setDragging(false);
    const dropped = droppedAttachments(event);
    if (dropped.length) onDrop(dropped);
  };

  return { dragging, onDragOver, onDragEnter, onDragLeave, onDrop: handleDrop };
}

export function DropOverlay(props: { radius?: string }) {
  const radius = () => props.radius ?? "rounded-[20px]";
  return (
    <div class={`absolute inset-0 z-20 overflow-hidden border border-primary bg-background p-2 ${radius()}`}>
      <div class={`absolute inset-0 bg-muted ${radius()}`} />
      <div class="relative flex size-full items-center justify-center gap-1 rounded-xl">
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute inset-[0.5px] size-[calc(100%-1px)] overflow-visible text-border-input opacity-15"
        >
          <rect
            width="100%"
            height="100%"
            rx="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="8 4"
            shape-rendering="crispEdges"
          />
        </svg>
        <Icon name="attachment" class="size-6 text-muted-foreground" />
        <span class="text-xs font-450 text-muted-foreground">{t("Drop files or folders here")}</span>
      </div>
    </div>
  );
}

type AttachmentTileProps = {
  attachment: Attachment;
  class?: string;
  onRemove(): void;
};

export function AttachmentTile(props: AttachmentTileProps) {
  return (
    <div
      class={cx("group relative size-10 shrink-0", props.class)}
      title={props.attachment.name}
    >
      <div class="grid size-full place-items-center overflow-hidden rounded-lg bg-input text-muted-foreground">
        <Show
          when={props.attachment.kind === "folder"}
          fallback={
            <span class="max-w-9 truncate px-0.5 text-[9px] font-450 uppercase tracking-wide">
              {fileType(props.attachment.name)}
            </span>
          }
        >
          <Icon name="navigation.folder" class="size-6" />
        </Show>
      </div>
      <RemoveButton
        label={t("Remove {name}", { name: props.attachment.name })}
        class="absolute -right-2.5 -top-2.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={props.onRemove}
      />
    </div>
  );
}

export function AttachmentChip(props: { path: string }) {
  const attachment = () => attachmentFromPath(props.path);
  return (
    <span class="inline-flex h-5 max-w-full items-center gap-0.5 rounded border border-border bg-transparent pl-0.5 pr-1.5 text-[11px] text-muted-foreground" title={props.path}>
      <Icon name={attachment().kind === "folder" ? "navigation.folder" : "attachment"} class="size-4" />
      <span class="truncate">{attachment().name}</span>
    </span>
  );
}

export function fileType(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return ext && ext.length <= 8 ? ext : t("FILE");
}
