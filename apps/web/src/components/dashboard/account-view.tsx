/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Show, createEffect, createSignal } from "solid-js";
import { toast } from "somoto";

import { AvatarPhoto, useAvatar } from "@/hooks/use-avatar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import {
  Switch,
  SwitchControl,
  SwitchInput,
  SwitchLabel,
  SwitchThumb,
} from "@/components/ui/switch";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import { type EmailPreferenceColumn, useAuth } from "@/context/auth";
import { msg, t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

import {
  DashboardDividedStack,
  DashboardFormModal,
  DashboardFreePlanDetails,
  DashboardInfoActionRow,
  DashboardProPlanDetails,
  DashboardPlanSummaryCard,
  DashboardScrollView,
  DashboardSurfaceSection,
  DashboardTitledSection,
  DashboardSurfaceCard,
} from "./shared";
import { cropAndResizeAvatar } from "./utils";

type AccountRowStatusTone = "muted" | "primary";

type AccountPreferenceRow = {
  title: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
};

type DashboardAccountStatusProps = {
  value: string;
  tone?: AccountRowStatusTone;
};

function DashboardAccountStatus(props: DashboardAccountStatusProps) {
  return (
    <span
      class="truncate text-xs"
      classList={{
        "text-primary": props.tone === "primary",
        "text-muted-foreground": props.tone !== "primary",
      }}
    >
      {props.value}
    </span>
  );
}

function DashboardAccountInfoRow(props: {
  icon: string;
  label: string;
  description?: string;
  status?: string;
  statusTone?: AccountRowStatusTone;
  actionLabel: string;
  actionDisabled?: boolean;
  onClick?(): void;
}) {
  const statusText = () => props.status;

  return (
    <DashboardInfoActionRow
      leading={
        <Icon
          name={props.icon}
          class="size-6 text-foreground"
        />
      }
      title={props.label}
      titleContent={
        <Show
          when={props.status}
          fallback={
            <p class="truncate text-foreground text-xs">
              {props.label}
            </p>
          }
        >
          <div class="flex min-w-0 items-center gap-1">
            <p class="truncate text-foreground text-xs">
              {props.label}
            </p>
            <span class="text-muted-foreground text-xs">
              {"\u00B7"}
            </span>
            <DashboardAccountStatus
              value={statusText() ?? ""}
              tone={props.statusTone}
            />
          </div>
        </Show>
      }
      description={props.description ? <p>{props.description}</p> : undefined}
      action={
        <Button variant="secondary" disabled={props.actionDisabled} onClick={props.onClick}>
          {props.actionLabel}
        </Button>
      }
    />
  );
}

function DashboardAccountPreferenceRow(props: AccountPreferenceRow) {
  return (
    <Switch
      checked={props.checked}
      onChange={props.onChange}
      class="flex items-center gap-4"
    >
      <SwitchLabel class="min-w-0 flex-1 cursor-pointer pr-4 text-xs font-normal">
        <span class="block text-foreground">
          {props.title}
        </span>
        <span class="mt-1 block text-muted-foreground">
          {props.description}
        </span>
      </SwitchLabel>
      <SwitchInput aria-label={t("Email preference: {name}", { name: props.title })} />
      <SwitchControl variant="compact">
        <SwitchThumb variant="compact" />
      </SwitchControl>
    </Switch>
  );
}

function DashboardAccountPersonalDetailsSection() {
  const auth = useAuth();
  const [firstName, setFirstName] = createSignal(
    (auth.user()?.user_metadata?.first_name as string) ?? ""
  );
  const [lastName, setLastName] = createSignal(
    (auth.user()?.user_metadata?.last_name as string) ?? ""
  );
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  /** Save stays off until a name differs from what the account has. */
  const changed = () =>
    firstName().trim() !== ((auth.user()?.user_metadata?.first_name as string) ?? "") ||
    lastName().trim() !== ((auth.user()?.user_metadata?.last_name as string) ?? "");
  const [localPreview, setLocalPreview] = createSignal<string | null>(null);

  let fileInputRef!: HTMLInputElement;

  const avatarUrl = useAvatar();
  const displayUrl = () => localPreview() ?? avatarUrl();

  const initial = () => {
    const name = auth.user()?.user_metadata?.full_name || auth.user()?.email || "U";
    return (name as string).charAt(0).toUpperCase();
  };

  const handleAvatarUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !supabase) return;

    const file = input.files[0]!;
    setUploading(true);

    try {
      const blob = await cropAndResizeAvatar(file);

      // Optimistic preview
      const prev = localPreview();
      if (prev) URL.revokeObjectURL(prev);
      setLocalPreview(URL.createObjectURL(blob));

      const userId = auth.user()?.id;
      if (!userId) throw new Error(t("Not authenticated"));

      const filePath = `${userId}/${Date.now()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { contentType: "image/webp", upsert: false });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: filePath },
      });

      if (updateError) throw updateError;

      await auth.refreshSession();
      toast.success(t("Profile photo updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Upload failed"));
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const savedFirst = () => (auth.user()?.user_metadata?.first_name as string) ?? "";
  const savedLast = () => (auth.user()?.user_metadata?.last_name as string) ?? "";
  /** An uploaded photo can be taken off; a Google one belongs to Google. */
  const hasUpload = () => !!localPreview() || typeof auth.user()?.user_metadata?.avatar_url === "string" && !!auth.user()?.user_metadata?.avatar_url;
  const displayName = () =>
    [savedFirst(), savedLast()].filter(Boolean).join(" ") || (auth.user()?.user_metadata?.full_name as string | undefined) || "";

  const handleRemovePhoto = async () => {
    if (!supabase || uploading()) return;
    setUploading(true);
    try {
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: "" } });
      if (error) throw error;
      const prev = localPreview();
      if (prev) URL.revokeObjectURL(prev);
      setLocalPreview(null);
      await auth.refreshSession();
      toast.success(t("Profile photo removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Couldn't remove the photo"));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!supabase || !changed() || saving()) return;
    setSaving(true);

    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: firstName().trim(),
        last_name: lastName().trim(),
        full_name: [firstName().trim(), lastName().trim()].filter(Boolean).join(" "),
      },
    });

    setSaving(false);

    if (error) {
      toast.error(error.message);
    } else {
      await auth.refreshSession();
      toast.success(t("Profile updated"));
    }
  };

  const discard = () => {
    setFirstName(savedFirst());
    setLastName(savedLast());
  };

  const nameField = (label: string, value: () => string, setValue: (value: string) => void, autocomplete: string) => (
    <TextField class="flex flex-col gap-1.5">
      <TextFieldLabel uiSize="compact" class="text-xs font-medium text-(--plane-text-secondary)">
        {t(label)}
      </TextFieldLabel>
      <TextFieldInput
        uiSize="compact"
        autocomplete={autocomplete}
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") void handleSave();
          if (event.key === "Escape") discard();
        }}
        onKeyUp={(event) => event.stopPropagation()}
      />
    </TextField>
  );

  return (
    <DashboardTitledSection title={t("Personal details")}>
      <div class="overflow-hidden rounded-xl border border-(--plane-border-subtle) bg-(--plane-surface-1)">
        <div class="flex items-center gap-4 px-4 py-5">
          <button
            type="button"
            class="group relative size-14 shrink-0 overflow-hidden rounded-full outline-none press focus-ring"
            aria-label={t("Upload a profile photo")}
            disabled={uploading()}
            onClick={() => fileInputRef.click()}
          >
            <AvatarPhoto
              url={displayUrl()}
              class="size-full object-cover"
              fallback={
                <span class="grid size-full place-items-center bg-(--plane-accent-subtle-active) text-lg font-medium text-(--plane-accent-secondary)">
                  {initial()}
                </span>
              }
            />
            <span
              class="absolute inset-0 grid place-items-center bg-black/55 text-white transition-opacity"
              classList={{ "opacity-100": uploading(), "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100": !uploading() }}
            >
              <Icon name={uploading() ? "spinner-loader" : "controls-export-current-frame-camera"} class={uploading() ? "size-6 animate-spin" : "size-6"} />
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" class="hidden" onChange={handleAvatarUpload} />

          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-sm font-medium text-(--plane-text-primary)">
              {displayName() || <span class="text-(--plane-text-tertiary)">{t("Add your name")}</span>}
            </span>
            <span class="truncate text-xs text-(--plane-text-tertiary)">{auth.user()?.email}</span>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <Show when={hasUpload()}>
              <Button variant="ghost" class="text-muted-foreground" disabled={uploading()} onClick={() => void handleRemovePhoto()}>
                {t("Remove")}
              </Button>
            </Show>
            <Button variant="secondary" title={t("A square photo works best")} disabled={uploading()} onClick={() => fileInputRef.click()}>
              {hasUpload() || displayUrl() ? t("Change photo") : t("Upload photo")}
            </Button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 border-t border-(--plane-border-subtle) px-4 py-5 sm:grid-cols-2">
          {nameField(msg("First name"), firstName, setFirstName, "given-name")}
          {nameField(msg("Last name"), lastName, setLastName, "family-name")}
        </div>

        <div class="flex min-h-12 items-center gap-3 border-t border-(--plane-border-subtle) bg-(--plane-fill-faint) px-4 py-2.5">
          <p class="min-w-0 flex-1 text-xs text-(--plane-text-tertiary)">
            {changed() ? t("You have unsaved changes.") : t("Shown on your profile across plan.video.")}
          </p>
          <Show when={changed()}>
            <Button variant="ghost" class="text-muted-foreground" disabled={saving()} onClick={discard}>
              {t("Discard")}
            </Button>
          </Show>
          <Button class="gap-1 px-3" disabled={!changed() || saving()} onClick={() => void handleSave()}>
            <Show when={saving()}>
              <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
            </Show>
            {t("Save")}
          </Button>
        </div>
      </div>
    </DashboardTitledSection>
  );
}

function DashboardAccountLoginSecuritySection() {
  const auth = useAuth();
  const email = () => auth.user()?.email ?? "";
  const emailConfirmed = () => !!auth.user()?.email_confirmed_at;

  const [modalOpen, setModalOpen] = createSignal(false);
  const [newEmail, setNewEmail] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const handleChangeEmail = async () => {
    if (!supabase) return;

    const trimmed = newEmail().trim();
    if (!trimmed) return;

    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ email: trimmed });

    setSubmitting(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(t("Confirmation link sent to your new email address"));
      setModalOpen(false);
      setNewEmail("");
    }
  };

  return (
    <DashboardSurfaceSection title={t("Login & security")}>
      <DashboardDividedStack>
        <DashboardAccountInfoRow
          icon="email"
          label={t("Email address")}
          status={emailConfirmed() ? t("Verified") : t("Unverified")}
          statusTone={emailConfirmed() ? "muted" : "primary"}
          description={email()}
          actionLabel={t("Change email")}
          onClick={() => setModalOpen(true)}
        />
      </DashboardDividedStack>

      <DashboardFormModal
        open={modalOpen()}
        title={t("Change email")}
        onClose={() => setModalOpen(false)}
        footer={
          <Button
            disabled={submitting() || !newEmail().trim()}
            onClick={() => void handleChangeEmail()}
          >
            {submitting() ? t("Sending...") : t("Send confirmation")}
          </Button>
        }
      >
        <div class="flex flex-col gap-3 px-2">
          <p class="text-muted-foreground text-xs">
            {t("We'll send a confirmation link to your new email address.")}
          </p>
          <TextField>
            <TextFieldLabel uiSize="compact" class="text-muted-foreground">
              {t("New email address")}
            </TextFieldLabel>
            <TextFieldInput
              uiSize="compact"
              type="email"
              value={newEmail()}
              onInput={(e) => setNewEmail(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void handleChangeEmail();
              }}
              onKeyUp={(e) => e.stopPropagation()}
            />
          </TextField>
        </div>
      </DashboardFormModal>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountActiveSessionsSection() {
  const auth = useAuth();

  return (
    <DashboardSurfaceSection title={t("Active sessions")}>
      <DashboardAccountInfoRow
        icon="mac-device"
        label={t("Current session")}
        status={t("Active")}
        statusTone="primary"
        actionLabel={t("Log out")}
        onClick={auth.signOut}
      />
    </DashboardSurfaceSection>
  );
}

function DashboardAccountLinkedAccountsSection() {
  const auth = useAuth();
  const [busy, setBusy] = createSignal(false);

  const identities = () => auth.user()?.identities ?? [];
  const identity = (provider: string) => identities().find((item) => item.provider === provider);
  // Supabase won't remove the last way in, so neither does this page.
  const onlyWayIn = (provider: string) => !!identity(provider) && identities().length <= 1;

  const disconnect = async () => {
    const google = identity("google");
    if (!supabase || !google || onlyWayIn("google")) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.unlinkIdentity(google);
      if (error) {
        toast.error(t("Couldn't disconnect Google"), { description: error.message });
        return;
      }
      await auth.refreshSession();
      toast.success(t("Google disconnected"), { description: t("Sign in with your email from now on.") });
    } finally {
      setBusy(false);
    }
  };

  // Manual linking is off in Supabase (a link could be finished in someone else's
  // browser), so this only lets an account already linked disconnect Google.
  return (
    <Show when={identity("google")}>
      <DashboardSurfaceSection title={t("Linked accounts")}>
        <DashboardDividedStack>
          <DashboardAccountInfoRow
            icon="social.google"
            label="Google"
            status={t("Connected")}
            description={
              onlyWayIn("google")
                ? t("It's how you sign in, so it can't be disconnected.")
                : (identity("google")?.identity_data?.email as string | undefined)
            }
            actionLabel={t("Disconnect")}
            actionDisabled={busy() || onlyWayIn("google")}
            onClick={() => void disconnect()}
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>
    </Show>
  );
}

function DashboardAccountFreePlanCard() {
  const [, setParams] = useSearchParams();

  return (
    <DashboardSurfaceCard class="flex flex-col gap-4 md:flex-row md:items-center">
      <DashboardFreePlanDetails />

      <Button
        class="gap-0 pl-0 pr-2"
        onClick={() => setParams({ dashboard: "billing" }, { replace: true })}
      >
        <span class="grid h-7 w-6 place-items-center overflow-clip">
          <Icon name="upgrade" class="size-6" />
        </span>
        {t("Upgrade")}
      </Button>
    </DashboardSurfaceCard>
  );
}

function DashboardAccountPlanSection() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();

  return (
    <DashboardTitledSection title={t("Plan")}>
      <Show
        when={auth.isPro()}
        fallback={<DashboardAccountFreePlanCard />}
      >
        <DashboardPlanSummaryCard
          action={
            <Button
              variant="secondary"
              onClick={() => setParams({ dashboard: "billing" }, { replace: true })}
            >
              {t("View details")}
            </Button>
          }
        >
          <DashboardProPlanDetails />
        </DashboardPlanSummaryCard>
      </Show>
    </DashboardTitledSection>
  );
}

function DashboardAccountEmailPreferencesSection() {
  const auth = useAuth();
  const [optimistic, setOptimistic] =
    createSignal<Partial<Record<EmailPreferenceColumn, boolean>>>({});

  const serverValue = (column: EmailPreferenceColumn) =>
    column === "product_updates_enabled"
      ? auth.productUpdatesEnabled()
      : column === "post_alerts_enabled"
        ? auth.postAlertsEnabled()
        : auth.marketingAnnouncementsEnabled();

  const value = (column: EmailPreferenceColumn) =>
    optimistic()[column] ?? serverValue(column);

  // Clear optimistic overrides once the server state catches up via realtime.
  createEffect(() => {
    const current = optimistic();
    let next = current;
    for (const column of [
      "product_updates_enabled",
      "marketing_announcements_enabled",
      "post_alerts_enabled",
    ] as const) {
      if (column in current && current[column] === serverValue(column)) {
        if (next === current) next = { ...current };
        delete next[column];
      }
    }
    if (next !== current) setOptimistic(next);
  });

  const handleChange = (column: EmailPreferenceColumn) => async (v: boolean) => {
    setOptimistic({ ...optimistic(), [column]: v });
    const { error } = await auth.setEmailPreference(column, v);
    if (error) {
      const next = { ...optimistic() };
      delete next[column];
      setOptimistic(next);
      toast.error(t("Action failed"), { description: error });
    }
  };

  return (
    <DashboardSurfaceSection title={t("Email preferences")}>
      <DashboardDividedStack>
        <DashboardAccountPreferenceRow
          title={t("Post problems")}
          description={t("When a scheduled post doesn't go out or an account's login runs out.")}
          checked={value("post_alerts_enabled")}
          onChange={handleChange("post_alerts_enabled")}
        />
        <DashboardAccountPreferenceRow
          title={t("Product updates")}
          description={t("Feature updates and important changes.")}
          checked={value("product_updates_enabled")}
          onChange={handleChange("product_updates_enabled")}
        />
        <DashboardAccountPreferenceRow
          title={t("Marketing & announcements")}
          description={t("Product news and announcements.")}
          checked={value("marketing_announcements_enabled")}
          onChange={handleChange("marketing_announcements_enabled")}
        />
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountDangerZoneSection() {
  const auth = useAuth();
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await auth.deleteAccount();
    setDeleting(false);

    if (error) {
      toast.error(error);
    } else {
      setConfirmOpen(false);
      toast.success(t("Your account has been deleted."));
    }
  };

  return (
    <DashboardSurfaceSection title={t("Danger zone")}>
      <DashboardInfoActionRow
        title={t("Permanently delete your account and all associated data.")}
        action={
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            {t("Delete account")}
          </Button>
        }
      />

      <AlertDialog open={confirmOpen()} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete account")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This action is permanent and cannot be undone. All your projects, data, and settings will be permanently removed.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting()}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting()}
              onClick={handleDelete}
            >
              {deleting() ? t("Deleting...") : t("Yes, delete my account")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardSurfaceSection>
  );
}

export function DashboardAccountView() {
  return (
    <DashboardScrollView>
      <DashboardAccountPersonalDetailsSection />
      <DashboardAccountLoginSecuritySection />
      <DashboardAccountActiveSessionsSection />
      <DashboardAccountLinkedAccountsSection />
      <DashboardAccountPlanSection />
      <DashboardAccountEmailPreferencesSection />
      <DashboardAccountDangerZoneSection />
    </DashboardScrollView>
  );
}
