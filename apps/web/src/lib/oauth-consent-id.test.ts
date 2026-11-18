/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, test } from "vitest";

import { authorizationIdFrom } from "./oauth-consent-id";

test("the consent page takes only an id, never a path to somewhere else", () => {
  expect(authorizationIdFrom("?authorization_id=abc-DEF_123")).toBe("abc-DEF_123");
  expect(authorizationIdFrom("")).toBeNull();
  for (const bad of ["../../storage/v1/object/x", "a%2F..%2Fb", "a?b=c", "a#b", "a b", "x".repeat(300)]) {
    expect(authorizationIdFrom(`?authorization_id=${bad}`)).toBeNull();
  }
});
