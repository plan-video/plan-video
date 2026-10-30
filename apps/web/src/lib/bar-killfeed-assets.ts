/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import conduitUrl from "@/assets/fonts/ConduitITC.otf?url";
import robotoUrl from "@/assets/fonts/Roboto-Medium.ttf?url";
import robotoCondensedUrl from "@/assets/fonts/RobotoCondensed.ttf?url";
import { msg } from "@/lib/i18n";

export type BarStyle = {
  fontFamily: string;
  fontUrl: string;
  fontWeight: number;
  fontSize: number;
  icon: number;
  padX: number;
  padY: number;
  gap: number;
  border: number;
  radius: number;
  background: string;
  borderColor: string;
  killer: string;
  victim: string;
  /** 0 to 100, the generator's shadow slider. */
  shadow: number;
  flipWeapon: boolean;
};

export type BarWeapon = { id: string; label: string; group: string; url: string };
export type BarExtra = { id: string; label: string; place: "prefix" | "suffix"; url: string };

export type BarAnchor = "top-right" | "bottom-left";

export type BarGame = {
  id: string;
  game: string;
  summary: string;
  /** Entries of one game stack with each other, and not with another game's. */
  stackName: string;
  style: BarStyle;
  weapons: BarWeapon[];
  groups: { id: string; label: string }[];
  extras: BarExtra[];
  defaultWeapon: string;
  anchor: BarAnchor;
  /** At unit 1, for a top-right feed. */
  top: number;
  /** At unit 1, for a bottom-left feed. */
  bottom: number;
  entryHeight: number;
  coverExtras: string[];
  previewBackground: string;
  coverBackground: string;
};

const codFiles = import.meta.glob<string>("../../../../assets/killfeed-codmw3/weapons/*.webp", { eager: true, import: "default", query: "?url" });
const codExtras = import.meta.glob<string>("../../../../assets/killfeed-codmw3/extras/*.webp", { eager: true, import: "default", query: "?url" });
const pubgFiles = import.meta.glob<string>("../../../../assets/killfeed-pubg/weapons/*.webp", { eager: true, import: "default", query: "?url" });
const pubgExtras = import.meta.glob<string>("../../../../assets/killfeed-pubg/extras/*.webp", { eager: true, import: "default", query: "?url" });
const rustFiles = import.meta.glob<string>("../../../../assets/killfeed-rust/weapons/*.webp", { eager: true, import: "default", query: "?url" });
const rustExtras = import.meta.glob<string>("../../../../assets/killfeed-rust/extras/*.webp", { eager: true, import: "default", query: "?url" });

const stemOf = (path: string) => path.split("/").pop()!.replace(/\.webp$/i, "");

const COD_LABELS: Record<string, string> = {
  "Cod4-mini-gun-pickup": "Minigun",
  "Hud_m320": "M320",
  "MW2_Pickup_Kriss": "Vector",
  "MW2-Claymore-HUD": "Claymore",
  "MW3_I.M.S": "IMS",
  "MW3_AH-6_Overwatch": "AH-6 Overwatch",
  "P99_Pick-up": "P99",
  "Barrett_.50cal_Pickup_CoD4": "Barrett .50 Cal",
  "ACR_6.8_HUD_icon_MW3": "ACR 6.8",
  "USP.45_Pickup_CoD4": "USP .45",
  "FGM-148_Javelin_HUD_icon_MW3": "Javelin",
  "Throwing_knife_icon": "Throwing Knife",
  "MW3_Precision_Airstrike": "Precision Airstrike",
  "MW3_Predator_Missile_Icon": "Predator Missile",
  "MW3_Strafe_Run": "Strafe Run",
  "MW3_Osprey_Gunner": "Osprey Gunner",
  "SOFLAM_HUD_icon_inactive_MW3": "SOFLAM",
};

function codLabel(id: string): string {
  if (COD_LABELS[id]) return COD_LABELS[id];
  let name = id.replace(/^(MW2_|MW3_|MW_)/i, "").replace(/^(Pickup_|HUD_|Hud_)/i, "");
  name = name.replace(/_(hud_icon|hud|icon|killfeed|pickup)(_mw3|_mw2|_cod4|_mwr)?$/i, "");
  name = name.replace(/_(mw3|mw2|cod4|mwr)$/i, "");
  name = name.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return name;
}

function codGroup(id: string): string {
  const text = codLabel(id).toLowerCase();
  if (/ac-130|drone|helicopter|care package|overwatch|\bims\b|osprey|airstrike|predator|strafe|reaper|sentry|soflam/.test(text)) return "streaks";
  if (/claymore|\bc4\b|semtex|grenade|knife|rpg|javelin|smaw|stinger|xm25|m320|flash|smoke/.test(text)) return "explosives";
  if (/aa-12|ksg|spas|1887|ranger|striker|shotgun/.test(text)) return "shotguns";
  if (/magnum|five seven|\bg18\b|1911|\bm9\b|desert|p99|usp/.test(text)) return "pistols";
  if (/m240|mk46|\bl86\b|m60|minigun/.test(text)) return "heavy";
  if (/as50|barrett|l118|\bmsr\b|dragunov|scoped|rsass|mk14|\bm14\b/.test(text)) return "snipers";
  if (/mp5|mp9|ump|p90|vector|pp90|pm9|fmg|skorpion/.test(text)) return "smgs";
  return "rifles";
}

const PUBG_LABELS: Record<string, string> = {
  UI_behicle_explosion: "Vehicle Explosion",
  UI_buggy: "Buggy",
  UI_throwable_icon_Snowball: "Snowball",
  "UI_weapon_icon_sks (1)": "SKS",
  UI_weapon_icon_akm: "AKM",
  UI_weapon_icon_aug_a3: "AUG A3",
  UI_weapon_icon_awm: "AWM",
  UI_weapon_icon_beryl_m762: "Beryl M762",
  UI_weapon_icon_dp: "DP-28",
  "UI_weapon_icon_dp-28": "DP-28",
  UI_weapon_icon_dbs: "DBS",
  UI_weapon_icon_g36c: "G36C",
  UI_weapon_icon_groza: "Groza",
  UI_weapon_icon_kar98k: "Kar98k",
  UI_weapon_icon_m16a4: "M16A4",
  UI_weapon_icon_m24: "M24",
  UI_weapon_icon_m249: "M249",
  UI_weapon_icon_m416: "M416",
  UI_weapon_icon_mg3: "MG3",
  UI_weapon_icon_mp5k: "MP5K",
  UI_weapon_icon_p90: "P90",
  UI_weapon_icon_qbu: "QBU",
  UI_weapon_icon_qbz95: "QBZ95",
  UI_weapon_icon_s12k: "S12K",
  UI_weapon_icon_sks: "SKS",
  UI_weapon_icon_slr: "SLR",
  UI_weapon_icon_ump9: "UMP",
  UI_weapon_icon_vss: "VSS",
  UI_weapon_icon_mini_14: "Mini 14",
  UI_weapon_icon_mk12: "Mk12",
  UI_weapon_icon_mk14_ebr: "Mk14 EBR",
  UI_weapon_icon_mk47_mutant: "Mk47 Mutant",
  UI_weapon_icon_micro_uzi: "Micro Uzi",
  "UI_weapon_icon_PP-19_Bizon": "PP-19 Bizon",
  "UI_weapon_icon_sawed-off": "Sawed-Off",
};

function pubgLabel(id: string): string {
  if (PUBG_LABELS[id]) return PUBG_LABELS[id];
  const raw = id.replace(/^UI_(weapon_icon|throwable_icon|behicle)_/i, "").replace(/^UI_/, "");
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pubgGroup(id: string): string {
  const text = id.toLowerCase();
  if (/buggy|behicle/.test(text)) return "world";
  if (/grenade|molotov|sticky|snowball|stun|smoke|decoy|panzer|mortar|flare/.test(text)) return "throwables";
  if (/crowbar|machete|pan|sickle/.test(text)) return "melee";
  if (/s12k|s1897|s686|dbs|sawed/.test(text)) return "shotguns";
  if (/p18c|p1911|p92|r1895|r45|skorpion/.test(text)) return "pistols";
  if (/uzi|mp5|vector|ump|tommy|bizon|p90/.test(text)) return "smgs";
  if (/awm|kar98|m24|mini_14|mk12|sks|slr|qbu|vss|lynx|crossbow/.test(text)) return "snipers";
  if (/m249|dp-28|mg3/.test(text)) return "lmgs";
  return "rifles";
}

function rustGroup(id: string): string {
  const text = id.toLowerCase();
  if (/snowball gun/.test(text)) return "guns";
  if (/grenade|satchel|explosive|rocket/.test(text)) return "explosives";
  if (/bow|crossbow/.test(text)) return "bows";
  if (/rifle|smg|pistol|shotgun|m249|m39|m92|mp5|thompson|revolver|python|nailgun|l96|lr-300/.test(text)) return "guns";
  if (/jackhammer|chainsaw|pickaxe|hatchet|hammer|icepick|paddle|torch|rock/.test(text)) return "tools";
  return "melee";
}

function weaponsOf(
  files: Record<string, string>,
  labelOf: (id: string) => string,
  groupOf: (id: string) => string,
  order: string[],
): BarWeapon[] {
  return Object.entries(files)
    .map(([path, url]) => {
      const id = stemOf(path);
      return { id, label: labelOf(id), group: groupOf(id), url };
    })
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function extrasOf(files: Record<string, string>, order: { id: string; label: string }[]): BarExtra[] {
  const urls = new Map(Object.entries(files).map(([path, url]) => [stemOf(path), url]));
  return order.map((extra) => {
    const url = urls.get(extra.id);
    if (!url) throw new Error(`No killfeed extra ${extra.id}`);
    return { ...extra, place: "suffix", url };
  });
}

function heightOf(style: BarStyle): number {
  return style.icon + style.padY * 2 + style.border * 2;
}

const COD_GROUPS = [
  { id: "rifles", label: msg("Rifles") },
  { id: "smgs", label: msg("SMGs") },
  { id: "snipers", label: msg("Snipers") },
  { id: "shotguns", label: msg("Shotguns") },
  { id: "pistols", label: msg("Pistols") },
  { id: "heavy", label: msg("Heavy") },
  { id: "explosives", label: msg("Explosives") },
  { id: "streaks", label: msg("Streaks") },
];

const PUBG_GROUPS = [
  { id: "rifles", label: msg("Rifles") },
  { id: "smgs", label: msg("SMGs") },
  { id: "snipers", label: msg("Snipers") },
  { id: "shotguns", label: msg("Shotguns") },
  { id: "lmgs", label: msg("LMGs") },
  { id: "pistols", label: msg("Pistols") },
  { id: "melee", label: msg("Melee") },
  { id: "throwables", label: msg("Throwables") },
  { id: "world", label: msg("World") },
];

const RUST_GROUPS = [
  { id: "guns", label: msg("Guns") },
  { id: "bows", label: msg("Bows") },
  { id: "melee", label: msg("Melee") },
  { id: "explosives", label: msg("Explosives") },
  { id: "tools", label: msg("Tools") },
];

const codStyle: BarStyle = {
  fontFamily: "Conduit ITC",
  fontUrl: conduitUrl,
  fontWeight: 500,
  fontSize: 17,
  icon: 25,
  padX: 10,
  padY: 4,
  gap: 10,
  border: 2,
  radius: 0,
  background: "rgba(12, 12, 12, 0.6)",
  borderColor: "rgba(29, 29, 29, 0.05)",
  killer: "#ffffff",
  victim: "#ffffff",
  shadow: 0,
  flipWeapon: false,
};

const pubgStyle: BarStyle = {
  fontFamily: "Roboto Medium",
  fontUrl: robotoUrl,
  fontWeight: 500,
  fontSize: 17,
  icon: 30,
  padX: 10,
  padY: 5,
  gap: 10,
  border: 2,
  radius: 0,
  background: "rgba(12, 12, 12, 0.7)",
  borderColor: "rgba(29, 29, 29, 0.8)",
  killer: "#e7eef3",
  victim: "#f6f0ea",
  shadow: 0,
  flipWeapon: true,
};

const rustStyle: BarStyle = {
  fontFamily: "Roboto Condensed",
  fontUrl: robotoCondensedUrl,
  fontWeight: 600,
  fontSize: 18,
  icon: 30,
  padX: 14,
  padY: 5,
  gap: 10,
  border: 2,
  radius: 0,
  background: "rgba(12, 12, 12, 0.7)",
  borderColor: "rgba(29, 29, 29, 0.6)",
  killer: "#fff8e0",
  victim: "#fff0f0",
  shadow: 0,
  flipWeapon: false,
};

export const BAR_GAMES: BarGame[] = [
  {
    id: "codmw3",
    game: "Call of Duty",
    summary: "Death notices the way they look in Modern Warfare, dropped onto your clip.",
    stackName: "CoD Killfeed",
    style: codStyle,
    weapons: weaponsOf(codFiles, codLabel, codGroup, COD_GROUPS.map((group) => group.id)),
    groups: COD_GROUPS,
    extras: extrasOf(codExtras, [{ id: "Headshot", label: msg("Headshot") }]),
    defaultWeapon: "AK-47_HUD_icon_MW3",
    anchor: "bottom-left",
    top: 72,
    bottom: 150,
    entryHeight: heightOf(codStyle),
    coverExtras: ["Headshot"],
    previewBackground: "radial-gradient(120% 140% at 50% 100%, #2A241C 0%, #100E0C 72%)",
    coverBackground:
      "radial-gradient(120% 140% at 80% 0%, #2A241C 0%, #100E0C 72%)",
  },
  {
    id: "pubg",
    game: "PUBG",
    summary: "Death notices the way they look in game, dropped onto your clip.",
    stackName: "PUBG Killfeed",
    style: pubgStyle,
    weapons: weaponsOf(pubgFiles, pubgLabel, pubgGroup, PUBG_GROUPS.map((group) => group.id)),
    groups: PUBG_GROUPS,
    extras: extrasOf(pubgExtras, [
      { id: "Headshot", label: msg("Headshot") },
      { id: "No Scope", label: msg("No Scope") },
    ]),
    defaultWeapon: "UI_weapon_icon_akm",
    anchor: "top-right",
    top: 72,
    bottom: 150,
    entryHeight: heightOf(pubgStyle),
    coverExtras: ["Headshot"],
    previewBackground: "radial-gradient(120% 140% at 50% 0%, #2A2618 0%, #100E0C 72%)",
    coverBackground:
      "radial-gradient(120% 140% at 20% 0%, #2A2618 0%, #100E0C 72%)",
  },
  {
    id: "rust",
    game: "Rust",
    summary: "Death notices the way they look in game, dropped onto your clip.",
    stackName: "Rust Killfeed",
    style: rustStyle,
    weapons: weaponsOf(rustFiles, (id) => id, rustGroup, RUST_GROUPS.map((group) => group.id)),
    groups: RUST_GROUPS,
    extras: extrasOf(rustExtras, [
      { id: "Head", label: msg("Headshot") },
      { id: "No Scope", label: msg("No Scope") },
    ]),
    defaultWeapon: "Assault Rifle",
    anchor: "top-right",
    top: 72,
    bottom: 150,
    entryHeight: heightOf(rustStyle),
    coverExtras: ["Head"],
    previewBackground: "radial-gradient(120% 140% at 50% 0%, #2C221C 0%, #120E0C 72%)",
    coverBackground:
      "radial-gradient(120% 140% at 20% 0%, #2C221C 0%, #120E0C 72%)",
  },
];

export function barGame(id: string): BarGame | undefined {
  return BAR_GAMES.find((game) => game.id === id);
}
