/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// For tests: what lib `idb` gives the calendar store, in memory, so several copies of the store can share a browser.

type Row = Record<string, unknown>;

const KEYED_BY_ID = new Set(["calendars", "events", "media"]);

const copy = <T>(value: T): T => {
  if (value && typeof value === "object" && "file" in value) return { ...value };
  return structuredClone(value);
};

export class FakeIdb {
  stores = new Map<string, Map<unknown, unknown>>();
  /** Thrown from a write, as a full disk does. */
  failWrite: ((store: string, value: unknown) => Error | undefined) | null = null;
  /** Awaited by a write to this store before it lands, to hold a save in flight. */
  holdWrite: { store: string; until: Promise<void> } | null = null;
  /** Awaited once by the next read of a store after it has read, so what it returns is already old. */
  afterRead: ((store: string) => Promise<void> | void) | null = null;

  private store(name: string) {
    let found = this.stores.get(name);
    if (!found) this.stores.set(name, (found = new Map()));
    return found;
  }

  rows(name: string) {
    return [...this.store(name).values()] as Row[];
  }

  private async getAll(name: string) {
    const rows = [...this.store(name).values()].map(copy);
    const hook = this.afterRead;
    if (hook) {
      this.afterRead = null;
      await hook(name);
    }
    return rows;
  }

  private async put(name: string, value: unknown, key?: unknown) {
    if (this.holdWrite?.store === name) await this.holdWrite.until;
    const failure = this.failWrite?.(name, value);
    if (failure) throw failure;
    this.store(name).set(KEYED_BY_ID.has(name) ? (value as Row).id : key, copy(value));
    return key;
  }

  private objectStore(name: string) {
    return {
      getAll: () => this.getAll(name),
      getAllKeys: async () => [...this.store(name).keys()],
      get: async (key: unknown) => copy(this.store(name).get(key)),
      put: (value: unknown, key?: unknown) => this.put(name, value, key),
      delete: async (key: unknown) => void this.store(name).delete(key),
    };
  }

  open() {
    return {
      close: () => {},
      getAll: (name: string) => this.getAll(name),
      getAllKeys: (name: string) => this.objectStore(name).getAllKeys(),
      get: (name: string, key: unknown) => this.objectStore(name).get(key),
      put: (name: string, value: unknown, key?: unknown) => this.put(name, value, key),
      delete: (name: string, key: unknown) => this.objectStore(name).delete(key),
      transaction: (names: string | string[]) => ({
        store: this.objectStore(Array.isArray(names) ? names[0]! : names),
        objectStore: (name: string) => this.objectStore(name),
        done: Promise.resolve(),
      }),
    };
  }
}
