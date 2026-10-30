/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onCleanup, onMount, type JSX } from "solid-js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { editCommands, isTextTarget, type EditCommands } from "@/lib/edit-commands"
import { t } from "@/lib/i18n"

export function AppContextMenu(props: { children: JSX.Element }) {
  // What was right-clicked: a text field keeps the browser's editing, anything
  // else gets the editor's.
  let target: EventTarget | null = null
  onMount(() => {
    const remember = (event: MouseEvent) => {
      target = event.target
    }
    window.addEventListener("contextmenu", remember, true)
    onCleanup(() => window.removeEventListener("contextmenu", remember, true))
  })

  const run = (command: keyof EditCommands, fallback: () => void) => () => {
    const commands = editCommands()
    if (commands && !isTextTarget(target)) commands[command]()
    else fallback()
  }

  const handleUndo = run("undo", () => document.execCommand("undo"))
  const handleRedo = run("redo", () => document.execCommand("redo"))
  const handleCut = run("cut", () => document.execCommand("cut"))
  const handleCopy = run("copy", () => document.execCommand("copy"))
  const handlePaste = run("paste", async () => {
    try {
      const text = await navigator.clipboard.readText()
      document.execCommand("insertText", false, text)
    } catch {
      document.execCommand("paste")
    }
  })
  const handleSelectAll = run("selectAll", () => document.execCommand("selectAll"))

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  const handleReload = () => {
    window.location.reload()
  }


  return (
    <ContextMenu>
      <ContextMenuTrigger class="contents">
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[200px]">
          <ContextMenuItem onSelect={handleUndo}>
            {t("Undo")}
            <ContextMenuShortcut>⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRedo}>
            {t("Redo")}
            <ContextMenuShortcut>⇧⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCut}>
            {t("Cut")}
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            {t("Copy")}
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handlePaste}>
            {t("Paste")}
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleSelectAll}>
            {t("Select All")}
            <ContextMenuShortcut>⌘A</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleFullscreen}>
            {document.fullscreenElement ? t("Exit Fullscreen") : t("Fullscreen")}
            <ContextMenuShortcut>F11</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleReload}>
            {t("Reload")}
            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  )
}
