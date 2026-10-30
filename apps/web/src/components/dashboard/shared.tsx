/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardGroupLabel } from "@/components/dashboard/page-header";
import { SkeletonBar } from "@/components/dashboard/page-skeleton";
import { cx } from "@/lib/cva";
import { intlLocale, t } from "@/lib/i18n";
import { zonedFormat } from "@/lib/time-zone";
import { LEVEL_OF_PLAN, billingAccount, type BillingSummary } from "@/lib/billing";
import { planOfLevel } from "@/lib/plans";
import {
  For,
  Show,
  children,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "somoto";
import { track } from "@/lib/analytics";
import { forgetProjectBundle, generateProjectName } from "@/lib/db";
import { cachedProjectCover, loadProjectCover } from "@/projects";
import {
  checkProject,
  createProject,
  deleteProject,
  ensureProjectsRoot,
  eraseProject,
  forgetProject,
  isDesktop,
  type ProjectInfo,
} from "@/projects";


type DashboardLabelValueProps = {
  label: JSX.Element;
  value: JSX.Element;
  labelClass?: string;
  valueClass?: string;
};

export function DashboardLabelValue(props: DashboardLabelValueProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p class={cx("text-foreground text-xs", props.labelClass)}>
        {props.label}
      </p>
      <p class={cx("text-muted-foreground text-xs", props.valueClass)}>
        {props.value}
      </p>
    </div>
  );
}

type DashboardSurfaceCardProps = {
  class?: string;
  children: JSX.Element;
};

export function DashboardSurfaceCard(props: DashboardSurfaceCardProps) {
  return (
    <div class={cx("depth-panel rounded-xl border border-(--plane-border-subtle) bg-(--plane-surface-1) p-4", props.class)}>
      {props.children}
    </div>
  );
}

type DashboardTitledSectionProps = {
  title: string;
  description?: string;
  hint?: string;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
};


export function DashboardTitledSection(props: DashboardTitledSectionProps) {
  return (
    <section class={cx("flex flex-col gap-2", props.class)}>
      <div class="flex flex-col gap-1 px-1">
        <DashboardGroupLabel action={props.description ? undefined : props.action}>
          <Show when={props.hint} fallback={props.title}>
            {(hint) => (
              <Tooltip placement="top-start">
                <TooltipTrigger as="span" tabIndex={0} class="inline-block cursor-help border-b border-dotted border-(--plane-text-placeholder) pb-px outline-none focus-ring">
                  {props.title}
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent class="block max-w-64 py-1.5 text-wrap">{hint()}</TooltipContent>
                </TooltipPortal>
              </Tooltip>
            )}
          </Show>
        </DashboardGroupLabel>
        <Show when={props.description}>
          <div class="flex items-center gap-2">
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">{props.description}</p>
            {props.action}
          </div>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

type DashboardSurfaceSectionProps = {
  title: string;
  description?: string;
  hint?: string;
  class?: string;
  children: JSX.Element;
};

export function DashboardSurfaceSection(props: DashboardSurfaceSectionProps) {
  return (
    <DashboardTitledSection title={props.title} description={props.description} hint={props.hint} class={props.class}>
      <DashboardSurfaceCard class="flex flex-col gap-3">
        {props.children}
      </DashboardSurfaceCard>
    </DashboardTitledSection>
  );
}

type DashboardScrollViewProps = {
  class?: string;
  children: JSX.Element;
};

export function DashboardScrollView(props: DashboardScrollViewProps) {
  return (
    <div class={cx("min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-12", props.class)}>
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">{props.children}</div>
    </div>
  );
}

type DashboardFormModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  footer: JSX.Element;
  children: JSX.Element;
};

export function DashboardFormModal(props: DashboardFormModalProps) {
  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    const container = event.currentTarget as HTMLElement;

    queueMicrotask(() => {
      container.querySelector<HTMLInputElement>(
        '[data-slot="text-field-input"]:not([disabled])',
      )?.focus();
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) props.onClose();
  };

  return (
    <Dialog open={props.open} preventScroll={false} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogContent
          onOpenAutoFocus={handleOpenAutoFocus}
          showCloseButton={false}
          class="w-77 max-w-11/12 max-h-11/12 overflow-hidden rounded-xl border-border p-0 gap-0"
        >
          <div class="flex max-h-full flex-col gap-4 px-2 py-0">
            <div class="flex w-full items-center gap-2 border-b border-border pl-2 pr-0 py-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-foreground text-xs">
                  {props.title}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={props.onClose}
                >
                  <Icon name="close-remove" class="text-foreground" />
                </TooltipTrigger>
                <TooltipContent>{t("Close")}</TooltipContent>
              </Tooltip>
            </div>

            <div class="flex min-h-0 w-full flex-col gap-6 overflow-y-auto px-2 py-0">
              {props.children}
            </div>

            <div class="flex w-full items-center justify-end border-t border-border px-1 py-3">
              <div class="flex items-center gap-2">
                {props.footer}
              </div>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

type DashboardPlanDetailsProps = {
  details: readonly {
    label: JSX.Element;
    value: JSX.Element;
  }[];
};

export function DashboardPlanDetails(props: DashboardPlanDetailsProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center md:gap-4">
      <For each={props.details}>
        {(detail, index) => (
          <>
            <DashboardLabelValue
              label={detail.label}
              value={detail.value}
              labelClass="truncate"
              valueClass="truncate"
            />
            <Show when={index() < props.details.length - 1}>
              <div class="hidden h-8 w-px shrink-0 bg-border md:block" />
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

export function DashboardFreePlanDetails() {
  return (
    <DashboardPlanDetails
      details={[
        { label: t("Free"), value: "$0.00" },
      ]}
    />
  );
}

const RENEWAL_DATE_FORMAT = zonedFormat({
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

/** Shared with whoever shows the plan, so a change there shows here too. */
export type BillingSummarySource = { loaded: () => boolean; summary: () => BillingSummary | undefined };

export function DashboardProPlanDetails(props: { source?: BillingSummarySource }) {
  const [account] = createResource(
    () => (props.source ? undefined : true),
    () => billingAccount().catch(() => null),
  );
  // Drawn at once, with grey lines until the plan is in.
  const loaded = () => (props.source ? props.source.loaded() : account.state === "ready");
  const summary = () => (props.source ? props.source.summary() : loaded() ? account.latest?.summary ?? undefined : undefined);

  const priceLabel = () => {
    const s = summary();
    if (!s) return "\u2014";
    const price = formatCurrency(s.amount, s.currency);
    return s.billingPeriod === "year" ? t("{price}/yr", { price }) : t("{price}/mo", { price });
  };

  const renewsLabel = () => {
    const s = summary();
    if (!s) return "\u2014";
    return RENEWAL_DATE_FORMAT.format(new Date(s.currentPeriodEnd));
  };
  const planName = () => {
    const s = summary();
    return s ? t(planOfLevel(LEVEL_OF_PLAN[s.plan]).name) : "\u2014";
  };

  return (
    <Show
      when={loaded()}
      fallback={
        <DashboardPlanDetails
          details={[
            { label: <SkeletonBar class="my-0.5 h-3 w-16" />, value: <SkeletonBar class="my-0.5 h-3 w-20" /> },
            { label: <SkeletonBar class="my-0.5 h-3 w-12" />, value: <SkeletonBar class="my-0.5 h-3 w-28" /> },
          ]}
        />
      }
    >
      <DashboardPlanDetails
        details={[
          { label: planName(), value: priceLabel() },
          { label: summary()?.cancelAtPeriodEnd ? t("Ends") : t("Renews"), value: renewsLabel() },
        ]}
      />
    </Show>
  );
}

type DashboardDividedStackProps = {
  class?: string;
  spacing?: "tight" | "loose";
  children: JSX.Element;
};

export function DashboardDividedStack(props: DashboardDividedStackProps) {
  const resolved = children(() => props.children);
  const items = () =>
    resolved.toArray().filter((item) => item != null && typeof item !== "boolean");
  const isLoose = () => props.spacing === "loose";

  return (
    <div
      class={cx("flex flex-col", props.class)}
      classList={{
        "gap-0": isLoose(),
        "gap-3": !isLoose(),
      }}
    >
      <For each={items()}>
        {(item, index) => (
          <>
            {item}
            <Show when={index() < items().length - 1}>
              <Show when={isLoose()} fallback={<Separator />}>
                <Separator class="my-3" />
              </Show>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

type DashboardPlanSummaryCardProps = {
  action: JSX.Element;
  children: JSX.Element;
  class?: string;
};

export function DashboardPlanSummaryCard(props: DashboardPlanSummaryCardProps) {
  return (
    <DashboardSurfaceCard class={cx("flex flex-col gap-4", props.class)}>
      <div class="flex flex-col gap-4 md:flex-row md:items-center">
        {props.children}
        {props.action}
      </div>
    </DashboardSurfaceCard>
  );
}

type DashboardFeatureRowProps = {
  label: string;
};

export function DashboardFeatureRow(props: DashboardFeatureRowProps) {
  return (
    <div class="flex items-center gap-2">
      <span class="size-4 flex items-center justify-center text-primary overflow-clip">
        <Icon name="confirm-check" />
      </span>
      <p class="text-muted-foreground text-xs">
        {props.label}
      </p>
    </div>
  );
}

type DashboardInfoActionRowProps = {
  title: string;
  titleContent?: JSX.Element | string;
  description?: JSX.Element;
  action: JSX.Element;
  leading?: JSX.Element;
  /** "sm" lets a 24px icon overhang a 16px slot. */
  leadingSize?: "sm" | "md";
  layout?: "responsive" | "responsive-md" | "inline";
};

export function DashboardInfoActionRow(props: DashboardInfoActionRowProps) {
  const layoutClass = () => {
    if (props.layout === "inline") return "flex-row items-center gap-4";
    if (props.layout === "responsive-md") return "flex-col gap-4 md:flex-row md:items-center";
    return "flex-col gap-4 sm:flex-row sm:items-center";
  };

  const hasDescription = () => props.description !== undefined;
  const leadingAlignClass = () => {
    if (hasDescription()) return "items-start";
    return "items-center";
  };

  const renderTitleText = (value: string) => (
    <p
      class={cx(
        "text-xs leading-4 text-foreground",
        props.layout === "inline" ? "min-w-0 flex-1 truncate" : undefined,
      )}
    >
      {value}
    </p>
  );

  const titleContent = () => {
    const content = props.titleContent;

    if (content === undefined) return renderTitleText(props.title);
    if (typeof content === "string" || typeof content === "number") {
      return renderTitleText(String(content));
    }

    return content;
  };

  const textContent = () => (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      {titleContent()}
      <Show when={props.description}>
        <p class="text-muted-foreground text-xs leading-4">
          {props.description}
        </p>
      </Show>
    </div>
  );

  return (
    <div class={cx("flex", layoutClass())}>
      <Show
        when={props.leading}
        fallback={
          textContent()
        }
      >
        <div class={cx("flex min-w-0 flex-1 gap-2", leadingAlignClass())}>
          <span
            class={cx(
              // Flex centring overhangs an oversized icon evenly on every side; a
              // grid track would grow to fit it and pin it to the top-left.
              "flex shrink-0 items-center justify-center text-muted-foreground",
              props.leadingSize === "sm" ? "size-4" : "size-6",
            )}
          >
            {props.leading}
          </span>
          {textContent()}
        </div>
      </Show>

      {props.action}
    </div>
  );
}

type DashboardCardButtonProps = {
  active?: boolean;
  /** Set on project cards so a drag can tell them from New project. */
  marqueeIndex?: number;
  "aria-disabled"?: boolean;
  onClick?(event?: MouseEvent): void;
  onDoubleClick?(): void;
  onEscape?(): void;
  onDelete?(): void;
  draggable?: boolean;
  onDragStart?(event: DragEvent): void;
  children: JSX.Element;
  class?: string;
};

export function DashboardCardButton(props: DashboardCardButtonProps) {
  const handleKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      const activate = props.onDoubleClick ?? props.onClick;
      if (!activate) return;

      event.preventDefault();
      activate();
      return;
    }

    if (event.key === " ") {
      if (!props.onClick) return;

      event.preventDefault();
      props.onClick();
      return;
    }

    if (event.key === "Escape") {
      if (!props.onEscape) return;

      event.preventDefault();
      props.onEscape();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      if (!props.onDelete) return;

      event.preventDefault();
      props.onDelete();
    }
  };

  return (
    <div
      data-slot="card-button"
      data-marquee-index={props.marqueeIndex}
      role="button"
      tabIndex={props["aria-disabled"] ? -1 : 0}
      aria-disabled={props["aria-disabled"] || undefined}
      onClick={props.onClick}
      onDblClick={props.onDoubleClick}
      onKeyDown={handleKeyDown}
      draggable={props.draggable || undefined}
      onDragStart={props.onDragStart}
      class={cx(
        "depth-card depth-unlit flex min-w-0 flex-col gap-3 rounded-xl px-2 pt-2 pb-3 text-left outline-none focus-ring group",
        props.active && "bg-primary/15 ring-1 ring-inset ring-primary",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

function surfaceBehind(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && colour !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(colour)) return colour;
  }
  return getComputedStyle(document.body).backgroundColor;
}

export function setCardPileDragImage(event: DragEvent, cards: HTMLElement[], count: number) {
  const top = cards[0];
  if (!event.dataTransfer || !top || count < 2) return;

  const scale = 0.5;
  const rect = top.getBoundingClientRect();
  const width = rect.width * scale;
  const height = rect.height * scale;
  // Room for the tipped cards' corners and the badge, which the picture would clip.
  const pad = 16;
  const pile = document.createElement("div");
  pile.setAttribute("aria-hidden", "true");
  Object.assign(pile.style, {
    position: "fixed",
    left: `${event.clientX}px`,
    top: `${event.clientY}px`,
    width: `${width + pad * 2}px`,
    height: `${height + pad * 2}px`,
    pointerEvents: "none",
    zIndex: "2147483647",
  });

  // One group, so the cards fade together rather than showing through each other.
  const stack = document.createElement("div");
  Object.assign(stack.style, { position: "absolute", inset: "0", opacity: "0.7" });
  pile.append(stack);

  const surface = surfaceBehind(top);
  const radius = parseFloat(getComputedStyle(top).borderRadius) * scale;
  const layers = Array.from({ length: Math.min(count, 3) }, (_, index) => cards[index] ?? top);
  const tilts = [0, 3, -3];
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "absolute",
      left: `${pad}px`,
      top: `${pad}px`,
      width: `${width}px`,
      height: `${height}px`,
      borderRadius: `${radius}px`,
      backgroundColor: surface,
      transform: `rotate(${tilts[index]}deg)`,
    });
    const copy = layers[index].cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-marquee-index");
    copy.removeAttribute("data-slot");
    // zoom, not a transform: the picture is cut to the laid-out box.
    Object.assign(copy.style, { width: `${rect.width}px`, height: `${rect.height}px`, transform: "none", zoom: String(scale) });
    layer.append(copy);
    stack.append(layer);
  }

  const badge = document.createElement("span");
  badge.className =
    "absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums";
  Object.assign(badge.style, { top: `${pad - 8}px`, left: `${pad + width - 12}px` });
  badge.textContent = count.toLocaleString(intlLocale());
  pile.append(badge);

  document.body.append(pile);
  event.dataTransfer.setDragImage(pile, pad - 10, pad - 10);
  // The browser has its picture once dragstart returns; gone before anything paints.
  requestAnimationFrame(() => pile.remove());
}

type DashboardCardPreviewProps = {
  children?: JSX.Element;
  class?: string;
};

export function DashboardCardPreview(props: DashboardCardPreviewProps) {
  return (
    <div
      class={cx(
        "bg-canvas relative aspect-video w-full overflow-hidden rounded-md border border-border transition-colors group-hover:border-(--border-input)",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

type DashboardCardMetaProps = {
  title: string;
  subtitle?: string;
};

export function DashboardCardMeta(props: DashboardCardMetaProps) {
  const hasSubtitle = () => props.subtitle !== undefined;

  return (
    <div class="flex flex-col gap-1 px-2">
      <p class="min-w-0 truncate text-xs font-medium text-foreground">
        {props.title}
      </p>
      <p
        class="min-w-0 truncate text-xs   text-muted-foreground"
        classList={{ "opacity-0": !hasSubtitle() }}
        aria-hidden={hasSubtitle() ? undefined : "true"}
      >
        {props.subtitle ?? "\u00A0"}
      </p>
    </div>
  );
}

export function createBackgroundClickHandler(onCLick: () => void): JSX.EventHandlerUnion<HTMLDivElement, MouseEvent> {
  return (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-slot="card-button"]')) return;

    onCLick();
  };
}

/** Null when the user is asked where to put the project and declines. */
export async function createNewProject(): Promise<ProjectInfo | null> {
  if (!(await ensureProjectsRoot())) return null;

  const project = await createProject(generateProjectName());
  track("project_created");
  return project;
}

/**
 * Null when the folder is gone or no longer a project. The list isn't touched:
 * a folder on an unmounted volume comes back with the volume.
 */
export async function openProjectFromList(project: ProjectInfo): Promise<ProjectInfo | null> {
  if (!isDesktop()) return project;

  const current = await checkProject(project);
  if (current) return current;

  toast.error(t("Could not find {name}", { name: project.displayName }), {
    description: t("There is no project at {path}. It may be on a disk that is not connected.", { path: project.dir }),
    action: {
      label: t("Remove from list"),
      onClick: () => {
        forgetProject(project.dir).catch((e) => {
          toast.error(t("Failed to remove project"), { description: (e as Error).message });
        });
      },
    },
  });
  return null;
}

/** In the browser the files stay for 30 days, and the cached bundle stays so a restore opens as before. */
export async function trashProject(project: ProjectInfo): Promise<void> {
  await deleteProject(project.dir);
  if (isDesktop()) forgetProjectBundle(project.id);
  track("project_deleted");
}

export async function eraseTrashedProject(project: ProjectInfo): Promise<void> {
  await eraseProject(project);
  track("project_deleted");
}


type DashboardViewSectionProps = {
  children: JSX.Element;
  class?: string;
  onBackgroundClick?(): void;
  onPointerDown?(event: PointerEvent): void;
  /** Keeps the grid from highlighting text during a selection drag. */
  selecting?: boolean;
};

export function DashboardViewSection(props: DashboardViewSectionProps) {
  const handleClick = createBackgroundClickHandler(() =>
    props.onBackgroundClick?.(),
  );

  return (
    <div class={cx("flex min-h-0 flex-1 flex-col pt-5", props.class)}>
      {/* pt-1 inside the scroll area: a hovered card lifts 1px, which would clip
          the top of its ring against the scroll edge. */}
      <div
        class={cx("min-h-0 flex-1 overflow-y-auto px-4 pt-1", props.selecting && "select-none")}
        onClick={handleClick}
        onPointerDown={props.onPointerDown}
      >
        <div
          data-slot="card-grid"
          class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start items-start gap-x-0.5 gap-y-3"
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}

/** A full canvas shot is scaled down before it shows, so the grid doesn't hitch while the browser decodes it. */
export function DashboardProjectThumbnail(props: { cover: Blob | null; cacheKey: string }) {
  const [url, setUrl] = createSignal<string | null>(
    props.cover ? cachedProjectCover(props.cacheKey, props.cover) : null,
  );

  createEffect(() => {
    const blob = props.cover;
    if (!blob) {
      setUrl(null);
      return;
    }

    const hit = cachedProjectCover(props.cacheKey, blob);
    if (hit) {
      setUrl(hit);
      return;
    }

    let cancelled = false;
    void loadProjectCover(props.cacheKey, blob).then((next) => {
      if (!cancelled) setUrl(next);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <Show when={url()}>
      <img
        src={url()!}
        alt=""
        class="absolute inset-0 size-full object-cover"
        draggable={false}
      />
    </Show>
  );
}
