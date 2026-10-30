/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

type DashboardSectionViewProps = {
  description: string;
};

export function DashboardSectionView(props: DashboardSectionViewProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-1 items-center justify-center px-6 pb-16">
        <p class="max-w-sm text-center text-sm text-muted-foreground">
          {props.description}
        </p>
      </div>
    </div>
  );
}
