/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// An agent's square icon is what the builder shows; its 2:1 portrait is what the entry draws.

import { msg } from "@/lib/i18n";

export type KillfeedWeaponGroup = "weapons" | "abilities" | "special";

export type KillfeedAgent = { name: string; icon: string; portrait: string };

export type KillfeedWeapon = {
  /** The folder decides whether it is drawn mirrored. */
  id: string;
  group: KillfeedWeaponGroup;
  /** A buy-menu class, or the agent an ability belongs to. */
  category: string;
  label: string;
  url: string;
};

export type KillfeedCategory = { id: string; label: string };

/** Buy-menu order. A file that isn't listed still shows, under Other. */
const WEAPON_CATEGORIES: { id: string; label: string; names: string[] }[] = [
  { id: "sidearms", label: msg("Sidearms"), names: ["Classic", "Shorty", "Frenzy", "Ghost", "Sheriff", "Bandit"] },
  { id: "smgs", label: msg("SMGs"), names: ["Stinger", "Spectre"] },
  { id: "shotguns", label: msg("Shotguns"), names: ["Bucky", "Judge"] },
  { id: "rifles", label: msg("Rifles"), names: ["Bulldog", "Guardian", "Phantom", "Vandal", "Warden"] },
  { id: "snipers", label: msg("Snipers"), names: ["Marshal", "Outlaw", "Operator"] },
  { id: "heavy", label: msg("Heavy"), names: ["Ares", "Odin"] },
  { id: "melee", label: msg("Melee"), names: ["Knife"] },
];

const ABILITY_CATEGORIES: { id: string; label: string; names: string[] }[] = [
  { id: "breach", label: "Breach", names: ["Aftershock"] },
  { id: "brimstone", label: "Brimstone", names: ["Incendiary"] },
  { id: "chamber", label: "Chamber", names: ["Headhunter", "Chamber Ult"] },
  { id: "cypher", label: "Cypher", names: ["Trapwire"] },
  { id: "deadlock", label: "Deadlock", names: ["Annihilation"] },
  { id: "gekko", label: "Gekko", names: ["Mosh Pit"] },
  { id: "jett", label: "Jett", names: ["Blade Storm"] },
  { id: "kayo", label: "KAY/O", names: ["Fragment"] },
  { id: "killjoy", label: "Killjoy", names: ["Nanoswarm", "Turret"] },
  { id: "neon", label: "Neon", names: ["Overdrive"] },
  { id: "phoenix", label: "Phoenix", names: ["Blaze", "Hot Hands"] },
  { id: "raze", label: "Raze", names: ["Boom Bot", "Paint Shells", "Satchel", "Showstopper"] },
  { id: "skye", label: "Skye", names: ["Trailblazer"] },
  { id: "sova", label: "Sova", names: ["Shock Dart", "Hunters Fury"] },
  { id: "tejo", label: "Tejo", names: ["Special Delivery", "Guided Salvo", "Armageddon"] },
  { id: "viper", label: "Viper", names: ["Snake Bite"] },
  { id: "vyse", label: "Vyse", names: ["Razervine"] },
];

const CATEGORIES: Record<KillfeedWeaponGroup, { id: string; label: string; names: string[] }[]> = {
  weapons: WEAPON_CATEGORIES,
  abilities: ABILITY_CATEGORIES,
  special: [],
};

function placed(group: KillfeedWeaponGroup, label: string): { category: string; order: number } {
  const list = CATEGORIES[group];
  const key = label.toLowerCase();
  for (let index = 0; index < list.length; index++) {
    const at = list[index]!.names.findIndex((name) => name.toLowerCase() === key);
    if (at !== -1) return { category: list[index]!.id, order: index * 100 + at };
  }
  return { category: "other", order: 10_000 };
}

const agentIcons = import.meta.glob<string>("../../../../assets/killfeed/agents/*.png", { eager: true, import: "default", query: "?url" });
const portraits = import.meta.glob<string>("../../../../assets/killfeed/portraits/*.png", { eager: true, import: "default", query: "?url" });
const weapons = import.meta.glob<string>("../../../../assets/killfeed/{weapons,abilities,special}/*.png", { eager: true, import: "default", query: "?url" });
const ui = import.meta.glob<string>("../../../../assets/killfeed/ui/*.png", { eager: true, import: "default", query: "?url" });

const fileOf = (path: string) => path.split("/").pop()!;
const stemOf = (path: string) => fileOf(path).replace(/\.png$/i, "");
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

const portraitByName = new Map(Object.entries(portraits).map(([path, url]) => [stemOf(path).toLowerCase(), url]));

export const KILLFEED_AGENTS: KillfeedAgent[] = Object.entries(agentIcons)
  .map(([path, icon]) => {
    const name = stemOf(path);
    const portrait = portraitByName.get(name.toLowerCase());
    if (!portrait) throw new Error(`No killfeed portrait for ${name}`);
    return { name, icon, portrait };
  })
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

export const KILLFEED_WEAPONS: KillfeedWeapon[] = Object.entries(weapons)
  .map(([path, url]) => {
    const group = path.split("/").at(-2) as KillfeedWeaponGroup;
    const label = stemOf(path).replace(/_/g, " ");
    const { category, order } = placed(group, label);
    return { id: `${group}/${fileOf(path)}`, group, category, label, url, order };
  })
  .sort((a, b) => a.order - b.order || byLabel(a, b))
  .map(({ order: _order, ...weapon }) => weapon);

/** Special has none: it is already a short list. */
export function killfeedCategories(group: KillfeedWeaponGroup): KillfeedCategory[] {
  if (CATEGORIES[group].length === 0) return [];
  const present = new Set(KILLFEED_WEAPONS.filter((weapon) => weapon.group === group).map((weapon) => weapon.category));
  const known = CATEGORIES[group].filter((category) => present.has(category.id)).map(({ id, label }) => ({ id, label }));
  if (present.has("other")) known.push({ id: "other", label: msg("Other") });
  return known;
}

export function killfeedAgent(name: string): KillfeedAgent | undefined {
  const key = name.toLowerCase();
  return KILLFEED_AGENTS.find((agent) => agent.name.toLowerCase() === key);
}

export function killfeedWeapon(id: string): KillfeedWeapon | undefined {
  return KILLFEED_WEAPONS.find((weapon) => weapon.id === id);
}

export function killfeedWeapons(group: KillfeedWeaponGroup, category?: string): KillfeedWeapon[] {
  return KILLFEED_WEAPONS.filter((weapon) => weapon.group === group && (category === undefined || weapon.category === category));
}

/** By file stem (`headshot`, `Rev_Numeral_3`). */
export function killfeedUi(stem: string): string {
  const entry = Object.entries(ui).find(([path]) => stemOf(path) === stem);
  if (!entry) throw new Error(`No killfeed UI picture ${stem}`);
  return entry[1];
}
