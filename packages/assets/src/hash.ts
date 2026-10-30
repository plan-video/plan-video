/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Hashing gigabytes of footage on import would take seconds, so the id is a SHA-256 over the size
// and the head, middle and tail bytes, truncated to 16 hex characters.

/** Bytes hashed from each of the head, middle and tail of a file. */
const SAMPLE_BYTES = 1024 * 1024;

export const ID_LENGTH = 16;

export async function hashBlob(blob: Blob): Promise<string> {
	const size = blob.size;
	const parts: Blob[] = [new Blob([String(size)])];

	if (size <= SAMPLE_BYTES * 3) {
		parts.push(blob);
	} else {
		const middle = Math.floor(size / 2 - SAMPLE_BYTES / 2);
		parts.push(
			blob.slice(0, SAMPLE_BYTES),
			blob.slice(middle, middle + SAMPLE_BYTES),
			blob.slice(size - SAMPLE_BYTES),
		);
	}

	const bytes = await new Blob(parts).arrayBuffer();
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

/** The id of a sequence: the hash of its frame names and sizes, not their bytes. */
export async function hashSequence(frames: { name: string; size: number }[]): Promise<string> {
	const text = frames.map((frame) => `${frame.name}:${frame.size}`).join('\n');
	const bytes = new TextEncoder().encode(`seq\n${text}`);
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

/** No bytes yet, so the generation key is hashed: the same generation reserved twice is one record. */
export async function hashKey(key: string): Promise<string> {
	const bytes = new TextEncoder().encode(`key\n${key}`);
	return hexOf(await crypto.subtle.digest('SHA-256', bytes)).slice(0, ID_LENGTH);
}

export const looksLikeId = (value: string): boolean =>
	value.length === ID_LENGTH && /^[0-9a-f]+$/.test(value);

function hexOf(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
