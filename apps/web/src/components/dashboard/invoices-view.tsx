/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource } from "solid-js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { SkeletonBar } from "@/components/dashboard/page-skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { intlLocale, msg, t } from "@/lib/i18n";
import { timeZone } from "@/lib/time-zone";
import { listInvoices, type RawInvoice } from "@/lib/billing";

import { DashboardDividedStack, DashboardSurfaceCard } from "./shared";

type InvoiceStatus = "Upcoming" | "Open" | "Overdue" | "Paid";
type InvoiceBadgeVariant = "base" | "destructive" | "success";

export type InvoiceItem = {
  id: string;
  dueDate: string;
  amount: string;
  status: InvoiceStatus;
  url: string | null;
};

function formatInvoiceDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString(intlLocale("en-US"), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timeZone(),
  });
}

function formatInvoiceAmount(totalMinor: number, currency: string): string {
  return new Intl.NumberFormat(intlLocale("en-US"), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(totalMinor / 100);
}

function mapInvoiceStatus(
  status: string | null,
  dueDateMs: number,
): InvoiceStatus {
  if (status === "paid") return "Paid";
  if (status === "draft") return "Upcoming";
  if (status === "uncollectible") return "Overdue";
  if (status === "open") return dueDateMs < Date.now() ? "Overdue" : "Open";
  return "Open";
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  Upcoming: msg("Upcoming"),
  Open: msg({ message: "Open", context: "invoice status" }),
  Overdue: msg("Overdue"),
  Paid: msg("Paid"),
};

function toInvoiceItem(invoice: RawInvoice): InvoiceItem {
  return {
    id: invoice.id,
    dueDate: formatInvoiceDate(invoice.dueDate),
    amount: formatInvoiceAmount(invoice.total, invoice.currency),
    status: mapInvoiceStatus(invoice.status, invoice.dueDate),
    url: invoice.hostedUrl,
  };
}

function DashboardInvoicesEmptyState() {
  return (
    <DashboardSurfaceCard class="grid min-h-62 w-full place-items-center">
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon name="info" class="text-muted-foreground" />
        <p class="text-muted-foreground text-xs">
          {t("No invoices yet")}<br />
          {t("Your invoices will show up here once available.")}
        </p>
      </div>
    </DashboardSurfaceCard>
  );
}

function DashboardInvoicesHeader() {
  return (
    <div class="px-4 pb-3 pt-2">
      <div class="flex items-center gap-4 text-xs text-muted-foreground">
        <p class="min-w-0 flex-1">{t("Due date")}</p>
        <p class="w-24">{t("Amount")}</p>
        <p class="w-24">{t("Status")}</p>
        <span class="w-7 shrink-0" />
      </div>
    </div>
  );
}

/** The list's own columns, in grey, while the invoices load. */
function DashboardInvoicesSkeleton() {
  return (
    <div aria-hidden="true" class="flex flex-col">
      <DashboardInvoicesHeader />
      <DashboardSurfaceCard>
        <DashboardDividedStack spacing="loose">
          <For each={[0, 1, 2]}>
            {() => (
              <div class="flex items-center gap-4">
                <div class="min-w-0 flex-1">
                  <SkeletonBar class="h-3 w-32" />
                </div>
                <div class="w-24">
                  <SkeletonBar class="h-3 w-14" />
                </div>
                <div class="w-24">
                  <SkeletonBar class="h-5 w-12" />
                </div>
                <span class="size-7 shrink-0" />
              </div>
            )}
          </For>
        </DashboardDividedStack>
      </DashboardSurfaceCard>
    </div>
  );
}

function DashboardInvoicesList(props: { invoices: InvoiceItem[] }) {
  const badgeVariant = (status: InvoiceStatus): InvoiceBadgeVariant => {
    if (status === "Overdue") return "destructive";
    if (status === "Paid") return "success";
    return "base";
  };

  const openInvoice = (url: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div class="flex flex-col">
      <DashboardInvoicesHeader />

      <DashboardSurfaceCard>
        <DashboardDividedStack spacing="loose">
          <For each={props.invoices}>
            {(invoice) => (
              <div class="flex items-center gap-4">
                <p class="min-w-0 flex-1 truncate text-xs text-foreground">
                  {invoice.dueDate}
                </p>
                <p class="w-24 text-xs text-foreground">
                  {invoice.amount}
                </p>
                <div class="w-24">
                  <Badge variant={badgeVariant(invoice.status)}>
                    {t(STATUS_LABELS[invoice.status])}
                  </Badge>
                </div>
                <Tooltip>
                  <TooltipTrigger
                    as={Button}
                    variant="ghost"
                    size="icon-square"
                    disabled={!invoice.url}
                    onClick={() => openInvoice(invoice.url)}
                  >
                    <Icon name="external-link" />
                  </TooltipTrigger>
                  <TooltipContent>{t("Open invoice")}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </For>
        </DashboardDividedStack>
      </DashboardSurfaceCard>
    </div>
  );
}

export function DashboardInvoicesView() {
  const [invoices] = createResource<InvoiceItem[]>(async () => {
    try {
      const raw = await listInvoices();
      return raw.map(toInvoiceItem);
    } catch (err) {
      console.error("Failed to load invoices", err);
      return [];
    }
  });

  return (
    <Show when={!invoices.loading} fallback={<DashboardInvoicesSkeleton />}>
      <Show when={(invoices() ?? []).length > 0} fallback={<DashboardInvoicesEmptyState />}>
        <DashboardInvoicesList invoices={invoices()!} />
      </Show>
    </Show>
  );
}
