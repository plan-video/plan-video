/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

// Tailwind's `md`: keep it matching the `max-md:` classes that lay the dashboard out for phones.
const query = window.matchMedia("(max-width: 767px)");
const [phone, setPhone] = createSignal(query.matches);
query.addEventListener("change", (event) => setPhone(event.matches));

export const isPhone = phone;
