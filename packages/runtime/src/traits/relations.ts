/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { relation } from 'koota';

/** Exclusive (re-parenting replaces the target); autoDestroy 'orphan' destroys the whole subtree. Children are told apart by tag traits; order is ItemIndex. */
export const ChildOf = relation({ exclusive: true, autoDestroy: 'orphan' });
