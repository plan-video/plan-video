/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { toast } from "somoto";

import { PlaneButton } from "@/components/dashboard/plane-button";
import { t } from "@/lib/i18n";

export function useSeePlans() {
  const [, setParams] = useSearchParams();
  return () => setParams({ dashboard: "billing", date: undefined, view: undefined });
}

export function useAskToUpgrade() {
  const seePlans = useSeePlans();
  return (title: string) => toast(title, { action: { label: t("See plans"), onClick: seePlans } });
}

export function SeePlansButton() {
  const seePlans = useSeePlans();
  return (
    <PlaneButton variant="primary" size="lg" onClick={seePlans}>
      {t("See plans")}
    </PlaneButton>
  );
}
