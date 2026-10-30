/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { StreamTargetChunk } from "mediabunny";
import type { WritableFileTarget } from "@plan.video/encoder";

// Streams encoder output to disk through main without buffering the whole file in the renderer. Desktop only.
export class ElectronWritableFileHandle implements WritableFileTarget {
  readonly path: string;
  // Lets callers clean up a partial file on errors mediabunny doesn't surface through the stream.
  private openId: string | null = null;

  constructor(path: string) {
    this.path = path;
  }

  async createWritable(opts?: { exclusive?: boolean }): Promise<WritableStream<StreamTargetChunk>> {
    const { id } = await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_OPEN, {
      ...opts,
      path: this.path,
    });
    this.openId = id;

    return new WritableStream<StreamTargetChunk>({
      write: (chunk) =>
        mainBridge.call(MAIN_CHANNELS.FILE_WRITE_CHUNK, {
          id,
          data: chunk.data,
          position: chunk.position,
        }),
      close: async () => {
        this.openId = null;
        await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_CLOSE, { id });
      },
      abort: async () => {
        this.openId = null;
        await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_ABORT, { id });
      },
    });
  }

  async dispose(): Promise<void> {
    const id = this.openId;
    if (id === null) return;
    this.openId = null;
    await mainBridge.call(MAIN_CHANNELS.FILE_WRITE_ABORT, { id });
  }
}
