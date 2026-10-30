/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { children, type JSX } from "solid-js";

export function capCentered(content: () => JSX.Element): () => JSX.Element {
  const resolved = children(content);
  return () => {
    const out: JSX.Element[] = [];
    let run = "";
    const flush = () => {
      if (run.trim()) out.push(<span class="cap-centered">{run}</span>);
      else if (run) out.push(run);
      run = "";
    };
    for (const node of resolved.toArray()) {
      if (typeof node === "string" || typeof node === "number") run += node;
      else {
        flush();
        out.push(node);
      }
    }
    flush();
    return out;
  };
}

export function CapLabel(props: { children: JSX.Element }) {
  const label = capCentered(() => props.children);
  return <>{label()}</>;
}
