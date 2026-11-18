/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

/** The key that fires first, then keys to hold (`mod` is ⌘ or Ctrl) and `!keys` that must be up. */
export type KeyCombo = readonly string[];

/** The first combo of a command is the one shown to people. */
const DEFAULT_KEYS = {
  undo: [["z", "mod", "!shift"]],
  redo: [["z", "mod", "shift"]],
  delete: [["backspace"], ["delete"]],
  duplicate: [["d", "mod", "!shift"]],
  group: [["g", "mod", "!shift"]],
  ungroup: [["g", "mod", "shift"]],
  wrapInScene: [["enter", "mod", "!shift", "!alt"]],
  wrapInSequence: [["enter", "mod", "alt", "!shift"]],
  unwrapSequence: [["enter", "mod", "alt", "shift"]],
  split: [["b", "mod"]],
  copy: [["c", "mod"]],
  paste: [["v", "mod"]],
  cut: [["x", "mod"]],
  hide: [["h", "mod", "shift"]],
  selectAll: [["a", "mod", "!shift"]],
  zoomIn: [["+", "mod"], ["=", "mod"]],
  zoomOut: [["-", "mod"]],
  zoomActual: [["0", "mod"]],
  zoomFit: [["1", "mod"]],
  zoomSelection: [["2", "mod"]],
  previewFull: [["j", "mod", "!shift"]],
  previewHalf: [["j", "mod", "shift"]],
  moveTool: [["v", "!mod"]],
  handTool: [["h", "!mod"]],
  frameTool: [["f", "!mod"]],
  textTool: [["t", "!mod"]],
  rectTool: [["r", "!mod"]],
  previousFrame: [["a", "!mod"]],
  nextFrame: [["d", "!mod"]],
  forwardSecond: [["w", "!mod"]],
  backSecond: [["s", "!mod"]],
  previousCut: [],
  nextCut: [],
  selectionStart: [[";", "!mod"]],
  selectionEnd: [["'", "!mod"]],
  timelineStart: [["home"]],
  timelineEnd: [["end"]],
  shuttleBack: [["j", "!mod"]],
  stop: [["k", "!mod"]],
  shuttleForward: [["l", "!mod"]],
  bringToFront: [["]", "!mod"]],
  sendToBack: [["[", "!mod"]],
  selectParent: [["\\", "!mod"]],
  selectChildren: [["enter", "!mod"]],
  deselect: [["escape"]],
  nudgeLeft: [["arrowleft", "!shift"]],
  nudgeRight: [["arrowright", "!shift"]],
  nudgeUp: [["arrowup", "!shift"]],
  nudgeDown: [["arrowdown", "!shift"]],
  nudgeFastLeft: [["arrowleft", "shift"]],
  nudgeFastRight: [["arrowright", "shift"]],
  nudgeFastUp: [["arrowup", "shift"]],
  nudgeFastDown: [["arrowdown", "shift"]],
  play: [[" "]],
} satisfies Record<string, readonly KeyCombo[]>;

export type KeyCommand = keyof typeof DEFAULT_KEYS;
type KeyOverrides = Partial<Record<KeyCommand, readonly KeyCombo[]>>;

/** All four apps step and jump on the arrows, so nudging moves to ⌥. */
const ARROW_KEYS: KeyOverrides = {
  previousFrame: [["arrowleft", "!shift", "!alt", "!mod"]],
  nextFrame: [["arrowright", "!shift", "!alt", "!mod"]],
  backSecond: [["arrowleft", "shift", "!alt", "!mod"]],
  forwardSecond: [["arrowright", "shift", "!alt", "!mod"]],
  previousCut: [["arrowup", "!shift", "!alt", "!mod"]],
  nextCut: [["arrowdown", "!shift", "!alt", "!mod"]],
  nudgeLeft: [["arrowleft", "alt", "!shift", "!mod"]],
  nudgeRight: [["arrowright", "alt", "!shift", "!mod"]],
  nudgeUp: [["arrowup", "alt", "!shift", "!mod"]],
  nudgeDown: [["arrowdown", "alt", "!shift", "!mod"]],
  nudgeFastLeft: [["arrowleft", "alt", "shift", "!mod"]],
  nudgeFastRight: [["arrowright", "alt", "shift", "!mod"]],
  nudgeFastUp: [["arrowup", "alt", "shift", "!mod"]],
  nudgeFastDown: [["arrowdown", "alt", "shift", "!mod"]],
};

const DEFAULT_KEYMAP = "plan-video";

const KEYMAP_KEYS = {
  [DEFAULT_KEYMAP]: {},
  capcut: { ...ARROW_KEYS, moveTool: [["a", "!mod"]] },
  "final-cut": {
    ...ARROW_KEYS,
    moveTool: [["a", "!mod"]],
    hide: [["v", "!mod"]],
    deselect: [["a", "mod", "shift"], ["escape"]],
  },
  resolve: {
    ...ARROW_KEYS,
    moveTool: [["a", "!mod"]],
    hide: [["d", "!mod"]],
    split: [["b", "mod"], ["\\", "mod"]],
  },
  // ⌘B stays alongside ⌘K, where the editor tour and docs teach it.
  premiere: {
    ...ARROW_KEYS,
    split: [["k", "mod"], ["b", "mod"]],
    deselect: [["a", "mod", "shift"], ["escape"]],
  },
} satisfies Record<string, KeyOverrides>;

export type KeymapId = keyof typeof KEYMAP_KEYS;

export const KEYMAPS: readonly { id: KeymapId; name: string }[] = [
  { id: DEFAULT_KEYMAP, name: "plan.video" },
  { id: "capcut", name: "CapCut" },
  { id: "final-cut", name: "Final Cut Pro" },
  { id: "resolve", name: "DaVinci Resolve" },
  { id: "premiere", name: "Premiere Pro" },
];

export type KeyBinding = { command: KeyCommand; keys: KeyCombo };

export function keysFor(id: KeymapId): Record<KeyCommand, readonly KeyCombo[]> {
  return { ...DEFAULT_KEYS, ...KEYMAP_KEYS[id] };
}

export function bindingsFor(id: KeymapId): KeyBinding[] {
  return (Object.entries(keysFor(id)) as [KeyCommand, readonly KeyCombo[]][]).flatMap(([command, combos]) =>
    combos.map((keys) => ({ command, keys })),
  );
}

const STORE_KEY = "plan.keymap";

export function parseKeymap(raw: string | null): KeymapId {
  return raw !== null && Object.hasOwn(KEYMAP_KEYS, raw) ? (raw as KeymapId) : DEFAULT_KEYMAP;
}

function readKeymap(): KeymapId {
  try {
    return parseKeymap(localStorage.getItem(STORE_KEY));
  } catch {
    return DEFAULT_KEYMAP;
  }
}

const [active, setActive] = createSignal<KeymapId>(readKeymap());

export const keymapId = active;

export function setKeymap(id: KeymapId): void {
  setActive(id);
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    // Private windows can refuse storage; the choice still holds until the page closes.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORE_KEY) setActive(parseKeymap(event.newValue));
  });
}

const BINDINGS = Object.fromEntries(KEYMAPS.map(({ id }) => [id, bindingsFor(id)])) as Record<KeymapId, KeyBinding[]>;

export const activeBindings = (): readonly KeyBinding[] => BINDINGS[active()];

/**
 * Modifiers qualify a shortcut but never trigger one. Only their key-ups can be trusted:
 * macOS does not deliver the key-up of a key released while ⌘ is held.
 */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(["mod", "meta", "control", "shift", "alt"]);

// The trigger is matched against `moved`, not `held`: a lift takes it out of
// `held`, and a sub-frame tap is over before the frame runs. Only a
// non-modifier can trigger, since macOS drops the key-up of a key released
// while ⌘ is down, leaving a stale letter in `held`.
export function matchesKeys(keys: KeyCombo, moved: ReadonlySet<string>, held: ReadonlySet<string>): boolean {
  let triggered = false;

  for (const key of keys) {
    if (key.startsWith("!")) {
      if (held.has(key.slice(1))) return false;
    } else if (moved.has(key) && !MODIFIER_KEYS.has(key)) {
      triggered = true;
    } else if (!held.has(key)) {
      return false;
    }
  }

  return triggered;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backspace: "⌫",
  enter: "↩",
  escape: "Esc",
  home: "Home",
  end: "End",
};

export function formatKeys(keys: KeyCombo): string {
  const [trigger = ""] = keys;
  const name = KEY_NAMES[trigger] ?? trigger.toUpperCase();
  const alt = keys.includes("alt");
  const shift = keys.includes("shift");
  const mod = keys.includes("mod");
  if (MAC) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`;
  return [mod && "Ctrl", shift && "Shift", alt && "Alt", name].filter(Boolean).join("+");
}

/** What to show for a command right now, or "" when this keymap has no key for it. */
export function shortcutLabel(command: KeyCommand): string {
  const [combo] = keysFor(active())[command];
  return combo ? formatKeys(combo) : "";
}
