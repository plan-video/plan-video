/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";

vi.mock("somoto", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(() => 1), dismiss: vi.fn() }) }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false }));

import { toast } from "somoto";
import { downloadDriveFiles, driveMimeTypes, type DriveFile } from "./google-drive";

const drive = (id: string, size = 10): DriveFile => ({ id, name: `${id}.mp4`, mimeType: "video/mp4", size, modified: 1_700_000_000_000 });

describe("files picked in Google Drive", () => {
  it("keeps the ones that came down when another fails, and says which failed", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes("/broken?") ? new Response("", { status: 404 }) : new Response(new Blob(["video"], { type: "video/mp4" })),
    );
    const files = await downloadDriveFiles([drive("a"), drive("broken"), drive("b")], "token", undefined, fetcher as typeof fetch);
    expect(files.map((file) => file.name)).toEqual(["a.mp4", "b.mp4"]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer token" } });
    expect(vi.mocked(toast.error).mock.calls.at(-1)![1]).toMatchObject({ description: "broken.mp4" });
  });

  it("never downloads a file that's too large", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["video"])));
    const files = await downloadDriveFiles([drive("huge", 900e6), drive("small")], "token", (file) => (file.size > 500e6 ? "too large" : null), fetcher as typeof fetch);
    expect(files.map((file) => file.name)).toEqual(["small.mp4"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps Drive's edit time, so picking the same file twice finds it in the library", async () => {
    const [file] = await downloadDriveFiles([drive("a")], "token", undefined, (async () => new Response(new Blob(["video"]))) as typeof fetch);
    expect(file!.lastModified).toBe(1_700_000_000_000);
  });

  it("asks the Picker for exact types, as it takes no wildcards", () => {
    expect(driveMimeTypes("video/mp4,video/quicktime,.mp4,.mov,image/jpeg")).toBe("video/mp4,video/quicktime,image/jpeg");
    expect(driveMimeTypes("image/*,video/mp4")).toBe("image/jpeg,image/png,image/gif,image/webp,video/mp4");
  });
});
