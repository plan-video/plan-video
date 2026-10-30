/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import type { SceneNode as AuthoredSceneNode } from '@plan.video/jsx';

export type DomNode = Element | Text;

/** `parent` and `children` hold text and element nodes in insertion order: what the document answers `getFirstChild` and `getNextSibling` from. */
export type SceneNode = AuthoredSceneNode<DomNode>;

/** The one object the document and renderer both hold, so `===` means what it says. AoS like the other handles; never serialized. */
export const Host = trait(() => null as SceneNode | null);
