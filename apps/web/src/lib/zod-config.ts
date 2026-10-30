/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// zod compiles its object schemas with `new Function` where the page allows
// it, and tries one to find out. The website's Content-Security-Policy
// refuses it, and reports each try as a violation, so zod is told up front.
// index.tsx imports this first, before anything parses.

import { config } from "zod/v4/core";

config({ jitless: true });
