/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubUrl } from "./sentry-scrub";

describe("what goes to the error reports", () => {
  test.each([
    ["https://plan.video/connect/s3cret-link", "https://plan.video/connect/[id]"],
    ["https://plan.video/connect/s3cret-link?from=mail#top", "https://plan.video/connect/[id]"],
    ["/connect/s3cret-link", "/connect/[id]"],
    ["https://plan.video/p/s3cret-id", "https://plan.video/p/[id]"],
    ["https://plan.video/tiktok/callback?code=abc&state=xyz", "https://plan.video/tiktok/callback"],
    ["https://plan.video/auth/callback#access_token=abc", "https://plan.video/auth/callback"],
    ["https://files.test/posts/u/p1?X-Amz-Signature=abc", "https://files.test/posts/u/p1"],
    ["https://plan.video/dashboard", "https://plan.video/dashboard"],
    ["/projects/one", "/projects/one"],
    ["https://plan.video/app/connections", "https://plan.video/app/connections"],
  ])("%s", (url, kept) => expect(scrubUrl(url)).toBe(kept));

  test("an event loses the secrets in its page, referrer, frames and message", () => {
    const event = scrubEvent({
      request: {
        url: "https://plan.video/x/callback?code=abc&state=xyz",
        query_string: "code=abc&state=xyz",
        headers: { Referer: "https://plan.video/connect/s3cret-link", "User-Agent": "Chrome" },
      },
      exception: {
        values: [
          {
            value: "Failed to load https://plan.video/connect/s3cret-link?t=1",
            stacktrace: { frames: [{ filename: "https://plan.video/connect/s3cret-link?t=1", lineno: 1 }] },
          },
        ],
      },
      message: "Could not open https://plan.video/auth/confirm?token_hash=abc",
    });
    expect(JSON.stringify(event)).not.toMatch(/s3cret|abc|xyz/);
    expect(event.request?.headers?.["User-Agent"]).toBe("Chrome");
    expect(event.request?.url).toBe("https://plan.video/x/callback");
  });

  test("a console breadcrumb loses them from what was logged", () => {
    const crumb = scrubBreadcrumb({ message: "failed", data: { arguments: ["failed", "https://r2.test/a?X-Amz-Signature=secret", { url: "https://r2.test/b?token=secret" }, 7] } });
    expect(JSON.stringify(crumb)).not.toContain("secret");
    expect(crumb.data?.arguments).toContain("https://r2.test/a");
  });

  test("a breadcrumb loses them from where it went and what it fetched", () => {
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/connect/s3cret-link", to: "/x/callback?code=abc" } });
    expect(crumb.data).toEqual({ from: "/connect/[id]", to: "/x/callback" });
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "https://files.test/a?sig=abc", method: "PUT" } }).data).toEqual({ url: "https://files.test/a", method: "PUT" });
    expect(scrubBreadcrumb({ category: "console", message: "Opened https://plan.video/p/s3cret-id now" }).message).toBe("Opened https://plan.video/p/[id] now");
  });
});
