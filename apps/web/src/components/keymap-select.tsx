/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { KEYMAPS, keymapId, setKeymap } from "@/lib/keymap";

type Keymap = (typeof KEYMAPS)[number];

export function KeymapSelect() {
  return (
    <Select<Keymap>
      class="w-40 shrink-0"
      options={[...KEYMAPS]}
      value={KEYMAPS.find((keymap) => keymap.id === keymapId())}
      onChange={(keymap) => keymap && setKeymap(keymap.id)}
      optionValue="id"
      optionTextValue="name"
      gutter={4}
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue.name}</SelectItem>}
    >
      <SelectTrigger aria-label={t("Same keys as")} class="border border-(--border-input) focus-ring">
        <SelectValue<Keymap>>{(state) => state.selectedOption()?.name}</SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent />
      </SelectPortal>
    </Select>
  );
}
