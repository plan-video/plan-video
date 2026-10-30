/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Quad } from '@plan.video/runtime';

/**
 * Whether two quads share any area. Both are transformed rects, so convex:
 * they overlap unless one of their edges' normals separates them. Unlike the
 * runtime's corner check (`quadsIntersect`), this also catches two that cross
 * without either holding a corner of the other, such as a thin marquee drawn
 * across a scene.
 */
export function quadsOverlap(a: Quad, b: Quad): boolean {
	for (const quad of [a, b]) {
		for (let i = 0; i < 4; i++) {
			const p = quad[i]!;
			const q = quad[(i + 1) % 4]!;
			const nx = q.y - p.y;
			const ny = p.x - q.x;
			const project = (points: Quad) => points.map((point) => point.x * nx + point.y * ny);
			const pa = project(a);
			const pb = project(b);
			if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
		}
	}
	return true;
}
