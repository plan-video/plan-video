/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from "solid-js";
import SparklesLucide from "lucide-solid/icons/sparkles";

import { cx } from "@/lib/cva";

export type RailIconProps = { class?: string };

function railIcon(glyph: () => JSX.Element) {
  return (props: RailIconProps) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cx("size-[18px] shrink-0", props.class)}
      aria-hidden="true"
    >
      {glyph()}
    </svg>
  );
}

const SOLID = { fill: "currentColor", stroke: "none" };

export const RailFolderIcon = railIcon(() => (
  <>
    <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
    <circle cx="8.8" cy="8.8" r="1.7" {...SOLID} />
    <path d="M4 17.4 9 12.6a1.5 1.5 0 0 1 2.1 0l1.5 1.5 1.8-1.8a1.5 1.5 0 0 1 2.1 0l3.5 3.4V20H4Z" {...SOLID} />
  </>
));

export const RailTextIcon = railIcon(() => (
  <>
    <path d="M2.8 19.4 7.8 4.6l5 14.8M4.8 14.6h6" />
    <ellipse cx="18" cy="15.3" rx="3" ry="4" />
    <path d="M21 11.3v8.1" />
  </>
));

export const RailCaptionsIcon = railIcon(() => (
  <>
    <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="4.4" />
    <path d="M10.9 10.2a2.4 2.4 0 1 0 0 3.6M17.1 10.2a2.4 2.4 0 1 0 0 3.6" />
  </>
));

export const RailTransitionsIcon = railIcon(() => (
  <path d="M12 12 6.6 5.7C5.4 4.6 3.4 5.5 3.4 7.2v9.6c0 1.7 2 2.6 3.2 1.5L12 12l5.4-6.3c1.2-1.1 3.2-.2 3.2 1.5v9.6c0 1.7-2 2.6-3.2 1.5Z" />
));

export const RailEffectsIcon = (props: RailIconProps) => (
  <SparklesLucide class={cx("size-[18px] shrink-0", props.class)} stroke-width={2.2} aria-hidden="true" />
);

export const RailTemplatesIcon = railIcon(() => (
  <>
    <rect x="3" y="3" width="18" height="7" rx="2.4" {...SOLID} />
    <rect x="3" y="12.5" width="7.5" height="8.5" rx="2.4" {...SOLID} />
    <rect x="13" y="12.5" width="8" height="8.5" rx="2.4" {...SOLID} />
  </>
));

export const RailExtensionsIcon = railIcon(() => (
  <path
    d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"
  />
));

export const RailWorkflowsIcon = railIcon(() => (
  <>
    <rect x="3" y="3" width="8" height="8" rx="2.4" {...SOLID} />
    <rect x="13" y="13" width="8" height="8" rx="2.4" {...SOLID} />
    <path d="M7 10v4.5a2.5 2.5 0 0 0 2.5 2.5H14" />
  </>
));

export const RailPanelIcon = railIcon(() => (
  <>
    <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
    <path d="M9.6 3.2H8.2a5 5 0 0 0-5 5v7.6a5 5 0 0 0 5 5h1.4Z" {...SOLID} />
  </>
));

export const RailCustomizeIcon = railIcon(() => (
  <>
    <rect x="3" y="3" width="8" height="10.5" rx="2.4" {...SOLID} />
    <rect x="13" y="3" width="8" height="6" rx="2.4" {...SOLID} />
    <rect x="13" y="11" width="8" height="10" rx="2.4" {...SOLID} />
    <rect x="3" y="15.5" width="8" height="5.5" rx="2.4" {...SOLID} />
  </>
));

export const ToolMoveIcon = railIcon(() => (
  <path
    d="M4.4 5.1a.6.6 0 0 1 .7-.7l14.6 5.9a.6.6 0 0 1-.05 1.13l-5.6 1.6a1.6 1.6 0 0 0-1.1 1.1l-1.6 5.6a.6.6 0 0 1-1.13.05Z"
    fill="currentColor"
  />
));

export const ToolSplitIcon = railIcon(() => (
  <>
    <circle cx="6.2" cy="6.2" r="2.9" />
    <circle cx="6.2" cy="17.8" r="2.9" />
    <path d="M8.3 8.3 12 12M20 4 8.3 15.7M14.8 14.8 20 20" />
  </>
));

export const ToolHandIcon = railIcon(() => (
  <>
    <path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </>
));

export const ToolFrameIcon = railIcon(() => <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />);

export const ToolRectangleIcon = railIcon(() => <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.6" />);

export const ToolTextIcon = railIcon(() => <path d="M4.6 5.2h14.8M12 5.2v14" />);

export const ToolOptionsIcon = railIcon(() => (
  <>
    <path d="M3.5 7h4M13 7h7.5M3.5 17H11M19.5 17h1" />
    <circle cx="10" cy="7" r="3" {...SOLID} />
    <circle cx="16.5" cy="17" r="3" {...SOLID} />
  </>
));

export const ToolUndoIcon = railIcon(() => (
  <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
));

export const ToolRedoIcon = railIcon(() => (
  <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
));
