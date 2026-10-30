/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The site's CSP refuses zod's `new Function` probe and reports each try as a
// violation, so jit is turned off up front. index.tsx must import this first.

import { config } from "zod/v4/core";

config({ jitless: true });
