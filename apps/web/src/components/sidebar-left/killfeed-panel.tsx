/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { getActiveEntity, isScene } from "@plan.video/runtime";

import { Icon } from "@/components/ui/icon";
import {
  AddButton,
  MoreOptions,
  PickPanel,
  PickRow,
  PictureList,
  Row,
  Section,
  Segmented,
  Stepper,
  SwapButton,
  Toggle,
  ToggleGrid,
  WeaponGrid,
  WeaponTile,
} from "./extension-ui";
import { addLabel, createKillfeedFeed, feedDrag, KillList } from "./killfeed-feed";
import { PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_PLACEMENT,
  insertKillfeeds,
  type KillfeedAnimation,
  type KillfeedLayout,
  type KillfeedPlacement,
} from "@/engine/killfeed";
import { findKills, type SceneKill } from "@/engine/kill-scan";
import { DEFAULT_KILLFEED, KILLFEED_HEIGHT, KILLFEED_MAX_KILLS, renderKillfeed, type KillfeedPlayer, type KillfeedSpec } from "@/lib/killfeed";
import {
  KILLFEED_AGENTS,
  killfeedAgent,
  killfeedCategories,
  killfeedUi,
  killfeedWeapon,
  killfeedWeapons,
} from "@/lib/killfeed-assets";
import { MAX_FEED_ENTRIES, plain, USUAL_NAME } from "@/lib/killfeed-feed";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";

export const KILLFEED_DRAG_TYPE = "application/x-plan-killfeed";

/** A kill found in the video comes in when it happened there, in scene seconds. */
type FeedKill = KillfeedSpec & { at?: number };

/** Kept across tab switches, so the next kill starts from the last one. */
const feed = createKillfeedFeed<FeedKill>(structuredClone(DEFAULT_KILLFEED));
const { spec, set: setSpec } = feed;
const [placement, setPlacement] = createStore<KillfeedPlacement>(structuredClone(DEFAULT_PLACEMENT));
/** Whether the picked kill shows its settings; kills found in a video start folded, so the whole list shows. */
const [open, setOpen] = createSignal(true);

const LAYOUTS: { id: KillfeedLayout; label: string }[] = [
  { id: "stacked", label: msg("Same size") },
  { id: "valorant", label: msg("In game") },
];

const ANIMATIONS: { id: KillfeedAnimation; label: string }[] = [
  { id: "none", label: msg("None") },
  { id: "slide", label: msg("Slide") },
  { id: "fade", label: msg("Fade") },
];

type KillType = "team" | "enemy" | "self";

const KILL_TYPES: { id: KillType; label: string }[] = [
  { id: "team", label: msg("Team") },
  { id: "enemy", label: msg("Enemy") },
  { id: "self", label: msg("Self") },
];

const killType = (): KillType => (spec().suicide ? "self" : spec().enemyKill ? "enemy" : "team");

function setKillType(type: KillType) {
  setSpec({ suicide: type === "self", enemyKill: type === "enemy" });
}

type WeaponTab = "weapons" | "abilities";

const WEAPON_TABS: { id: WeaponTab; label: string }[] = [
  { id: "weapons", label: msg("Weapons") },
  { id: "abilities", label: msg("Abilities") },
];

const SPECIAL = { id: "special", label: msg("Special") };

const agentKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The agent called `name`, however its letters are cased or marked (KAY/O is Kayo). */
const agentNamed = (name: string) => KILLFEED_AGENTS.find((agent) => agentKey(agent.name) === agentKey(name));

const AGENT_OPTIONS = KILLFEED_AGENTS.map((agent) => ({ id: agent.name, label: agent.name, url: agent.icon }));

// The team colors as the panel shows them: deeper on a light panel, so the labels read.
const TEAL = "light-dark(#0E8F77, #57DEC4)";
const RED = "light-dark(#D63A37, #F05B58)";

type Role = "killer" | "victim";

const roleColor = (role: Role) => ((role === "killer") !== spec().enemyKill ? TEAL : RED);

const nextKill = (copy: FeedKill) => {
  copy.kills = Math.min(KILLFEED_MAX_KILLS, copy.kills + 1);
  delete copy.at;
};

/** The name you gave yourself on a kill you made, if you did, so kills found in the video keep it. */
function ownName(): string | undefined {
  for (const entry of feed.entries()) {
    // A found kill's names were read off the video, not typed.
    if (!entry.highlight || entry.suicide || entry.at !== undefined) continue;
    const me = entry.enemyKill ? entry.victim : entry.killer;
    const name = me.name.trim();
    if (name && name !== USUAL_NAME && name.toLowerCase() !== me.agent.toLowerCase()) return name;
  }
  return undefined;
}

function foundSpec(kill: SceneKill, me: string | undefined): FeedKill {
  // A name you typed yourself wins over the one read off the video; one that couldn't be read is the agent's.
  const player = (agent: string, mine: boolean, read: string | undefined): KillfeedPlayer => ({ agent, name: (mine && me) || read || agent });
  return {
    ...structuredClone(DEFAULT_KILLFEED),
    killer: player(kill.killer, !kill.death, kill.killerName),
    victim: player(kill.victim, kill.death, kill.victimName),
    weapon: kill.weapon,
    kills: Math.max(1, Math.min(KILLFEED_MAX_KILLS, kill.streak)),
    headshot: kill.headshot,
    enemyKill: kill.death,
    highlight: true,
    at: kill.at,
  };
}

const timed = () => feed.entries().some((entry) => entry.at !== undefined);

export function KillfeedPanel() {
  const world = useWorld();
  const [adding, setAdding] = createSignal(false);
  const [picking, setPicking] = createSignal<Role | null>(null);

  const add = async () => {
    setAdding(true);
    try {
      const entries = plain(feed.entries());
      const placed = await insertKillfeeds(world, entries, { placement, spacing: feed.spacing(), starts: entries.map((entry) => entry.at), centered: timed() });
      if (!placed.length) toast(t("Nothing to add it to"), { description: t("Open a scene first.") });
    } catch (error) {
      toast.error(t("Could not add the killfeed"), { description: (error as Error).message });
    } finally {
      setAdding(false);
    }
  };

  // You are one player in every entry: renaming yourself in one renames you wherever you had that name.
  const changePlayer = (role: Role, player: KillfeedPlayer) => {
    const current = spec()[role];
    const mine = spec().highlight && !spec().suicide && (role === "killer") !== spec().enemyKill;
    if (!mine || player.agent !== current.agent || player.name === current.name) return setSpec(role, player);
    const old = current.name;
    feed.updateAll((entry) => {
      if (!entry.highlight || entry.suicide) return;
      const me = entry.enemyKill ? entry.victim : entry.killer;
      if (me.name === old) me.name = player.name;
    });
  };

  const swap = () => {
    const killer = { ...spec().killer };
    setSpec("killer", { ...spec().victim });
    setSpec("victim", killer);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-5 px-3 pb-4 pt-3">
          <div class="flex flex-col gap-3">
            <FindKills />
            <Show when={timed()}>
              <p class="px-0.5 text-xs text-muted-foreground">{foundLabel()}</p>
            </Show>
            <KillList
              feed={feed}
              open={open()}
              onOpenChange={setOpen}
              draw={renderKillfeed}
              scale={1 / KILLFEED_HEIGHT}
              at={(entry) => entry.at}
              next={nextKill}
              onDragStart={handleDragStart}
            >
              <Row label={t("Kill")}>
                <Segmented options={KILL_TYPES} value={killType()} onChange={setKillType} />
              </Row>

              <Section label={t("Players")} action={<Show when={!spec().suicide}><SwapButton onClick={swap} /></Show>}>
                <div class="flex flex-col gap-1.5">
                  <PlayerRow
                    role="killer"
                    label={spec().suicide ? t("Player") : t("Killer")}
                    player={spec().killer}
                    open={picking() === "killer"}
                    onOpenChange={(open) => setPicking(open ? "killer" : null)}
                    onChange={(player) => changePlayer("killer", player)}
                  />
                  <Show when={!spec().suicide}>
                    <PlayerRow
                      role="victim"
                      label={t("Victim")}
                      player={spec().victim}
                      open={picking() === "victim"}
                      onOpenChange={(open) => setPicking(open ? "victim" : null)}
                      onChange={(player) => changePlayer("victim", player)}
                    />
                  </Show>
                </div>
              </Section>

              <WeaponPick />

              <ToggleGrid count={3}>
                <Toggle label={t("Headshot")} icon={killfeedUi("headshot")} on={spec().headshot} onChange={(on) => setSpec("headshot", on)} />
                <Toggle label={t("Wallbang")} icon={killfeedUi("wallbang")} on={spec().wallbang} onChange={(on) => setSpec("wallbang", on)} />
                <Toggle label={t("It's me")} swatch="#E7ED83" on={spec().highlight} onChange={(on) => setSpec("highlight", on)} />
              </ToggleGrid>

              <Row label={t("Kill streak")}>
                <Stepper label={t("Kill streak")} value={spec().kills} min={1} max={KILLFEED_MAX_KILLS} onChange={(kills) => setSpec("kills", kills)} />
              </Row>
            </KillList>
          </div>

          <MoreOptions>
            <Row label={t("Layout")}>
              <Segmented options={LAYOUTS} value={placement.layout} onChange={(layout) => setPlacement("layout", layout)} />
            </Row>
            <Row label={t("Animation")}>
              <Segmented options={ANIMATIONS} value={placement.animation} onChange={(animation) => setPlacement("animation", animation)} />
            </Row>
          </MoreOptions>
        </div>
      </div>

      <AddButton
        label={
          timed()
            ? t("{count, plural, one {Add # kill where it happens} other {Add # kills where they happen}}", { count: feed.entries().length })
            : addLabel(feed)
        }
        busy={adding()}
        onClick={() => void add()}
      />
    </div>
  );
}

/** What the video gave: kills found in it and not since removed. */
function foundLabel(): string {
  const found = feed.entries().filter((entry) => entry.at !== undefined);
  const deaths = found.filter((entry) => entry.enemyKill).length;
  const count = found.length - deaths;
  return deaths
    ? t("Found {count, plural, one {# kill} other {# kills}} and {deaths, plural, one {# death} other {# deaths}}", { count, deaths })
    : t("{count, plural, one {Found # kill} other {Found # kills}}", { count });
}

/** Reads the scene's video for your kills and deaths, and fills the feed with them. */
function FindKills() {
  const world = useWorld();
  const [progress, setProgress] = createSignal<number | null>(null);

  const find = async () => {
    const scene = getActiveEntity(world);
    if (!scene || !isScene(scene)) {
      toast(t("Nothing to read"), { description: t("Open a scene first.") });
      return;
    }
    setProgress(0);
    try {
      const kills = await findKills(world, scene, setProgress);
      if (!kills) {
        toast(t("No video to read"), { description: t("Add a Valorant clip to the scene first.") });
        return;
      }
      if (!kills.length) {
        toast(t("No kills found"), { description: t("Kills are read from Valorant's killfeed in the top right of the video, so it has to show there.") });
        return;
      }
      const me = ownName();
      feed.replace(kills.map((kill) => foundSpec(kill, me)));
      setOpen(false);
      const deaths = kills.filter((kill) => kill.death).length;
      const count = kills.length - deaths;
      toast.success(
        deaths
          ? t("Found {count, plural, one {# kill} other {# kills}} and {deaths, plural, one {# death} other {# deaths}}", { count, deaths })
          : t("{count, plural, one {Found # kill} other {Found # kills}}", { count }),
        {
          description: kills.length > MAX_FEED_ENTRIES
            ? t("The killfeed holds {max}, so the first {max} are in it.", { max: MAX_FEED_ENTRIES })
            : t("Check the names, then add them where they happen."),
        },
      );
    } catch (error) {
      toast.error(t("Could not read the video"), { description: (error as Error).message });
    } finally {
      setProgress(null);
    }
  };

  return (
    <button
      type="button"
      class="flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-foreground transition-colors hover:bg-secondary-hover focus-ring disabled:opacity-60"
      disabled={progress() !== null}
      onClick={() => void find()}
    >
      <Icon name={progress() === null ? "search" : "spinner-loader"} class={cx("-ml-1 size-5 shrink-0", progress() !== null && "animate-spin")} />
      <span class="min-w-0 truncate tabular-nums">
        {progress() === null
          ? t("Find kills in the video")
          : t("Reading the video… {percent}%", { percent: Math.round((progress() ?? 0) * 100) })}
      </span>
    </button>
  );
}

const handleDragStart = (event: DragEvent) => {
  event.dataTransfer?.setData(KILLFEED_DRAG_TYPE, JSON.stringify(feedDrag(feed, placement)));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
};

const COVER_KILLFEED: KillfeedSpec = { ...DEFAULT_KILLFEED, headshot: true, highlight: true };

export function KillfeedCover() {
  return (
    <div
      class="flex w-full items-center justify-center px-3 py-4"
      style={{ background: "radial-gradient(120% 140% at 50% 0%, #243444 0%, #0B0F14 72%)" }}
    >
      <KillfeedPreview spec={COVER_KILLFEED} />
    </div>
  );
}

function PlayerRow(props: {
  role: Role;
  label: string;
  player: KillfeedPlayer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (player: KillfeedPlayer) => void;
}) {
  const agent = () => killfeedAgent(props.player.agent);
  let row: HTMLDivElement | undefined;

  const choose = (name: string) => {
    const next = killfeedAgent(name);
    if (!next) return;
    const current = props.player.name.trim();
    const follows = !current || current.toLowerCase() === props.player.agent.toLowerCase();
    props.onChange({ agent: next.name, name: follows ? next.name : props.player.name });
    props.onOpenChange(false);
  };

  return (
    <PickPanel
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchor={() => row}
      trigger={
        <div ref={row} class="flex h-10 items-center gap-2 rounded-md bg-input px-1 focus-within:ring-1 focus-within:ring-ring">
          <PopoverTrigger
            as="button"
            type="button"
            aria-label={props.role === "victim" ? t("Choose the victim's agent") : spec().suicide ? t("Choose the player's agent") : t("Choose the killer's agent")}
            title={agent()?.name ?? props.player.agent}
            class="relative size-8 shrink-0 overflow-hidden rounded-[5px] bg-[#0D1014] focus-ring"
            style={{ "box-shadow": `inset 0 0 0 1.5px ${roleColor(props.role)}` }}
          >
            <Show when={agent()}>
              {(current) => <img src={current().icon} alt="" draggable={false} class="size-full object-cover object-top" />}
            </Show>
          </PopoverTrigger>
          <span class="w-11 shrink-0 truncate text-xs font-450" style={{ color: roleColor(props.role) }}>
            {props.label}
          </span>
          <input
            type="text"
            value={props.player.name}
            placeholder={t("Player name")}
            aria-label={t("{role} name", { role: props.label })}
            onInput={(event) => props.onChange({ ...props.player, name: event.currentTarget.value })}
            onKeyDown={(event) => event.stopPropagation()}
            class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          <PopoverTrigger
            as="button"
            type="button"
            aria-label={t("Choose agent")}
            title={t("Choose agent")}
            class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
          >
            <Icon name="chevron-down" class={props.open ? "rotate-180 transition-transform" : "transition-transform"} />
          </PopoverTrigger>
        </div>
      }
    >
      <PictureList label={t("Agents")} options={AGENT_OPTIONS} value={agent()?.name} onChange={choose} />
    </PickPanel>
  );
}

/** One row that opens every weapon and ability, grouped as the buy menu and the agents have them. */
function WeaponPick() {
  const [tab, setTab] = createSignal<WeaponTab>("weapons");
  const selected = () => (spec().weapon ? killfeedWeapon(spec().weapon) : undefined);

  const groups = () =>
    tab() === "abilities"
      ? killfeedCategories("abilities").map((category) => ({
          label: category.label,
          face: agentNamed(category.label)?.icon,
          weapons: killfeedWeapons("abilities", category.id),
        }))
      : [
          ...killfeedCategories("weapons").map((category) => ({ label: category.label, face: undefined, weapons: killfeedWeapons("weapons", category.id) })),
          { label: SPECIAL.label, face: undefined, weapons: killfeedWeapons("special") },
        ];

  return (
    <PickRow label={t("Weapon")} value={selected()?.label ?? t("None")} title={t("Choose weapon")}>
      {(close) => {
        // Opens on the side the picked weapon is on.
        setTab(selected()?.group === "abilities" ? "abilities" : "weapons");
        return (
          <div class="flex flex-col gap-2">
            <Segmented options={WEAPON_TABS} value={tab()} onChange={setTab} label={t("Weapon type")} />
            <div class="flex max-h-72 flex-col gap-3 overflow-y-auto pr-0.5">
              <For each={groups()}>
                {(group) => (
                  <div class="flex flex-col gap-1.5">
                    <span class="flex h-4 items-center gap-1.5 text-xxs text-muted-foreground">
                      <Show when={group.face}>{(face) => <img src={face()} alt="" draggable={false} class="size-4 rounded-[3px] object-cover object-top" />}</Show>
                      {t(group.label)}
                    </span>
                    <WeaponGrid>
                      <For each={group.weapons}>
                        {(weapon) => (
                          <WeaponTile
                            label={weapon.label}
                            url={weapon.url}
                            flip={weapon.group === "weapons"}
                            selected={spec().weapon === weapon.id}
                            onClick={() => {
                              setSpec("weapon", spec().weapon === weapon.id ? "" : weapon.id);
                              close();
                            }}
                          />
                        )}
                      </For>
                    </WeaponGrid>
                  </div>
                )}
              </For>
            </div>
          </div>
        );
      }}
    </PickRow>
  );
}

function KillfeedPreview(props: { spec: KillfeedSpec }) {
  const [src, setSrc] = createSignal<string>();
  let version = 0;

  createEffect(() => {
    const current = JSON.parse(JSON.stringify(props.spec)) as KillfeedSpec;
    const mine = ++version;
    renderKillfeed(current)
      .then((picture) => {
        if (mine === version) setSrc(picture.toDataURL("image/png"));
      })
      .catch(() => {});
  });

  return (
    <Show when={src()}>
      {(url) => <img src={url()} alt={t("Killfeed preview")} draggable={false} class="pointer-events-none max-h-full max-w-full object-contain" />}
    </Show>
  );
}
