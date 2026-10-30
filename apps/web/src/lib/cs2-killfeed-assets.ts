/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg } from "@/lib/i18n";

export type Cs2WeaponGroup ="rifles" | "smgs" | "heavy" | "pistols" | "grenades";

export type Cs2Weapon = {
  id: string;
  group: Cs2WeaponGroup;
  label: string;
  url: string;
};

export type Cs2ExtraPlace = "prefix" | "suffix";

export type Cs2Extra = {
  id: string;
  label: string;
  /** Prefix marks sit before the weapon; the rest follow it, in this order. */
  place: Cs2ExtraPlace;
  url: string;
};

const weaponFiles = import.meta.glob<string>("../../../../assets/killfeed-cs2/weapons/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});
const extraFiles = import.meta.glob<string>("../../../../assets/killfeed-cs2/extras/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

const stemOf = (path: string) => path.split("/").pop()!.replace(/\.webp$/i, "");

const weaponUrl = new Map(Object.entries(weaponFiles).map(([path, url]) => [stemOf(path), url]));
const extraUrl = new Map(Object.entries(extraFiles).map(([path, url]) => [stemOf(path), url]));

const WEAPON_CATALOG: { id: string; group: Cs2WeaponGroup; label: string }[] = [
  { id: "ak47", group: "rifles", label: "AK-47" },
  { id: "m4a4", group: "rifles", label: "M4A4" },
  { id: "m4a1s", group: "rifles", label: "M4A1-S" },
  { id: "aug", group: "rifles", label: "AUG" },
  { id: "famas", group: "rifles", label: "FAMAS" },
  { id: "galilar", group: "rifles", label: "Galil AR" },
  { id: "sg552", group: "rifles", label: "SG 553" },
  { id: "awp", group: "rifles", label: "AWP" },
  { id: "ssg08", group: "rifles", label: "SSG 08" },
  { id: "scar20", group: "rifles", label: "SCAR-20" },
  { id: "g3sg1", group: "rifles", label: "G3SG1" },
  { id: "mac10", group: "smgs", label: "MAC-10" },
  { id: "mp9", group: "smgs", label: "MP9" },
  { id: "mp7", group: "smgs", label: "MP7" },
  { id: "mp5", group: "smgs", label: "MP5-SD" },
  { id: "ump45", group: "smgs", label: "UMP-45" },
  { id: "bizon", group: "smgs", label: "PP-Bizon" },
  { id: "p90", group: "smgs", label: "P90" },
  { id: "nova", group: "heavy", label: "Nova" },
  { id: "xm1014", group: "heavy", label: "XM1014" },
  { id: "mag7", group: "heavy", label: "MAG-7" },
  { id: "sawedoff", group: "heavy", label: "Sawed-Off" },
  { id: "m249", group: "heavy", label: "M249" },
  { id: "glock18", group: "pistols", label: "Glock-18" },
  { id: "hkp2000", group: "pistols", label: "P2000" },
  { id: "usps", group: "pistols", label: "USP-S" },
  { id: "p250", group: "pistols", label: "P250" },
  { id: "c75a", group: "pistols", label: "CZ75-Auto" },
  { id: "fiveseven", group: "pistols", label: "Five-SeveN" },
  { id: "tec9", group: "pistols", label: "Tec-9" },
  { id: "deagle", group: "pistols", label: "Desert Eagle" },
  { id: "revolver", group: "pistols", label: "R8 Revolver" },
  { id: "elite", group: "pistols", label: "Dual Berettas" },
  { id: "taser", group: "pistols", label: "Zeus x27" },
  { id: "Hegrenade_hud_csgo", group: "grenades", label: "HE Grenade" },
  { id: "Flashbang_hud_csgo", group: "grenades", label: "Flashbang" },
  { id: "Smokegrenade_hud_csgo", group: "grenades", label: "Smoke" },
  { id: "Molotov_hud_csgo", group: "grenades", label: "Molotov" },
  { id: "Incgrenade_hud_csgo", group: "grenades", label: "Incendiary" },
];

const EXTRA_CATALOG: { id: string; label: string; place: Cs2ExtraPlace }[] = [
  { id: "Headshot", label: msg("Headshot"), place: "suffix" },
  { id: "No Scope", label: msg("No Scope"), place: "suffix" },
  { id: "Blind", label: msg("Blind"), place: "suffix" },
  { id: "Door", label: msg("Door"), place: "suffix" },
  { id: "Flashbang", label: msg("Flashbang"), place: "suffix" },
  { id: "Fly", label: msg("Fly"), place: "prefix" },
  { id: "Smoke", label: msg("Smoke"), place: "suffix" },
  { id: "Explosion", label: msg("Explosion"), place: "suffix" },
];

function requireUrl(map: Map<string, string>, id: string, kind: string): string {
  const url = map.get(id);
  if (!url) throw new Error(`No CS2 killfeed ${kind} ${id}`);
  return url;
}

export const CS2_WEAPONS: Cs2Weapon[] = WEAPON_CATALOG.map((weapon) => ({
  ...weapon,
  url: requireUrl(weaponUrl, weapon.id, "weapon"),
}));

export const CS2_EXTRAS: Cs2Extra[] = EXTRA_CATALOG.map((extra) => ({
  ...extra,
  url: requireUrl(extraUrl, extra.id, "extra"),
}));

export const CS2_WEAPON_GROUPS: { id: Cs2WeaponGroup; label: string }[] = [
  { id: "rifles", label: msg("Rifles") },
  { id: "smgs", label: msg("SMGs") },
  { id: "heavy", label: msg("Heavy") },
  { id: "pistols", label: msg("Pistols") },
  { id: "grenades", label: msg("Nades") },
];

export function cs2Weapon(id: string): Cs2Weapon | undefined {
  return CS2_WEAPONS.find((weapon) => weapon.id === id);
}

export function cs2Weapons(group: Cs2WeaponGroup): Cs2Weapon[] {
  return CS2_WEAPONS.filter((weapon) => weapon.group === group);
}

export function cs2Extra(id: string): Cs2Extra | undefined {
  return CS2_EXTRAS.find((extra) => extra.id === id);
}
