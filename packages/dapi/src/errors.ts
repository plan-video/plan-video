/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Every code reaches the agent as an error result; the message is the part written for people. */
export type DapiErrorCode =
  /** No node, asset, or file matches the given id or path. */
  | "not-found"
  /** The target exists but is the wrong kind, e.g. a clip where a scene is required. */
  | "wrong-kind"
  /** The input failed validation beyond what the schema expresses. */
  | "invalid-input"
  /** A single-slot resource (the export renderer) is in use. */
  | "busy"
  | "sign-in-required"
  /** The network or this browser cannot do it. */
  | "unsupported"
  | "canceled";

export class DapiError extends Error {
  readonly code: DapiErrorCode;

  constructor(code: DapiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DapiError";
    this.code = code;
  }
}

export function isDapiError(value: unknown): value is DapiError {
  return value instanceof DapiError;
}
