/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Hovering } from '@plan.video/runtime';

import type { Entity, World } from 'koota';

// Clears whatever held the hover rather than each row undoing its own: the pointer can leave a row without a
// leave event (a row scrolled out from under it, or removed). Hover is not authored, so it goes straight to the trait.
export function setRowHover(world: World, entity: Entity | null): void {
  for (const hovered of world.query(Hovering)) {
    if (hovered !== entity) hovered.remove(Hovering);
  }

  if (entity?.isAlive() && !entity.has(Hovering)) entity.add(Hovering);
}
