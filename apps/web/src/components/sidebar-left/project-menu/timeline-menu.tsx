/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/i18n";

export function TimelineMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Scene settings...")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Captions")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineCaptionsMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Select nearest")}
          <DropdownMenuShortcut>⌃V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Select")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[236px]">
              <TimelineSelectMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Split at playhead")}
          <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Track")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineTrackMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Clip")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[212px]">
              <TimelineClipMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Audio")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineAudioMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Add marker")}
          <DropdownMenuShortcut>M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Mark in / clear in")}
          <DropdownMenuShortcut>I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Mark out / clear out")}
          <DropdownMenuShortcut>O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Clear all markers")}
          <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Add transition to both")}
          <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Add video transition")}
          <DropdownMenuShortcut>⌥T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Add audio transition")}
          <DropdownMenuShortcut>⇧T</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Toggle keyframes")}
          <DropdownMenuShortcut>U</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineSelectMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Select videos")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Select audio")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Select texts")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Select images")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Select captions")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Select forward on track")}
          <DropdownMenuShortcut>Y</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Select forward on all tracks")}
          <DropdownMenuShortcut>⌥Y</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Select backward on track")}
          <DropdownMenuShortcut>⌘Y</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Select backward on all tracks")}
          <DropdownMenuShortcut>⌥⌘Y</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Select next")}
          <DropdownMenuShortcut>⌥⌘→</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Select previous")}
          <DropdownMenuShortcut>⌥⌘←</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Select above")}
          <DropdownMenuShortcut>⌥⌘↓</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Select below")}
          <DropdownMenuShortcut>⌥⌘↑</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineCaptionsMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Generate captions...")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Change caption preset...")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Change caption language...")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Export captions...")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineClipMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Change clip speed")}
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>{t("Reset clip speed")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Enable/disable clip")}
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineTrackMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Enable/disable track")}
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>{t("Mute/unmute track")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Toggle track solo")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Toggle magnetic track")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineAudioMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Mute/unmute audio")}
          <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Increase audio by 1 dB")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Decrease audio by 1 dB")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Increase audio by 3 dB")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Decrease audio by 3 dB")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
