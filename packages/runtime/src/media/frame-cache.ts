/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isScalingOffThread, recordFrameDraw, scaleFrame } from './frame-scaler';

type FrameCacheConfig = {
  pixels: number;
  count: number;
}

type FrameTile = {
  /** Place in the atlas, or -1 for a frame held as a bitmap of its own. */
  tileIndex: number;
  frameIndex: number;
  bitmap?: ImageBitmap;
}

type Frame = VideoFrame | ImageBitmap;

function getDisplaySize(frame: Frame) {
  if (frame instanceof VideoFrame) {
    return [frame.displayWidth, frame.displayHeight];
  }
  return [frame.width, frame.height]
}

export class FrameCache {
  public config: FrameCacheConfig;
  public readonly atlas = new OffscreenCanvas(0, 0);
  public readonly atlasCtx = this.atlas.getContext('2d')!;
  public readonly source = new OffscreenCanvas(0, 0);
  public readonly sourceCtx = this.source.getContext('2d')!;

  private tileWidth: number = 0;
  private tileHeight: number = 0;
  private columns: number = 0;
  private tiles: FrameTile[];

  /** Frames out at a worker being scaled to their tile, by frame index. */
  private readonly scaling = new Set<number>();
  private waiters: (() => void)[] = [];

  /** Bumped whenever the tiles are dropped, so a worker's late answer is too. */
  private epoch = 0;

  public rotation: number = 0;
  public leftFrameIndex: number;
  public rightFrameIndex: number;
  public lastInserted: number = -1;

  public constructor(config: FrameCacheConfig) {
    this.config = config;
    this.leftFrameIndex = 0;
    this.rightFrameIndex = config.count - 1;
    this.tiles = [];
  }

  private resizeCaches(frame: Frame) {
    const rotation = this.rotation;
    const previousWidth = this.tileWidth;
    const previousHeight = this.tileHeight;
    const [width, height] = getDisplaySize(frame);
    const pixelCount = width * height;

    const factor = Math.min(1, Math.sqrt(this.config.pixels / pixelCount));

    const sourceWidth = rotation === 90 || rotation === 270
      ? height
      : width;

    const sourceHeight = rotation === 90 || rotation === 270
      ? width
      : height;

    this.tileWidth = Math.floor(sourceWidth * factor);
    this.tileHeight = Math.floor(sourceHeight * factor);

    // Where frames are scaled on workers (drawing here is slow without hardware acceleration) each is
    // its own bitmap: writing into one big atlas would copy all of it on every frame the preview read
    // from it since, 100 MB a frame on the CPU. A sequence's pictures still go into the atlas.
    if (frame instanceof VideoFrame && isScalingOffThread()) {
      if (this.tileWidth !== previousWidth || this.tileHeight !== previousHeight) this.clearTiles();
      if (this.atlas.width && this.tiles.every((t) => t.bitmap)) {
        this.atlas.width = 0;
        this.atlas.height = 0;
      }
      return;
    }

    this.columns = Math.ceil(Math.sqrt(this.config.count));
    const rows = Math.ceil(this.config.count / this.columns);

    const absoluteWidth = this.tileWidth * this.columns;
    const absoluteHeight = this.tileHeight * rows;

    if (this.atlas.width !== absoluteWidth || this.atlas.height !== absoluteHeight) {
      this.atlas.width = absoluteWidth;
      this.atlas.height = absoluteHeight;
      this.atlasCtx.imageSmoothingQuality = 'high';
      this.clearTiles(); // setting the canvas size resets the tiles
    }
  }

  private drawRotated(frame: Frame) {
    const ctx = this.sourceCtx;
    const rotation = this.rotation;

    const [displayWidth, displayHeight] = getDisplaySize(frame);

    const width = rotation === 90 || rotation === 270
      ? displayHeight
      : displayWidth;

    const height = rotation === 90 || rotation === 270
      ? displayWidth
      : displayHeight;

    if (this.source.width !== width || this.source.height !== height) {
      this.source.width = width;
      this.source.height = height;
      ctx.imageSmoothingEnabled = false;
    }

    ctx.resetTransform();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(frame, -displayWidth / 2, -displayHeight / 2, displayWidth, displayHeight);
  }

  private evictTiles() {
    if (this.tiles.length < this.config.count) return;

    this.tiles = this.tiles.filter((t) => {
      const keep = t.frameIndex >= this.leftFrameIndex && t.frameIndex <= this.rightFrameIndex;
      if (!keep) t.bitmap?.close();
      return keep;
    });
  }

  private clearTiles() {
    for (const tile of this.tiles) tile.bitmap?.close();
    this.tiles = [];
  }

  private insertBitmap(frameIndex: number, bitmap: ImageBitmap) {
    this.evictTiles();
    this.tiles.push({ tileIndex: -1, frameIndex, bitmap });
    this.lastInserted = frameIndex;
  }

  private scaleHere(frame: VideoFrame): ImageBitmap {
    const canvas = new OffscreenCanvas(this.tileWidth, this.tileHeight);
    const ctx = canvas.getContext('2d')!;
    const turned = this.rotation === 90 || this.rotation === 270;
    const width = turned ? this.tileHeight : this.tileWidth;
    const height = turned ? this.tileWidth : this.tileHeight;
    ctx.translate(this.tileWidth / 2, this.tileHeight / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.drawImage(frame, -width / 2, -height / 2, width, height);
    return canvas.transferToImageBitmap();
  }

  private insertTile(frameIndex: number, image: CanvasImageSource) {
    let tileIndex = 0;
    while (this.tiles.some(t => t.tileIndex === tileIndex)) {
      tileIndex++;
    }

    this.tiles.push({ tileIndex, frameIndex });

    const ctx = this.atlasCtx;
    const x = (tileIndex % this.columns) * this.tileWidth;
    const y = Math.floor(tileIndex / this.columns) * this.tileHeight;

    ctx.clearRect(x, y, this.tileWidth, this.tileHeight);
    ctx.drawImage(image, x, y, this.tileWidth, this.tileHeight);
  }

  /** Every tile held is dropped, as none fit the new grid. Returns whether anything changed. */
  public configure(config: FrameCacheConfig): boolean {
    if (config.pixels === this.config.pixels && config.count === this.config.count) return false;
    this.config = config;
    this.atlas.width = 0;
    this.atlas.height = 0;
    this.clearTiles();
    this.dropScaling();
    return true;
  }

  public has(frameIndex: number) {
    return this.tiles.some(t => t.frameIndex === frameIndex);
  }

  /**
   * Frame index of the cached frame closest to `frameIndex`, or `undefined` when
   * nothing is cached within `tolerance`. Ties resolve to the earlier frame, so a
   * playhead sitting between two cached frames never shows one that hasn't played yet.
   */
  public findNearest(frameIndex: number, tolerance: number): number | undefined {
    let best: number | undefined;
    let bestDistance = tolerance + 1;

    for (const tile of this.tiles) {
      const distance = Math.abs(tile.frameIndex - frameIndex);
      if (distance < bestDistance || (best !== undefined && distance === bestDistance && tile.frameIndex < best)) {
        bestDistance = distance;
        best = tile.frameIndex;
      }
    }

    return best;
  }

  public findLatest(frameIndex: number, from: number): number | undefined {
    let best: number | undefined;

    for (const tile of this.tiles) {
      if (tile.frameIndex > frameIndex || tile.frameIndex < from) continue;
      if (best === undefined || tile.frameIndex > best) best = tile.frameIndex;
    }

    return best;
  }

  public isScaling(frameIndex: number) {
    return this.scaling.has(frameIndex);
  }

  public get scalingCount() {
    return this.scaling.size;
  }

  /**
   * Resolves once one more frame is back from a worker, the frames out were
   * dropped, or a moment has passed: a worker that never answers must not hold
   * a fill (and every seek queued behind it) for good.
   */
  public nextScaled(): Promise<void> {
    if (this.scaling.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, 250);
    });
  }

  /** `done` fires once `frame` is in (never for one that didn't make it). A frame sent to a worker goes with it; any other stays the caller's to close. */
  public insert(frame: VideoFrame | ImageBitmap, index: number, done?: () => void) {
    if (this.has(index)) {
      done?.();
      return;
    }
    if (this.scaling.has(index)) return;

    this.evictTiles();
    this.resizeCaches(frame);

    if (frame instanceof VideoFrame) {
      const scaled = scaleFrame(frame, this.tileWidth, this.tileHeight, this.rotation);
      if (scaled) {
        this.scaling.add(index);
        const epoch = this.epoch;
        void scaled.then((bitmap) => {
          if (epoch !== this.epoch) {
            bitmap?.close();
            return;
          }
          this.scaling.delete(index);
          this.wake();
          if (!bitmap) return;
          if (this.has(index)) bitmap.close();
          else this.insertBitmap(index, bitmap);
          done?.();
        });
        return;
      }

      // The workers are full: scale it here, but still into a bitmap of its
      // own rather than the atlas.
      if (isScalingOffThread() && this.tileWidth > 0 && this.tileHeight > 0) {
        this.insertBitmap(index, this.scaleHere(frame));
        done?.();
        return;
      }
    }

    const start = performance.now();

    // An upright frame scales straight into its tile. Copying it whole into
    // `source` first costs a full-size draw per frame for nothing.
    if (this.rotation === 0) {
      this.insertTile(index, frame);
    } else {
      this.drawRotated(frame);
      this.insertTile(index, this.source);
    }
    this.lastInserted = index;

    if (frame instanceof VideoFrame) recordFrameDraw(performance.now() - start);
    done?.();
  }

  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private dropScaling() {
    this.epoch++;
    this.scaling.clear();
    this.wake();
  }

  public findTile(frameIndex: number) {
    const tile = this.tiles.find(t => t.frameIndex === frameIndex);

    if (!tile) return;

    if (tile.bitmap) {
      return { image: tile.bitmap, x: 0, y: 0, width: tile.bitmap.width, height: tile.bitmap.height };
    }

    const x = (tile.tileIndex % this.columns) * this.tileWidth;
    const y = Math.floor(tile.tileIndex / this.columns) * this.tileHeight;

    return { image: this.atlas, x, y, width: this.tileWidth, height: this.tileHeight };
  }

  public dispose() {
    this.atlas.width = 0;
    this.atlas.height = 0;
    this.source.width = 0;
    this.source.height = 0;
    this.tileWidth = 0;
    this.tileHeight = 0;
    this.columns = 0;
    this.lastInserted = -1;
    this.clearTiles();
    this.dropScaling();
  }
}
