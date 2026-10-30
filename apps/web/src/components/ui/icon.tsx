/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createSignal, onCleanup, Show, type Component, type JSX } from "solid-js";

import { cx } from "@/lib/cva";

// Loaded on demand. An eager glob compiles every icon before the first paint,
// including the ones only the editor uses.
const icons = import.meta.glob<{ default: Component<JSX.SvgSVGAttributes<SVGSVGElement>> }>(
  "/src/assets/icons/*.svg",
);

const cache = new Map<string, Component<JSX.SvgSVGAttributes<SVGSVGElement>>>();

type IconProps = {
  name: string;
  class?: string
}

export function Icon(props: IconProps) {
  const [graphic, setGraphic] = createSignal<Component<JSX.SvgSVGAttributes<SVGSVGElement>> | undefined>();

  createEffect(() => {
    const path = `/src/assets/icons/${props.name}.svg`;
    const load = icons[path];
    if (!load) {
      setGraphic(undefined);
      return;
    }

    const cached = cache.get(path);
    if (cached) {
      setGraphic(() => cached);
      return;
    }

    let current = true;
    onCleanup(() => {
      current = false;
    });
    // After a deploy an open tab can ask for an icon file that is gone. The
    // import then rejects, or resolves to nothing once app.tsx's preloadError
    // handler has taken over to reload the page: keep the blank space either way.
    load()
      .then((module) => {
        if (!module) return;
        cache.set(path, module.default);
        if (current) setGraphic(() => module.default);
      })
      .catch(() => {});
  });

  return (
    <Show
      when={graphic()}
      keyed
      fallback={<span class={cx("inline-block size-6 shrink-0", props.class)} aria-hidden="true" />}
    >
      {(Graphic) => <Graphic class={cx("size-6 shrink-0", props.class)} />}
    </Show>
  );
}
