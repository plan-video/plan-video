/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TRASH_RETENTION_DAYS } from "@/lib/db";
import { t } from "@/lib/i18n";
import { createEffect, createSignal } from "solid-js";
import { toast } from "somoto";
import { eraseTrashedProject, trashProject } from "./shared";

import type { ProjectInfo } from "@/projects";


type DeleteProjectDialogProps = {
  /** The project being deleted; omitted while the dialog is closed. */
  project?: ProjectInfo | null;
  /** Several projects being deleted together. Wins over `project` when set. */
  projects?: ProjectInfo[] | null;
  /** Asked for whenever the dialog should close, confirmed or not. */
  onClose(): void;
  /** The project is in the Trash — for the list that showed it to catch up. */
  onDeleted(project: ProjectInfo): void;
  /** Delete from the trash for good, instead of moving a project into it. */
  permanent?: boolean;
  /** Empty-trash wording; only with `permanent` for the Empty trash control. */
  emptyTrash?: boolean;
};

/**
 * The confirmation a project's deletion goes through. The view holds which
 * projects are pending and renders this on them; the delete itself, and being
 * unclosable while it runs, are the dialog's own.
 */
export function DeleteProjectDialog(props: DeleteProjectDialogProps) {
  const [deleting, setDeleting] = createSignal(false);
  // Kept after the view clears its pending list, so the close animation
  // still names what was just confirmed. While a delete is pending, the
  // current list is what the dialog says, so the wording does not catch up
  // a moment later.
  const [shown, setShown] = createSignal<ProjectInfo[]>([]);
  const [shownEmptyTrash, setShownEmptyTrash] = createSignal(false);

  const pending = (): ProjectInfo[] => {
    if (props.projects && props.projects.length > 0) return props.projects;
    return props.project ? [props.project] : [];
  };

  const display = () => {
    const current = pending();
    return current.length > 0 ? current : shown();
  };

  createEffect(() => {
    const current = pending();
    if (current.length > 0) {
      setShown(current);
      setShownEmptyTrash(!!props.emptyTrash);
    }
  });

  // While open, the live prop wins. After close, sticky naming covers the
  // exit animation the same way `shown` covers the project list.
  const emptyTrash = () => (pending().length > 0 ? !!props.emptyTrash : shownEmptyTrash());

  const confirm = async () => {
    const projects = pending();
    if (projects.length === 0 || deleting()) return;

    setDeleting(true);
    try {
      const remove = props.permanent ? eraseTrashedProject : trashProject;
      for (const project of projects) {
        try {
          await remove(project);
          props.onDeleted(project);
        } catch (e) {
          toast.error(t("Failed to delete project"), {
            description: (e as Error).message,
          });
          break;
        }
      }
    } finally {
      setDeleting(false);
      props.onClose();
    }
  };

  const title = () => {
    if (props.permanent && emptyTrash()) return t("Empty trash");
    if (props.permanent) return t("Delete permanently");
    return display().length > 1 ? t("Delete projects") : t("Delete project");
  };

  const description = () => {
    const projects = display();
    if (props.permanent) {
      if (projects.length > 1) {
        return t("{count, plural, one {# project} other {# projects}} will be permanently deleted. This cannot be undone.", { count: projects.length });
      }
      return t("\"{name}\" will be permanently deleted. This cannot be undone.", { name: projects[0]?.displayName ?? "" });
    }
    if (projects.length > 1) {
      return t("{count, plural, one {# project} other {# projects}} will be moved to the Trash for {days, plural, one {# day} other {# days}}. You can restore them until then.", {
        count: projects.length,
        days: TRASH_RETENTION_DAYS,
      });
    }
    return t("\"{name}\" will be moved to the Trash for {days, plural, one {# day} other {# days}}. You can restore it until then.", {
      name: projects[0]?.displayName ?? "",
      days: TRASH_RETENTION_DAYS,
    });
  };

  const confirmLabel = () => {
    return props.permanent && emptyTrash() ? t("Empty trash") : t("Delete");
  };

  return (
    <AlertDialog
      open={pending().length > 0}
      onOpenChange={(open) => {
        if (!open && !deleting()) props.onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title()}</AlertDialogTitle>
          <AlertDialogDescription>{description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" disabled={deleting()} onClick={props.onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="destructive" disabled={deleting()} onClick={confirm}>
            {confirmLabel()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
