/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { VideoSampleSink } from "mediabunny";
import tgpu, { d, std } from "typegpu";
import { assert } from "@/utils";

import type { InputVideoTrack } from "mediabunny";

// Triage scan rate; 2fps is enough to understand footage.
const SCAN_FPS = 2;

// Block luma averages are computed on the GPU so no full frame is ever read back.
const GRID = 32;
const DIM = GRID * GRID;
const TAPS = 8; // bilinear taps per block axis; approximates a box filter

// Distance = fraction of changed blocks: deltas under the deadzone are encoder noise, past
// saturation a full change. Block-wise so a small local change isn't averaged away.
const DEADZONE = 0.02;
const SATURATION = 0.1;

// Keep a sample only when it differs from the last kept one by about two blocks.
const THRESHOLD = 2 / DIM;

// Adjacent samples farther apart than this are mid-transition; wait for it to settle so frames are sharp.
const MOTION_EPS = 2 / DIM;

// Footage that never settles still yields its calmest sample per run of this many seconds.
const MAX_UNSETTLED = 4;

const fingerprintLayout = tgpu.bindGroupLayout({
  samp: { sampler: "filtering" },
  frame: { externalTexture: d.textureExternal() },
  blocks: { storage: d.arrayOf(d.f32), access: "mutable" },
});

const fingerprintFn = tgpu.computeFn({
  workgroupSize: [8, 8],
  in: { id: d.builtin.globalInvocationId },
})((input) => {
  "use gpu";
  let sum = d.f32(0);
  for (let y = d.u32(0); y < TAPS; y++) {
    for (let x = d.u32(0); x < TAPS; x++) {
      const uv = std.div(
        std.add(d.vec2f(input.id.xy), std.div(std.add(d.vec2f(x, y), 0.5), TAPS)),
        GRID,
      );
      sum += std.dot(
        std.textureSampleBaseClampToEdge(fingerprintLayout.$.frame, fingerprintLayout.$.samp, uv).rgb,
        d.vec3f(0.2126, 0.7152, 0.0722), // Rec. 709 luma coefficients
      );
    }
  }
  fingerprintLayout.$.blocks[input.id.y * GRID + input.id.x] = sum / (TAPS * TAPS);
});

/** Timestamps come back in presentation order. */
export async function pickInformativeTimes(
  track: InputVideoTrack,
  opts: { from: number; to: number; max: number },
): Promise<number[]> {
  const gpu = await createFingerprinter();
  try {
    const scan: number[] = [];
    for (let t = opts.from; t < opts.to; t += 1 / SCAN_FPS) scan.push(t);

    const kept: Array<{ time: number; novelty: number }> = [];
    let lastKept: Float32Array | undefined;
    const keep = (time: number, print: Float32Array, novelty: number) => {
      kept.push({ time, novelty });
      lastKept = print;
    };

    let prev: Float32Array | undefined;
    let prevTime: number | undefined;
    let runStart = 0;
    let calmest: { time: number; print: Float32Array; motion: number } | undefined;

    const sink = new VideoSampleSink(track);
    for await (const sample of sink.samplesAtTimestamps(scan)) {
      if (!sample) continue;
      const time = sample.timestamp;
      // Low-fps clips resolve adjacent scan times to the same frame; skip repeats.
      if (time === prevTime) {
        sample.close();
        continue;
      }
      prevTime = time;
      const frame = sample.toVideoFrame();
      let print: Float32Array;
      try {
        print = await gpu.fingerprint(frame);
      } finally {
        frame.close();
        sample.close();
      }

      const motion = prev ? distance(print, prev) : 0;
      prev = print;

      if (motion <= MOTION_EPS) {
        calmest = undefined;
        const novelty = lastKept ? distance(print, lastKept) : Infinity;
        if (novelty >= THRESHOLD) keep(time, print, novelty);
      } else {
        // Never grab mid-transition; track the calmest sample in case the run never settles.
        if (!calmest) runStart = time;
        if (!calmest || motion < calmest.motion) calmest = { time, print, motion };
        if (time - runStart >= MAX_UNSETTLED) {
          const novelty = lastKept ? distance(calmest.print, lastKept) : Infinity;
          if (novelty >= THRESHOLD) keep(calmest.time, calmest.print, novelty);
          calmest = undefined;
        }
      }
    }
    assert(kept.length, "No frames could be decoded for auto frame selection.");

    return kept
      .sort((a, b) => b.novelty - a.novelty)
      .slice(0, opts.max)
      .sort((a, b) => a.time - b.time)
      .map((k) => k.time);
  } finally {
    gpu.dispose();
  }
}

async function createFingerprinter() {
  assert(navigator.gpu, "Auto frame selection requires WebGPU, which this environment does not support.");
  const adapter = await navigator.gpu.requestAdapter();
  assert(adapter, "Auto frame selection requires WebGPU, but no GPU adapter is available.");
  const device = await adapter.requestDevice();
  const root = tgpu.initFromDevice({ device });
  const pipeline = root.createComputePipeline({ compute: fingerprintFn });
  const sampler = root.createSampler({ magFilter: "linear", minFilter: "linear" });
  const blocks = root.createBuffer(d.arrayOf(d.f32, DIM)).$usage("storage");

  return {
    async fingerprint(frame: VideoFrame): Promise<Float32Array> {
      const bindGroup = root.createBindGroup(fingerprintLayout, {
        samp: sampler,
        frame: device.importExternalTexture({ source: frame }),
        blocks,
      });
      pipeline.with(bindGroup).dispatchWorkgroups(GRID / 8, GRID / 8);
      return new Float32Array(await blocks.read());
    },
    dispose() {
      root.destroy();
      device.destroy();
    },
  };
}

function distance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < DIM; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > DEADZONE) sum += Math.min((d - DEADZONE) / (SATURATION - DEADZONE), 1);
  }
  return sum / DIM;
}
