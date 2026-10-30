/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The dashboard draws its glyphs from one set: Plane's icons and lucide, the
// way PlaneIcon does. This keeps the editor icon's API and its footprint, so a
// screen can switch to it without anything moving: the box stays the size its
// class gives it, and the glyph inside is drawn at the weight of the
// dashboard's own icons. Brand marks have no stand-in and stay as they are.

import { Dynamic } from "solid-js/web";
import { Show, type Component, type JSX } from "solid-js";
import ActivityLucide from "lucide-solid/icons/activity";
import ArrowUpLucide from "lucide-solid/icons/arrow-up";
import BellLucide from "lucide-solid/icons/bell";
import BoldLucide from "lucide-solid/icons/bold";
import CameraLucide from "lucide-solid/icons/camera";
import CircleCheckLucide from "lucide-solid/icons/circle-check";
import ClapperboardLucide from "lucide-solid/icons/clapperboard";
import CloudLucide from "lucide-solid/icons/cloud";
import CopyLucide from "lucide-solid/icons/copy";
import DownloadLucide from "lucide-solid/icons/download";
import EllipsisLucide from "lucide-solid/icons/ellipsis";
import ExternalLinkLucide from "lucide-solid/icons/external-link";
import EyeLucide from "lucide-solid/icons/eye";
import FileTextLucide from "lucide-solid/icons/file-text";
import FolderLucide from "lucide-solid/icons/folder";
import GlobeLucide from "lucide-solid/icons/globe";
import HashLucide from "lucide-solid/icons/hash";
import ImageLucide from "lucide-solid/icons/image";
import ImagesLucide from "lucide-solid/icons/images";
import ItalicLucide from "lucide-solid/icons/italic";
import KeyboardLucide from "lucide-solid/icons/keyboard";
import LaptopLucide from "lucide-solid/icons/laptop";
import LayoutGridLucide from "lucide-solid/icons/layout-grid";
import ListLucide from "lucide-solid/icons/list";
import LoaderCircleLucide from "lucide-solid/icons/loader-circle";
import MailLucide from "lucide-solid/icons/mail";
import MessageCircleLucide from "lucide-solid/icons/message-circle";
import PauseLucide from "lucide-solid/icons/pause";
import PlayLucide from "lucide-solid/icons/play";
import RepeatLucide from "lucide-solid/icons/repeat";
import RepeatOffLucide from "lucide-solid/icons/repeat-off";
import SignatureLucide from "lucide-solid/icons/signature";
import SmilePlusLucide from "lucide-solid/icons/face-slightly-smiling-plus";
import SquareTerminalLucide from "lucide-solid/icons/square-terminal";
import StarLucide from "lucide-solid/icons/star";
import TriangleAlertLucide from "lucide-solid/icons/triangle-alert";
import TypeLucide from "lucide-solid/icons/type";
import VideoLucide from "lucide-solid/icons/video";

import { Icon as EditorIcon } from "@/components/ui/icon";
import { cx } from "@/lib/cva";

import { PlaneIcon, type PlaneIconName } from "./plane-icons";

type Glyph = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** Editor icon names that Plane's set already draws. */
const PLANE: Record<string, PlaneIconName> = {
  "ai-mcp-cli": "ai",
  analytics: "analytics",
  billing: "credit-card",
  calendar: "calendar",
  "chevron-down": "chevron-down",
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right",
  clock: "clock",
  "close-remove": "close",
  "close-remove-small": "close",
  "confirm-check": "check",
  "project-file": "project",
  help: "help",
  home: "home",
  info: "info",
  layers: "layers",
  link: "link",
  "plus-add": "plus",
  "plus-add-small": "plus",
  search: "search",
  settings: "settings",
  trash: "trash",
  upgrade: "upgrade",
  user: "user-circle",
  // The Vault page's own icon in the sidebar.
  vault: "lock",
};

/** The rest, drawn with lucide like the dashboard's other lucide icons. */
const LUCIDE: Record<string, Glyph> = {
  "alert-warning": TriangleAlertLucide,
  "all-media-types": ImagesLucide,
  "arrow-top": ArrowUpLucide,
  "ask-chat": MessageCircleLucide,
  bell: BellLucide,
  bold: BoldLucide,
  "circle-check": CircleCheckLucide,
  clipboard: CopyLucide,
  cloud: CloudLucide,
  "controls-export-current-frame-camera": CameraLucide,
  "dapi-cli": SquareTerminalLucide,
  document: FileTextLucide,
  download: DownloadLucide,
  "edit-video": ClapperboardLucide,
  email: MailLucide,
  emoji: SmilePlusLucide,
  "external-link": ExternalLinkLucide,
  "eye-on": EyeLucide,
  favorite: StarLucide,
  favorited: StarLucide,
  globe: GlobeLucide,
  hashtag: HashLucide,
  image: ImageLucide,
  italic: ItalicLucide,
  "keyboard-shortcut": KeyboardLucide,
  list: ListLucide,
  loop: RepeatLucide,
  "mac-device": LaptopLucide,
  "more-three-dots-small-horizontal": EllipsisLucide,
  motion: ActivityLucide,
  "navigation.folder": FolderLucide,
  "no-loop": RepeatOffLucide,
  pause: PauseLucide,
  play: PlayLucide,
  signature: SignatureLucide,
  "spinner-loader": LoaderCircleLucide,
  text: TypeLucide,
  video: VideoLucide,
  "view.grid": LayoutGridLucide,
};

/** Filled versions of an outline, like a starred item. */
const FILLED = new Set(["favorited"]);

// The editor's glyphs sit small in a padded box; the dashboard's fill about
// this much of it, so a box of the same size reads at the dashboard's weight.
// `text-current` keeps the color from the box, and keeps parents' `[&_svg]`
// color rules off the glyph, as they were off the editor's icon.
const GLYPH = "size-[70%] text-current";

/** The editor icon's API, drawn from the dashboard's set. */
export function Icon(props: { name: string; class?: string }) {
  const plane = () => PLANE[props.name];
  const lucide = () => LUCIDE[props.name];

  return (
    <Show when={plane() || lucide()} fallback={<EditorIcon name={props.name} class={props.class} />}>
      <span aria-hidden="true" class={cx("inline-grid size-6 shrink-0 place-items-center", props.class)}>
        <Show
          when={plane()}
          fallback={<Dynamic component={lucide()} class={GLYPH} fill={FILLED.has(props.name) ? "currentColor" : "none"} aria-hidden="true" />}
        >
          {(name) => <PlaneIcon name={name()} class={GLYPH} />}
        </Show>
      </span>
    </Show>
  );
}
