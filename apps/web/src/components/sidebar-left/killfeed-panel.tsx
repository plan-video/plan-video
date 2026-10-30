/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, on } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { Icon } from "@/components/ui/icon";
import {
  AddButton,
  MoreOptions,
  OptionList,
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
import { addLabel, createKillfeedFeed, FeedField, FeedStage, feedDrag } from "./killfeed-feed";
import { PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_PLACEMENT,
  insertKillfeeds,
  type KillfeedAnimation,
  type KillfeedLayout,
  type KillfeedPlacement,
} from "@/engine/killfeed";
import { DEFAULT_KILLFEED, KILLFEED_MAX_KILLS, renderKillfeed, USUAL_KILLFEED, type KillfeedPlayer, type KillfeedSpec } from "@/lib/killfeed";
import {
  KILLFEED_AGENTS,
  killfeedAgent,
  killfeedCategories,
  killfeedUi,
  killfeedWeapon,
  killfeedWeapons,
  type KillfeedWeaponGroup,
} from "@/lib/killfeed-assets";
import { plain } from "@/lib/killfeed-feed";
import { msg, t } from "@/lib/i18n";

export const KILLFEED_DRAG_TYPE = "application/x-plan-killfeed";

/** Kept across tab switches, so the next kill starts from the last one. */
const feed = createKillfeedFeed<KillfeedSpec>(structuredClone(DEFAULT_KILLFEED));
const { spec, set: setSpec } = feed;
const [placement, setPlacement] = createStore<KillfeedPlacement>(structuredClone(DEFAULT_PLACEMENT));

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

const nextKill = (copy: KillfeedSpec) => {
  copy.kills = Math.min(KILLFEED_MAX_KILLS, copy.kills + 1);
};

export function KillfeedPanel() {
  const world = useWorld();
  const [adding, setAdding] = createSignal(false);
  const [picking, setPicking] = createSignal<Role | null>(null);

  const add = async () => {
    setAdding(true);
    try {
      const placed = await insertKillfeeds(world, plain(feed.entries()), { placement, spacing: feed.spacing() });
      if (!placed.length) toast(t("Nothing to add it to"), { description: t("Open a scene first.") });
    } catch (error) {
      toast.error(t("Could not add the killfeed"), { description: (error as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const swap = () => {
    const killer = { ...spec().killer };
    setSpec("killer", { ...spec().victim });
    setSpec("victim", killer);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <FeedStage
          feed={feed}
          background="radial-gradient(120% 140% at 50% 0%, #1F2B36 0%, #0B0F14 70%)"
          draw={renderKillfeed}
          usual={USUAL_KILLFEED}
          scale={1}
          align={placement.layout === "valorant" ? "right" : "left"}
          onDragStart={handleDragStart}
        />

        <div class="flex flex-col gap-5 px-3 pb-4 pt-1">
          <FeedField feed={feed} next={nextKill} />

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
                onChange={(player) => setSpec("killer", player)}
              />
              <Show when={!spec().suicide}>
                <PlayerRow
                  role="victim"
                  label={t("Victim")}
                  player={spec().victim}
                  open={picking() === "victim"}
                  onOpenChange={(open) => setPicking(open ? "victim" : null)}
                  onChange={(player) => setSpec("victim", player)}
                />
              </Show>
            </div>
          </Section>

          <WeaponSection />

          <Section label={t("Extras")}>
            <ToggleGrid count={3}>
              <Toggle label={t("Headshot")} icon={killfeedUi("headshot")} on={spec().headshot} onChange={(on) => setSpec("headshot", on)} />
              <Toggle label={t("Wallbang")} icon={killfeedUi("wallbang")} on={spec().wallbang} onChange={(on) => setSpec("wallbang", on)} />
              <Toggle label={t("It's me")} swatch="#E7ED83" on={spec().highlight} onChange={(on) => setSpec("highlight", on)} />
            </ToggleGrid>
          </Section>

          <MoreOptions>
            <Row label={t("Kill streak")}>
              <Stepper label={t("Kill streak")} value={spec().kills} min={1} max={KILLFEED_MAX_KILLS} onChange={(kills) => setSpec("kills", kills)} />
            </Row>
            <Row label={t("Layout")}>
              <Segmented options={LAYOUTS} value={placement.layout} onChange={(layout) => setPlacement("layout", layout)} />
            </Row>
            <Row label={t("Animation")}>
              <Segmented options={ANIMATIONS} value={placement.animation} onChange={(animation) => setPlacement("animation", animation)} />
            </Row>
          </MoreOptions>
        </div>
      </div>

      <AddButton label={addLabel(feed)} busy={adding()} onClick={() => void add()} />
    </div>
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

function WeaponSection() {
  const current = killfeedWeapon(spec().weapon);
  const [group, setGroup] = createSignal<KillfeedWeaponGroup>(current?.group ?? "weapons");
  const [category, setCategory] = createSignal(current?.category ?? "");
  createEffect(
    on(feed.selected, () => {
      const weapon = killfeedWeapon(spec().weapon);
      if (!weapon) return;
      setGroup(weapon.group);
      setCategory(weapon.category);
    }, { defer: true }),
  );

  const tab = (): WeaponTab => (group() === "abilities" ? "abilities" : "weapons");
  const categories = () => killfeedCategories(group());
  const activeCategory = () => {
    const options = categories();
    if (!options.length) return undefined;
    return options.some((option) => option.id === category()) ? category() : options[0]!.id;
  };

  const selectTab = (next: WeaponTab) => {
    const weapon = killfeedWeapon(spec().weapon);
    if (weapon && (weapon.group === "abilities") === (next === "abilities")) {
      setGroup(weapon.group);
      return setCategory(weapon.category);
    }
    const options = killfeedCategories(next);
    const own = next === "abilities" ? options.find((option) => agentKey(option.label) === agentKey(spec().killer.agent)) : undefined;
    setGroup(next);
    setCategory(own?.id ?? options[0]?.id ?? "");
  };

  const classes = () => [...killfeedCategories("weapons"), SPECIAL];
  const activeClass = () => (group() === "special" ? SPECIAL.id : (activeCategory() ?? ""));
  const selectClass = (id: string) => {
    setGroup(id === SPECIAL.id ? "special" : "weapons");
    setCategory(id === SPECIAL.id ? "" : id);
  };

  const owners = () => categories().map((option) => ({ id: option.id, label: option.label, url: agentNamed(option.label)?.icon ?? "" }));
  const owner = () => categories().find((option) => option.id === activeCategory())?.label ?? "";

  const selected = () => (spec().weapon ? killfeedWeapon(spec().weapon) : undefined);
  const choose = (id: string) => setSpec("weapon", spec().weapon === id ? "" : id);

  return (
    <Section
      label={t("Weapon")}
      action={
        <Show when={selected()}>
          {(weapon) => (
            <span class="flex min-w-0 items-center gap-1 text-xs text-foreground">
              <span class="truncate">{weapon().label}</span>
              <button
                type="button"
                aria-label={t("No weapon")}
                title={t("No weapon")}
                class="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-ring"
                onClick={() => setSpec("weapon", "")}
              >
                <Icon name="close-remove-small" class="size-4" />
              </button>
            </span>
          )}
        </Show>
      }
    >
      <Segmented options={WEAPON_TABS} value={tab()} onChange={selectTab} label={t("Weapon type")} />
      <Show
        when={tab() === "abilities"}
        fallback={
          <PickRow label={t("Class")} value={t(classes().find((option) => option.id === activeClass())?.label ?? "")} title={t("Weapon class")}>
            {(close) => (
              <OptionList
                label={t("Weapon class")}
                options={classes()}
                value={activeClass()}
                onChange={(id) => {
                  selectClass(id);
                  close();
                }}
              />
            )}
          </PickRow>
        }
      >
        <PickRow label={t("Agent")} value={owner()} icon={agentNamed(owner())?.icon} title={t("Choose agent")}>
          {(close) => (
            <PictureList
              label={t("Agents")}
              options={owners()}
              value={activeCategory()}
              onChange={(id) => {
                setCategory(id);
                close();
              }}
            />
          )}
        </PickRow>
      </Show>
      <WeaponGrid>
        <For each={killfeedWeapons(group(), activeCategory())}>
          {(weapon) => (
            <WeaponTile
              label={weapon.label}
              url={weapon.url}
              flip={weapon.group === "weapons"}
              selected={spec().weapon === weapon.id}
              onClick={() => choose(weapon.id)}
            />
          )}
        </For>
      </WeaponGrid>
    </Section>
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
