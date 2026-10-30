/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which extension is open, kept apart from the registry: panels open one
// another (the asset menu opens Remove background), and importing the
// registry from a panel would load every panel in a loop.

import { createSignal } from "solid-js";

export const CUTOUT_EXTENSION = "remove-background";

const [openId, setOpenId] = createSignal<string | null>(null);

/** The open extension's id, or null while the market shows. */
export const openExtensionId = openId;

export const setOpenExtension = (id: string | null) => setOpenId(id);
