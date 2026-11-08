/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, test, vi } from "vitest";

vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));
vi.mock("@/lib/guest", () => ({ ownerOf: (id?: string) => id }));
vi.mock("@/lib/workspaces", () => ({ workspaceKey: (key: string) => key }));

const { readStyle } = await import("./caption-brand");

const node = (tag: string, children: unknown[] = []) => ({ tag, props: {}, children });

test("a saved caption style keeps only real layers, however deep a bad one hides", () => {
  const style = readStyle({ id: "brand", props: {}, children: [node("text"), node('img src=x onerror="alert(1)"'), node("group", [node("<script>")]), "text", null, { tag: "text", children: [] }] });
  expect(style?.children.map((child) => child.tag)).toEqual(["text"]);
});
