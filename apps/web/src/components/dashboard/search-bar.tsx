/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, type Accessor, type JSX } from "solid-js";

import { DashboardFilterCount, DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";

type DashboardSearchPanelProps = {
  value: Accessor<string>;
  onChange: (value: string) => void;
  placeholder: string;
  action?: JSX.Element;
  shown?: number;
  total?: number;
  empty?: boolean;
  children: JSX.Element;
};

export function DashboardSearchPanel(props: DashboardSearchPanelProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardPageHeader>
        <Show when={!props.empty}>
          <DashboardFilterCount shown={props.shown ?? 0} total={props.total ?? 0} />
          <DashboardHeaderSearch value={props.value()} placeholder={props.placeholder} onInput={props.onChange} />
          {props.action}
        </Show>
      </DashboardPageHeader>
      {props.children}
    </div>
  );
}
