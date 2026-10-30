/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export interface OutputSize {
	width: number;
	height: number;
	scale: number;
}

/** The one rounding the video encoder, the image encoder and the UI share, so what is shown is what is encoded. */
export function scaleSize(sceneWidth: number, sceneHeight: number, scale: number): OutputSize {
	return {
		scale,
		width: Math.round(sceneWidth * scale / 2) * 2,
		height: Math.round(sceneHeight * scale / 2) * 2,
	};
}

/** `resolution` names the output's shorter side (a vertical video's width): at 1080 a 3840×1620 scene exports at 2560×1080. Without one the scene exports at its own size. */
export function computeOutputSize(
	sceneWidth: number,
	sceneHeight: number,
	resolution?: number,
): OutputSize {
	const shortSide = Math.min(sceneWidth, sceneHeight);
	const scale = Math.round((resolution ?? shortSide) * 1e6 / shortSide) / 1e6;
	return scaleSize(sceneWidth, sceneHeight, scale);
}

export function createRenderEventDetail(progress: number, total: number, startTime: number) {
  const duration = performance.now() - startTime;
  const time = (duration / gte1(progress)) * (total - progress);
  const remaining = new Date(time);

  return { remaining, progress, total };
}

function gte1(num: number): number {
  if (num < 1) return 1;
  return num;
}
