/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, type Accessor, type JSX } from "solid-js";

import { DashboardFilterCount, DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";

type DashboardSearchPanelProps = {
  value: Accessor<string>;
  onChange: (value: string) => void;
  placeholder: string;
  /** The page's buttons, after the search. */
  action?: JSX.Element;
  /** How many the search leaves of how many, while it leaves out some. */
  shown?: number;
  total?: number;
  /** Nothing to search yet: the header holds only the page's name, and the page's picture says the rest. */
  empty?: boolean;
  children: JSX.Element;
};

/** A page whose header holds a search field and its buttons, like Projects and Trash. */
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
