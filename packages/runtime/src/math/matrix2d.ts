/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Mat2D's { a, b, c, d, e, f } match CanvasRenderingContext2D / DOMMatrix: [a c e; b d f; 0 0 1].

import { degToRad } from './common';

export type Mat2D = {
	a: number; b: number; c: number;
	d: number; e: number; f: number;
};

export function identity2D(): Mat2D {
	return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** T(pos+pivot) · R(rot) · SkewX · SkewY · S(scale) · T(-pivot). Angles in degrees; pivot in pixels (anchor × size). */
export function compose2D(
	x: number,
	y: number,
	rotation: number,
	scaleX: number,
	scaleY: number,
	pivotX: number,
	pivotY: number,
	skewX: number,
	skewY: number,
): Mat2D {
	const rot = degToRad(rotation);
	const skx = degToRad(skewX);
	const sky = degToRad(skewY);

	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const tanSkewX = Math.tan(skx);
	const tanSkewY = Math.tan(sky);

	// SkewX · SkewY · Scale  (pre-rotation matrix)
	const a1 = scaleX * (1 + tanSkewX * tanSkewY);
	const b1 = tanSkewY * scaleX;
	const c1 = tanSkewX * scaleY;
	const d1 = scaleY;

	// R(rot) · [a1 c1; b1 d1]
	const a = cos * a1 - sin * b1;
	const b = sin * a1 + cos * b1;
	const c = cos * c1 - sin * d1;
	const d = sin * c1 + cos * d1;

	// T(pos+pivot) · M · T(-pivot)
	const tx = x + pivotX;
	const ty = y + pivotY;
	const e = tx + a * (-pivotX) + c * (-pivotY);
	const f = ty + b * (-pivotX) + d * (-pivotY);

	return { a, b, c, d, e, f };
}

/** result = p × q. */
export function multiply2D(p: Mat2D, q: Mat2D): Mat2D {
	return {
		a: p.a * q.a + p.c * q.b,
		b: p.b * q.a + p.d * q.b,
		c: p.a * q.c + p.c * q.d,
		d: p.b * q.c + p.d * q.d,
		e: p.e + p.a * q.e + p.c * q.f,
		f: p.f + p.b * q.e + p.d * q.f,
	};
}

export function translate2D(tx: number, ty: number): Mat2D {
	return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** Degrees. */
export function rotate2D(degrees: number): Mat2D {
	const r = degToRad(degrees);
	const cos = Math.cos(r);
	const sin = Math.sin(r);
	return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function scale2D(sx: number, sy: number): Mat2D {
	return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Degrees. */
export function skew2D(degreesX: number, degreesY: number): Mat2D {
	const tx = Math.tan(degToRad(degreesX));
	const ty = Math.tan(degToRad(degreesY));
	return { a: 1, b: ty, c: tx, d: 1, e: 0, f: 0 };
}

export type Decomposed2D = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number; // degrees
  skewY: number; // degrees
};

const EPS = 1e-12;

/** Column-based QR decomposition: column 0 is (a, b), column 1 is (c, d). */
export function decompose2D(m: Mat2D): Decomposed2D {
  const { a, b, c, d, e, f } = m;

  const x = e;
  const y = f;

  let scaleX = Math.hypot(a, b);

  if (scaleX < EPS) {
    // Fall back: treat column 0 as zero, get scaleY from column 1.
    const scaleY = Math.hypot(c, d);
    return {
      x,
      y,
      rotation: 0,
      scaleX: 0,
      scaleY,
      skewX: 0,
      skewY: 0,
    };
  }

  const r0x = a / scaleX;
  const r0y = b / scaleX;

  // "Shear" factor: dot of normalized column 0 with column 1.
  let shear = r0x * c + r0y * d;

  let c2 = c - r0x * shear;
  let d2 = d - r0y * shear;

  let scaleY = Math.hypot(c2, d2);

  if (scaleY < EPS) {
    const rotationRad = Math.atan2(r0y, r0x);
    return {
      x,
      y,
      rotation: rotationRad * 180 / Math.PI,
      scaleX,
      scaleY: 0,
      skewX: 0,
      skewY: 0,
    };
  }

  // Normalize shear to get the actual shear value in "tan(angle)" space.
  shear /= scaleY;

  // Detect reflection (negative determinant) and fold it into scaleY by convention.
  const det = a * d - b * c;
  if (det < 0) {
    scaleY = -scaleY;
    shear = -shear;
    c2 = -c2;
    d2 = -d2;
  }

  const rotationRad = Math.atan2(r0y, r0x);
  const rotation = rotationRad * 180 / Math.PI;

  const skewX = Math.atan(shear) * 180 / Math.PI;
  const skewY = 0;

  return {
    x,
    y,
    rotation,
    scaleX,
    scaleY,
    skewX,
    skewY,
  };
}
