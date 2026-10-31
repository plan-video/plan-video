/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { quoteWindowsArg } from "../src/host/env";

describe("quoteWindowsArg", () => {
  it.each([
    ["app-server", "app-server"],
    ["C:\\Tools\\codex.cmd", "C:\\Tools\\codex.cmd"],
    ["two words", '"two words"'],
    ['mcp_servers.planvideo.url="http://127.0.0.1:4000/mcp"', '"mcp_servers.planvideo.url=\\"http://127.0.0.1:4000/mcp\\""'],
    ["C:\\My Folder\\", '"C:\\My Folder\\\\"'],
    ['say \\"hi\\"', '"say \\\\\\"hi\\\\\\""'],
  ])("%s", (arg, quoted) => {
    expect(quoteWindowsArg(arg)).toBe(quoted);
  });
});
