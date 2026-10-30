/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createRoot, createSignal, type Accessor, type Resource } from "solid-js";

export type SignalFunction<T> = {
  (): T;
  <S extends T>(value: S): S;
}

export function onCreated(fn: () => void): void {
  fn();
}

export function createSignalFunction<T>(initialValue: T): SignalFunction<T> {
  const [currentValue, setCurrentValue] = createSignal<T>(initialValue);

  function fn(): T;
  function fn(value: T): T;
  function fn(value?: T): T {
    if (arguments.length > 0 && value !== undefined) {
      setCurrentValue(() => value);
    }

    return currentValue();
  }

  return fn;
}

export function createRootMemo<T>(fn: () => T): [Accessor<T>, () => void] {
  return createRoot(dispose => {
    const memo = createMemo(() => fn());

    return [memo, dispose];
  });
}

/**
 * Read without suspending: calling the resource registers with the nearest Suspense, which in the editor is the
 * app's root one, so a thumbnail loading would blank the whole page.
 */
export function settled<T>(resource: Resource<T>): T | undefined {
  const state = resource.state;
  return state === "ready" || state === "refreshing" ? resource.latest : undefined;
}

export function createRootEffect(fn: () => void): () => void {
  return createRoot(dispose => {
    fn();
    return dispose;
  });
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type MergeTwo<A, B> = Simplify<Omit<A, keyof B> & B>;

type MergeMany<T extends readonly unknown[]> =
  T extends readonly [infer A, infer B, ...infer R]
  ? MergeMany<readonly [MergeTwo<A & object, B & object>, ...R]>
  : T extends readonly [infer Only]
  ? Only & object
  : {};

type Nullable<T> = T | null | undefined;

/** Like Object.assign over enumerable own props (strings and symbols), but keeps property descriptors. */
export function mergeProps<
  T extends object,
  const S extends readonly object[]
>(
  target: T,
  ...sources: { [K in keyof S]: Nullable<S[K]> }
): Simplify<MergeMany<readonly [T, ...S]>> {
  for (const source of sources) {
    if (source == null) continue;

    const descriptors: PropertyDescriptorMap = {};

    for (const key of Object.keys(source)) {
      const d = Object.getOwnPropertyDescriptor(source, key);
      if (d) descriptors[key] = d;
    }

    for (const sym of Object.getOwnPropertySymbols(source)) {
      const d = Object.getOwnPropertyDescriptor(source, sym);
      if (d?.enumerable) (descriptors as any)[sym] = d;
    }

    Object.defineProperties(target, descriptors);
  }

  return target as any;
}
