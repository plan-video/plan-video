/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@plan.video/koota-solid";
import { getDocumentEditor } from "../editor";

import type { DocumentEditor } from "../editor";

export function useEditor(): DocumentEditor {
  return getDocumentEditor(useWorld());
}
