/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, test } from "vitest";

import { authorizationIdFrom, onThisComputer } from "./oauth-consent-id";

test("the consent page takes only an id, never a path to somewhere else", () => {
  expect(authorizationIdFrom("?authorization_id=abc-DEF_123")).toBe("abc-DEF_123");
  expect(authorizationIdFrom("")).toBeNull();
  for (const bad of ["../../storage/v1/object/x", "a%2F..%2Fb", "a?b=c", "a#b", "a b", "x".repeat(300)]) {
    expect(authorizationIdFrom(`?authorization_id=${bad}`)).toBeNull();
  }
});

test("an app's own name is trusted only for an address that can't hand the answer to a website", () => {
  for (const local of ["http://localhost:3118/callback", "http://127.0.0.1/cb", "cursor://anysphere.cursor-mcp/oauth/callback", "vscode://vscode.github-authentication/did-authenticate"]) {
    expect(onThisComputer(new URL(local)), local).toBe(true);
  }
  for (const away of [
    "https://localhost/cb",
    "http://localhost.evil.test/cb",
    "intent://evil.test/cb#Intent;scheme=https;end",
    "x-safari-https://evil.test/cb",
    "googlechromes://evil.test/cb",
    "microsoft-edge-https://evil.test/cb",
    "firefox://open-url?url=https://evil.test/cb",
    "opera-https://evil.test/cb",
    "ftp://evil.test/cb",
    "wss://evil.test/cb",
    "mailto:someone@evil.test",
  ]) {
    expect(onThisComputer(new URL(away)), away).toBe(false);
  }
});
