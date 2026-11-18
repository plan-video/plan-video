/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { policy } from "./content-security-policy";

const directive = (text: string, name: string) => text.split("; ").find((part) => part.startsWith(`${name} `));

describe("the page's security policy", () => {
  it("lets Turnstile's script and frame in once a site key is set, or sign-in refuses everyone", () => {
    const text = policy([], { VITE_TURNSTILE_SITE_KEY: "key" });
    expect(directive(text, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(text, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });

  it("allows no frames and no Turnstile without a key", () => {
    const text = policy([], {});
    expect(text).not.toContain("challenges.cloudflare.com");
    expect(directive(text, "frame-src")).toBe("frame-src 'none'");
  });
});
