/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How a workspace shows in the sidebar: its name, its picture (a logo, an
// emoji, initials or the plan.video mark), its color and its shape. Every
// change saves as it is made.

import { Match, Show, Switch, createEffect, createMemo, createSignal, on, untrack, type JSX } from "solid-js";
import { toast } from "somoto";

import { fieldControl } from "@/components/calendar/popup";
import { EmojiPicker } from "@/components/emoji-picker";
import { Button } from "@/components/ui/button";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import {
  WORKSPACE_IMAGE_MAX,
  activeWorkspace,
  cleanInitials,
  firstGrapheme,
  updateWorkspace,
  workspaceIcon,
  type WorkspaceChanges,
  type WorkspaceIcon,
  type WorkspaceShape,
} from "@/lib/workspaces";

import { PageToggle } from "./page-toggle";
import { Icon } from "./dashboard-icon";
import { PlaneIcon } from "./plane-icons";
import { DashboardSurfaceCard } from "./shared";
import { WorkspaceBadge, WorkspaceColorPicker } from "./workspace-switcher";

type IconType = WorkspaceIcon["type"];
type Fit = "cover" | "contain";

const ICON_TYPES: { value: IconType; label: string }[] = [
  { value: "image", label: msg("Logo") },
  { value: "emoji", label: msg("Emoji") },
  { value: "letters", label: msg("Initials") },
  { value: "mark", label: "plan.video" },
];

const SHAPES: { value: WorkspaceShape; label: string }[] = [
  { value: "rounded", label: msg("Rounded") },
  { value: "circle", label: msg("Circle") },
];

const FITS: { value: Fit; label: string }[] = [
  { value: "cover", label: msg({ message: "Fill", context: "fit mode" }) },
  { value: "contain", label: msg({ message: "Fit", context: "fit mode" }) },
];

/** Sizes to try, largest first, until the picture fits in the account copy. */
const LOGO_SIZES = [256, 192, 128, 96];
const LOGO_FILE_MAX = 8 * 1024 * 1024;

/**
 * Draws a picture onto a small square: cropped to fill it, or whole with a
 * margin so a wide wordmark still reads. Transparent parts let the
 * workspace color through.
 */
async function shrinkLogo(file: File, fit: Fit): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // An SVG without a width and height reports zero; draw it as a square.
    const width = image.naturalWidth || 1;
    const height = image.naturalHeight || 1;
    for (const size of LOGO_SIZES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) break;
      const scale = fit === "cover" ? Math.max(size / width, size / height) : Math.min(size / width, size / height) * 0.8;
      const drawn = { width: width * scale, height: height * scale };
      context.imageSmoothingQuality = "high";
      context.drawImage(image, (size - drawn.width) / 2, (size - drawn.height) / 2, drawn.width, drawn.height);
      let data = canvas.toDataURL("image/webp", 0.9);
      // Safari before 17 has no WebP encoder and hands back a PNG URL anyway.
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/png");
      if (data.length <= WORKSPACE_IMAGE_MAX) return data;
    }
    throw new Error(msg("That picture is too detailed to keep. Try a simpler one."));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Near-square pictures fill the badge; wide or tall ones fit inside it. */
function naturalFit(file: File): Promise<Fit> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const ratio = (image.naturalWidth || 1) / (image.naturalHeight || 1);
      URL.revokeObjectURL(url);
      resolve(ratio > 0.8 && ratio < 1.25 ? "cover" : "contain");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("cover");
    };
    image.src = url;
  });
}

export function WorkspaceAppearance() {
  const workspace = () => activeWorkspace();
  // Memos, so the effects below wake on a real switch or rename and not on every save.
  const workspaceId = createMemo(() => workspace().id);
  const workspaceName = createMemo(() => workspace().name);
  const icon = () => workspaceIcon(workspace());
  const [tab, setTab] = createSignal<IconType>(icon().type);
  const [name, setName] = createSignal(workspace().name);
  const [initials, setInitials] = createSignal("");
  const [emoji, setEmoji] = createSignal("");
  /** The last picture picked here, kept so Fill and Fit can redraw it. */
  const [source, setSource] = createSignal<File | null>(null);
  const [fit, setFit] = createSignal<Fit>("cover");
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  // Start over on a switch to another workspace.
  createEffect(
    on(
      workspaceId,
      () => {
        const shown = untrack(icon);
        setTab(shown.type);
        setInitials(shown.type === "letters" ? (shown.value ?? "") : "");
        setEmoji(shown.type === "emoji" ? shown.value : "");
        setSource(null);
      },
    ),
  );
  // A rename from another browser.
  createEffect(on(workspaceName, setName, { defer: true }));

  const apply = (changes: WorkspaceChanges) => {
    const failure = updateWorkspace(workspace().id, changes);
    if (failure) toast.error(failure);
    return !failure;
  };

  const commitName = () => {
    if (name().trim() === workspace().name) return;
    if (!apply({ name: name() })) setName(workspace().name);
  };

  const chooseTab = (next: IconType) => {
    setTab(next);
    // Logo and Emoji wait for a pick; the other two show straight away.
    if (next === "mark") apply({ icon: { type: "mark" } });
    if (next === "letters") apply({ icon: initials() ? { type: "letters", value: initials() } : { type: "letters" } });
    if (next === "emoji" && emoji()) apply({ icon: { type: "emoji", value: emoji() } });
  };

  const draw = async (file: File, how: Fit) => {
    setBusy(true);
    try {
      apply({ icon: { type: "image", value: await shrinkLogo(file, how) } });
    } catch (error) {
      toast.error(error instanceof Error && error.message.startsWith("That") ? t(error.message) : t("That file couldn't be read as a picture."));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error(t("Pick a PNG, JPG, SVG, WebP or GIF."));
    if (file.size > LOGO_FILE_MAX) return toast.error(t("That picture is over 8 MB."));
    const how = await naturalFit(file);
    setSource(file);
    setFit(how);
    await draw(file, how);
  };

  const removeLogo = () => {
    setSource(null);
    apply({ icon: undefined });
    setTab(workspaceIcon(activeWorkspace()).type);
  };

  const pickEmoji = (value: string) => {
    const glyph = firstGrapheme(value);
    setEmoji(glyph);
    if (glyph) apply({ icon: { type: "emoji", value: glyph } });
  };

  const hasLogo = () => icon().type === "image";

  return (
    // Headed like the page's other sections, Members and Delete workspace.
    <section class="flex flex-col gap-3">
      <h2 class="px-1 text-sm font-medium text-foreground">{t("Customize")}</h2>
      <DashboardSurfaceCard class="flex flex-col divide-y divide-(--plane-border-subtle) p-0">
        {/* The badge as the sidebar shows it, beside the name. */}
        <div class="flex items-center gap-3 p-4">
          <WorkspaceBadge workspace={workspace()} class="size-10 shrink-0 rounded-xl text-base" />
          <label class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-xs text-muted-foreground">{t("Name")}</span>
            <input
              class={fieldControl}
              maxLength={40}
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(workspace().name);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>

        <SettingRow label={t("Picture")} control={<PageToggle label={t("Picture")} options={ICON_TYPES} value={tab()} onChange={chooseTab} />}>
          <Switch>
            <Match when={tab() === "image"}>
              <div
                class="flex items-center gap-3 rounded-xl border border-dashed border-(--border-input) p-3 transition-colors"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void upload(event.dataTransfer?.files[0]);
                }}
              >
                <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-(--plane-layer-1) text-muted-foreground">
                  <PlaneIcon name="image-file" class="size-4" />
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-xs text-foreground">{hasLogo() ? t("Your logo") : t("Drop a logo here")}</span>
                  <span class="text-xs text-muted-foreground">{t("PNG, JPG, SVG, WebP or GIF. Shrunk to a small square, see-through parts show the color.")}</span>
                </div>
                <Show when={source() && hasLogo()}>
                  <PageToggle
                    label={t("Logo fit")}
                    options={FITS}
                    value={fit()}
                    onChange={(how) => {
                      setFit(how);
                      void draw(source()!, how);
                    }}
                  />
                </Show>
                <Show when={hasLogo()}>
                  <Button variant="ghost" onClick={removeLogo}>
                    {t("Remove")}
                  </Button>
                </Show>
                <Button variant="secondary" disabled={busy()} onClick={() => fileInput?.click()}>
                  {busy() ? t("Working…") : hasLogo() ? t("Replace") : t("Upload")}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  class="hidden"
                  onChange={(event) => {
                    void upload(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </Match>

            <Match when={tab() === "emoji"}>
              <EmojiPicker
                label={t("Emoji")}
                class="flex h-8 w-fit items-center gap-1.5 rounded-md border border-(--border-input) bg-input pr-1.5 pl-1 text-xs text-foreground transition-colors hover:bg-accent focus-ring data-[expanded]:border-primary"
                onPick={pickEmoji}
              >
                <span class="grid size-6 place-items-center text-base leading-none">{emoji() || "🙂"}</span>
                <span class="cap-centered">{emoji() ? t("Change emoji") : t("Choose an emoji")}</span>
                <Icon name="chevron-down" class="size-4 text-muted-foreground" />
              </EmojiPicker>
            </Match>

            <Match when={tab() === "letters"}>
              <label class="flex items-center gap-2">
                <input
                  class={cx(fieldControl, "w-16 text-center uppercase")}
                  maxLength={4}
                  aria-label={t("Up to two letters")}
                  placeholder={[...workspace().name.trim()][0]?.toUpperCase() ?? "W"}
                  value={initials()}
                  onInput={(event) => {
                    const value = cleanInitials(event.currentTarget.value);
                    setInitials(value);
                    apply({ icon: value ? { type: "letters", value } : { type: "letters" } });
                  }}
                />
                <span class="text-xs text-muted-foreground">
                  {t("Up to two letters")} · {t("Left empty, the name's first letter.")}
                </span>
              </label>
            </Match>

            <Match when={tab() === "mark"}>
              <p class="text-xs text-muted-foreground">{t("The plan.video mark: white on dark, black on light. Color doesn't apply to it.")}</p>
            </Match>
          </Switch>
        </SettingRow>

        <Show when={tab() !== "mark"}>
          <SettingRow
            label={t("Color")}
            control={<WorkspaceColorPicker class="flex flex-wrap justify-end gap-1.5" value={workspace().color} onChange={(color) => apply({ color })} />}
          />
        </Show>

        <SettingRow
          label={t("Shape")}
          control={
            <PageToggle
              label={t("Shape")}
              options={SHAPES}
              value={workspace().shape ?? "rounded"}
              onChange={(shape) => apply({ shape: shape === "rounded" ? undefined : shape })}
            />
          }
        />
      </DashboardSurfaceCard>
    </section>
  );
}

/** One setting in the card: its name on the left, its control on the right, and anything more under both. */
function SettingRow(props: { label: string; control: JSX.Element; children?: JSX.Element }) {
  return (
    <div class="flex flex-col gap-3 px-4 py-3">
      <div class="flex min-h-7 items-center justify-between gap-4">
        <span class="shrink-0 text-xs text-foreground">{props.label}</span>
        {props.control}
      </div>
      {props.children}
    </div>
  );
}
