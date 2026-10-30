/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ConstraintType } from "@plan.video/runtime";
import { HORIZONTAL_CONSTRAINTS, VERTICAL_CONSTRAINTS } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { HorizontalConstraint, VerticalConstraint } from "@plan.video/jsx";

export type Constraint = {
  key: ConstraintType;
  label: string;
};

export type AnchorPosition = {
  x: number;
  y: number;
  icon: string;
  tooltip: string;
};

export const anchorPositions: AnchorPosition[] = [
  { x: 0, y: 0, icon: 'anchor-align-top-left', tooltip: msg('Align top left') },
  { x: 0.5, y: 0, icon: 'anchor-align-top-center', tooltip: msg('Align top center') },
  { x: 1, y: 0, icon: 'anchor-align-top-right', tooltip: msg('Align top right') },
  { x: 0, y: 0.5, icon: 'anchor-align-left', tooltip: msg('Align left') },
  { x: 0.5, y: 0.5, icon: 'anchor-align-center', tooltip: msg('Align center') },
  { x: 1, y: 0.5, icon: 'anchor-align-right', tooltip: msg('Align right') },
  { x: 0, y: 1, icon: 'anchor-align-bottom-left', tooltip: msg('Align bottom left') },
  { x: 0.5, y: 1, icon: 'anchor-align-bottom-center', tooltip: msg('Align bottom center') },
  { x: 1, y: 1, icon: 'anchor-align-bottom-right', tooltip: msg('Align bottom right') },
];

export const horizontalConstraints: Constraint[] = [
  { key: ConstraintType.MIN, label: msg('Left') },
  { key: ConstraintType.MAX, label: msg('Right') },
  { key: ConstraintType.CENTER, label: msg('Center') },
  { key: ConstraintType.STRETCH, label: msg('Left & right') },
  { key: ConstraintType.SCALE, label: msg('Scale') },
];

export const verticalConstraints: Constraint[] = [
  { key: ConstraintType.MIN, label: msg('Top') },
  { key: ConstraintType.MAX, label: msg('Bottom') },
  { key: ConstraintType.CENTER, label: msg('Center') },
  { key: ConstraintType.STRETCH, label: msg('Top & bottom') },
  { key: ConstraintType.SCALE, label: msg('Scale') },
];

const HORIZONTAL_NAMES = new Map<ConstraintType, HorizontalConstraint>(
  Object.entries(HORIZONTAL_CONSTRAINTS).map(([name, type]) => [type, name as HorizontalConstraint]),
);

const VERTICAL_NAMES = new Map<ConstraintType, VerticalConstraint>(
  Object.entries(VERTICAL_CONSTRAINTS).map(([name, type]) => [type, name as VerticalConstraint]),
);

/** The anchor as the JSX spells it on the horizontal axis (`constrainX="right"`). */
export function horizontalConstraintName(type: ConstraintType): HorizontalConstraint {
  return HORIZONTAL_NAMES.get(type) ?? "left";
}

/** The same on the vertical axis (`constrainY="bottom"`). */
export function verticalConstraintName(type: ConstraintType): VerticalConstraint {
  return VERTICAL_NAMES.get(type) ?? "top";
}
