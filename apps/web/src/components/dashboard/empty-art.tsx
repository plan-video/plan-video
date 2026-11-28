/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { Dynamic } from "solid-js/web";
import BellCheckLucide from "lucide-solid/icons/bell-check";
import ScissorsLucide from "lucide-solid/icons/scissors";
import CalendarDaysLucide from "lucide-solid/icons/calendar-days";
import ChartLineLucide from "lucide-solid/icons/chart-line";
import ClapperboardLucide from "lucide-solid/icons/clapperboard";
import FolderLucide from "lucide-solid/icons/folder";
import ImagesLucide from "lucide-solid/icons/images";
import LayoutTemplateLucide from "lucide-solid/icons/layout-template";
import LockLucide from "lucide-solid/icons/lock";
import PlugLucide from "lucide-solid/icons/plug";
import TrashLucide from "lucide-solid/icons/trash";

import { cx } from "@/lib/cva";

import { PlaneIcon } from "./plane-icons";

type Glyph = typeof ClapperboardLucide;

const RINGS = [0, 1, 2].map((step) => ({ size: 63 + step * 36, radius: 16 + step * 8 }));

function Art(props: { icon: Glyph; class?: string }) {
  return (
    <div aria-hidden="true" class={cx("relative grid h-[120px] w-[200px] max-w-full shrink-0 place-items-center", props.class)}>
      <svg
        viewBox="0 0 200 200"
        fill="none"
        class="pointer-events-none absolute top-1/2 left-1/2 size-[200px] -translate-x-1/2 -translate-y-1/2 [mask-image:radial-gradient(closest-side,#000_30%,transparent)]"
      >
        <For each={RINGS}>
          {(ring) => (
            <rect
              x={(200 - ring.size) / 2}
              y={(200 - ring.size) / 2}
              width={ring.size}
              height={ring.size}
              rx={ring.radius}
              class="stroke-(--plane-border-subtle-1)"
            />
          )}
        </For>
      </svg>
      <div
        class="relative grid size-14 place-items-center rounded-2xl bg-(--plane-layer-2) text-(--plane-text-primary)"
        style={{ "box-shadow": "inset 0 1px 0 var(--depth-edge), 0 0 0 1px var(--plane-border-subtle-1), var(--depth-card)" }}
      >
        <Dynamic component={props.icon} class="size-[26px]" stroke-width={1.6} />
      </div>
    </div>
  );
}

export const ProjectsArt = (props: { class?: string }) => <Art icon={ClapperboardLucide} class={props.class} />;
export const ClipsArt = (props: { class?: string }) => <Art icon={ScissorsLucide} class={props.class} />;
export const FolderArt = (props: { class?: string }) => <Art icon={FolderLucide} class={props.class} />;
export const MediaArt = (props: { class?: string }) => <Art icon={ImagesLucide} class={props.class} />;
export const TemplatesArt = (props: { class?: string }) => <Art icon={LayoutTemplateLucide} class={props.class} />;
export const VaultArt = (props: { class?: string }) => <Art icon={LockLucide} class={props.class} />;
export const PlugsArt = (props: { class?: string }) => <Art icon={PlugLucide} class={props.class} />;
export const PostsArt = (props: { class?: string }) => <Art icon={CalendarDaysLucide} class={props.class} />;
export const InboxArt = (props: { class?: string }) => <Art icon={BellCheckLucide} class={props.class} />;
export const TrashArt = (props: { class?: string }) => <Art icon={TrashLucide} class={props.class} />;
const LayersGlyph = ((props: { class?: string }) => <PlaneIcon name="layers" class={props.class} />) as Glyph;

export const BulkArt = (props: { class?: string }) => <Art icon={LayersGlyph} class={props.class} />;
export const AnalyticsArt = (props: { class?: string }) => <Art icon={ChartLineLucide} class={props.class} />;
