/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/sonner

import { useColorMode } from "@kobalte/core"
import { Toaster as Sonner } from "somoto"
import { t } from "@/lib/i18n"
import { Icon } from "./icon"

export const Toaster = (props: Parameters<typeof Sonner>[0]) => {
  const { colorMode } = useColorMode()

  return (
    <Sonner
      position="top-center"
      theme={colorMode()}
      
      icons={{
        success: <Icon name="circle-check" class="size-7 -m-1! text-emerald-400" />,
        info: <Icon name="info" class="size-7 -m-1! text-primary" />,
        warning: <Icon name="alert-warning" class="size-7 -m-1! text-amber-400" />,
        error: <Icon name="ban" class="size-7 -m-1! text-destructive" />,
        loading: <Icon name="spinner-loader" class="size-7 -m-1! animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        unstyled: true,
        // somoto's own styles are unlayered, so they beat Tailwind's layered utilities: overrides of them need `!`.
        classNames: {
          toast:
            "flex w-[356px] items-center gap-2.5 rounded-xl border border-border-strong bg-popover p-3 text-popover-foreground data-[expanded=false]:data-[front=false]:*:opacity-0",
          title: "text-xs font-medium! leading-5!",
          description: "text-xs leading-4! text-muted-foreground!",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          icon: "m-0! size-5! shrink-0 justify-center!",
          actionButton: "press ml-1 h-7 shrink-0 rounded-md bg-secondary px-2.5 text-xs text-foreground shadow-(--button-secondary-shadow) hover:bg-secondary-hover active:bg-secondary-pressing outline-none focus-ring",
        },
      }}
      containerAriaLabel={t("Notifications")}
      {...props}
    />
  )
}
