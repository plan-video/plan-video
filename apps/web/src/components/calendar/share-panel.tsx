/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createResource, createSignal, onMount } from "solid-js";
import { toast } from "somoto";

import { PreviewComments } from "@/components/publish/preview-comments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import { cloudEnabled } from "@/lib/cloud-storage";
import { askForAccount } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { loadPreview, mediaLeftOut, previewLink, previewOf, sharePost, stopSharing } from "@/lib/post-previews";
import { popupFooter } from "./popup";
import type { StoredEvent } from "./types";

export function SharePanel(props: { post: StoredEvent; onBack(): void }) {
  const auth = useAuth();
  const [busy, setBusy] = createSignal(false);
  const shared = () => previewOf(props.post.id);
  const [noMedia] = createResource(() => props.post, mediaLeftOut);
  const [preview, { refetch }] = createResource(() => shared()?.id, (id) => loadPreview(id).catch(() => null));
  const ownerName = () => auth.user()?.user_metadata?.full_name || auth.user()?.email?.split("@")[0] || t("Author");

  const share = async () => {
    // Previews are kept on the account: a guest is asked to make one first.
    if (auth.isGuest()) return askForAccount({ reason: "share" });
    setBusy(true);
    try {
      const made = await sharePost(props.post);
      if ("error" in made) toast.error(t(made.error));
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    if (shared()) void sharePost(props.post);
  });

  const copy = async () => {
    const id = shared()?.id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(previewLink(id));
      toast.success(t("Link copied"), { description: t("Anyone with it can see this post and comment.") });
    } catch {
      toast.error(t("Could not copy"), { description: t("The browser blocked the clipboard.") });
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const error = await stopSharing(props.post.id);
      if (error) toast.error(t(error));
      else toast(t("Stopped sharing"), { description: t("The link no longer opens, and its comments are gone.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="min-h-0 flex-1 overflow-y-auto p-3.5">
        <Show
          when={shared()}
          fallback={
            <div class="flex flex-col gap-2">
              <p class="text-sm font-medium text-foreground">{t("Get feedback on this post")}</p>
              <p class="text-xs leading-5 text-muted-foreground">
                {t("Make a link to a preview of it. Anyone with the link can see the post and comment, without an account. You can stop sharing at any time.")}
              </p>
            </div>
          }
        >
          {(current) => (
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-1.5">
                <input
                  readOnly
                  aria-label={t("Preview link")}
                  class="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-input px-2 text-xs text-muted-foreground outline-none"
                  value={previewLink(current().id)}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button variant="secondary" class="gap-1 pl-1.5" onClick={() => void copy()}>
                  <Icon name="clipboard" class="size-4" />
                  {t("Copy")}
                </Button>
              </div>
              <Show when={noMedia()}>
                <p class="text-xs leading-4 text-meter-yellow">
                  {cloudEnabled
                    ? t("The video is still backing up, so the preview shows the post without it for now.")
                    : t("Videos only play in previews shared from plan.video on the web. This one shows the post without it.")}
                </p>
              </Show>
              <div class="flex flex-col gap-2">
                <p class="text-xs font-medium text-foreground">{t("Comments")}</p>
                <Show when={preview.latest} fallback={<p class="text-xs text-muted-foreground">{preview.loading ? t("Loading…") : t("No comments yet.")}</p>}>
                  {(loaded) => (
                    <PreviewComments previewId={current().id} comments={loaded().comments} isOwner ownerName={ownerName()} onChanged={() => void refetch()} />
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
      <div class={popupFooter}>
        <Button variant="ghost" class="mr-auto" onClick={() => props.onBack()}>
          {t("Back")}
        </Button>
        <Show
          when={shared()}
          fallback={
            <Button class="px-3" disabled={busy()} onClick={() => void share()}>
              {t("Create link")}
            </Button>
          }
        >
          <Button variant="ghost" class="text-destructive hover:bg-destructive/10" disabled={busy()} onClick={() => void stop()}>
            {t("Stop sharing")}
          </Button>
        </Show>
      </div>
    </>
  );
}
