/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { SOURCE_ATTR } from "@plan.video/jsx";
import { createRuntimeDocument } from "@plan.video/reconciler";
import { createRuntimeWorld } from "@plan.video/runtime";

import { Unsaved } from "@/engine/traits";

import type { SceneNode } from "@plan.video/runtime";

vi.mock("./browser-store", () => ({ readText: vi.fn(), replaceText: vi.fn(), writeText: vi.fn() }));
// The runtime tells hosts apart by `instanceof`; there is no DOM here.
for (const name of ["Element", "HTMLElement", "HTMLCanvasElement", "HTMLImageElement", "HTMLVideoElement"]) vi.stubGlobal(name, class {});

const { browserCompositionText } = await import("./composition");

type Saved = { source: string; children: Saved[] };

function stage() {
  const world = createRuntimeWorld("composition");
  const document = createRuntimeDocument(world);
  const add = (parent: SceneNode, tag: string, source: string) => {
    const node = document.createElement(tag) as SceneNode;
    document.setProperty(node, SOURCE_ATTR, source);
    document.insertNode(parent, node);
    return node;
  };
  const scene = add(document.stage, "Scene", "index.tsx:s1");
  add(scene, "Rect", "index.tsx:s2");
  const sample = add(scene, "Rect", "tour-sample:1");
  return { world, sample: sample.entity };
}

const sources = (text: string | null): string[] => {
  const walk = (nodes: Saved[]): string[] => nodes.flatMap((node) => [node.source, ...walk(node.children)]);
  return text ? walk((JSON.parse(text) as { children: Saved[] }).children) : [];
};

describe("the saved composition", () => {
  it("holds every element on the stage", () => {
    const { world } = stage();
    expect(sources(browserCompositionText(world))).toEqual(["index.tsx:s1", "index.tsx:s2", "tour-sample:1"]);
  });

  it("leaves out an element marked unsaved", () => {
    const { world, sample } = stage();
    sample.add(Unsaved);
    expect(sources(browserCompositionText(world))).toEqual(["index.tsx:s1", "index.tsx:s2"]);
  });
});
