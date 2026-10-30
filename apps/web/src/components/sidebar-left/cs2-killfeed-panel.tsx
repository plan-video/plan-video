/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, on } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import {
  AddButton,
  MoreOptions,
  NameRow,
  OptionList,
  PickRow,
  Row,
  Section,
  Segmented,
  SwapButton,
  Toggle,
  ToggleGrid,
  WeaponGrid,
  WeaponTile,
} from "./extension-ui";
import { addLabel, createKillfeedFeed, FeedField, FeedStage, feedDrag } from "./killfeed-feed";
import {
  insertCs2Killfeeds,
  type KillfeedAnimation,
  type KillfeedLayout,
  type KillfeedPlacement,
} from "@/engine/killfeed";
import { DEFAULT_CS2_KILLFEED, renderCs2Killfeed, USUAL_CS2_KILLFEED, type Cs2KillfeedSpec, type Cs2Side } from "@/lib/cs2-killfeed";
import {
  CS2_EXTRAS,
  CS2_WEAPON_GROUPS,
  cs2Weapon,
  cs2Weapons,
  type Cs2WeaponGroup,
} from "@/lib/cs2-killfeed-assets";
import { plain } from "@/lib/killfeed-feed";
import { msg, t } from "@/lib/i18n";

export const CS2_KILLFEED_DRAG_TYPE = "application/x-plan-cs2-killfeed";

/** Kept across tab switches, so the next notice starts from the last one. */
const feed = createKillfeedFeed<Cs2KillfeedSpec>(structuredClone(DEFAULT_CS2_KILLFEED));
const { spec, set: setSpec } = feed;
const [placement, setPlacement] = createStore<KillfeedPlacement>({ layout: "valorant", animation: "slide" });

const LAYOUTS: { id: KillfeedLayout; label: string }[] = [
  { id: "stacked", label: msg("Same size") },
  { id: "valorant", label: msg("In game") },
];

const ANIMATIONS: { id: KillfeedAnimation; label: string }[] = [
  { id: "none", label: msg("None") },
  { id: "slide", label: msg("Slide") },
  { id: "fade", label: msg("Fade") },
];

const SIDES: { id: Cs2Side; label: string }[] = [
  { id: "ct", label: "CT" },
  { id: "t", label: "T" },
];

// The sides' colors as the panel shows them: deeper on a light panel, so the labels read.
const CT = "light-dark(#5A6BA3, #a2aed5)";
const T = "light-dark(#9A6E0C, #f6d180)";

const killerColor = () => (spec().side === "ct" ? CT : T);
const victimColor = () => (spec().side === "ct" ? T : CT);


export function Cs2KillfeedPanel() {
  const world = useWorld();
  const [adding, setAdding] = createSignal(false);

  const add = async () => {
    setAdding(true);
    try {
      const placed = await insertCs2Killfeeds(world, plain(feed.entries()), { placement, spacing: feed.spacing() });
      if (!placed.length) toast(t("Nothing to add it to"), { description: t("Open a scene first.") });
    } catch (error) {
      toast.error(t("Could not add the killfeed"), { description: (error as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const swap = () => {
    const killer = spec().killer;
    setSpec("killer", spec().victim);
    setSpec("victim", killer);
  };

  const toggleExtra = (id: string, on: boolean) => {
    setSpec("extras", (current) => (on ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id)));
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <FeedStage
          feed={feed}
          background="radial-gradient(120% 140% at 50% 0%, #24362C 0%, #101612 72%)"
          draw={renderCs2Killfeed}
          usual={USUAL_CS2_KILLFEED}
          scale={2}
          align={placement.layout === "valorant" ? "right" : "left"}
          onDragStart={handleDragStart}
        />

        <div class="flex flex-col gap-5 px-3 pb-4 pt-1">
          <FeedField feed={feed} />

          <Row label={t("Killer")}>
            <Segmented options={SIDES} value={spec().side} onChange={(side) => setSpec("side", side)} />
          </Row>

          <Section label={t("Players")} action={<SwapButton onClick={swap} />}>
            <div class="flex flex-col gap-1.5">
              <NameRow label={t("Killer")} color={killerColor()} value={spec().killer} onChange={(killer) => setSpec("killer", killer)} />
              <NameRow label={t("Victim")} color={victimColor()} value={spec().victim} onChange={(victim) => setSpec("victim", victim)} />
            </div>
          </Section>

          <WeaponSection />

          <Section label={t("Extras")}>
            <ToggleGrid count={CS2_EXTRAS.length}>
              <For each={CS2_EXTRAS}>
                {(extra) => (
                  <Toggle
                    label={t(extra.label)}
                    icon={extra.url}
                    on={spec().extras.includes(extra.id)}
                    onChange={(on) => toggleExtra(extra.id, on)}
                  />
                )}
              </For>
            </ToggleGrid>
          </Section>

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

      <AddButton label={addLabel(feed)} busy={adding()} onClick={() => void add()} />
    </div>
  );
}

const handleDragStart = (event: DragEvent) => {
  event.dataTransfer?.setData(CS2_KILLFEED_DRAG_TYPE, JSON.stringify(feedDrag(feed, placement)));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
};

const COVER_KILLFEED: Cs2KillfeedSpec = { ...DEFAULT_CS2_KILLFEED, extras: ["Headshot"] };

export function Cs2KillfeedCover() {
  return (
    <div
      class="flex w-full items-center justify-center px-3 py-5"
      style={{
        background:
          "radial-gradient(120% 140% at 20% 0%, #1C3328 0%, #0C100E 72%)",
      }}
    >
      <Cs2Preview spec={COVER_KILLFEED} />
    </div>
  );
}

function WeaponSection() {
  const [group, setGroup] = createSignal<Cs2WeaponGroup>(cs2Weapon(spec().weapon)?.group ?? "rifles");
  createEffect(
    on(feed.selected, () => {
      const weapon = cs2Weapon(spec().weapon);
      if (weapon) setGroup(weapon.group);
    }, { defer: true }),
  );
  const selected = () => cs2Weapon(spec().weapon);

  return (
    <Section
      label={t("Weapon")}
      action={
        <Show when={selected()}>
          {(weapon) => <span class="truncate text-xs text-foreground">{weapon().label}</span>}
        </Show>
      }
    >
      <PickRow label={t("Group")} value={t(CS2_WEAPON_GROUPS.find((option) => option.id === group())?.label ?? "")} title={t("Weapon type")}>
        {(close) => (
          <OptionList
            label={t("Weapon type")}
            options={CS2_WEAPON_GROUPS}
            value={group()}
            onChange={(id) => {
              setGroup(id);
              close();
            }}
          />
        )}
      </PickRow>
      <WeaponGrid>
        <For each={cs2Weapons(group())}>
          {(weapon) => (
            <WeaponTile label={weapon.label} url={weapon.url} selected={spec().weapon === weapon.id} onClick={() => setSpec("weapon", weapon.id)} />
          )}
        </For>
      </WeaponGrid>
    </Section>
  );
}

function Cs2Preview(props: { spec: Cs2KillfeedSpec }) {
  const [src, setSrc] = createSignal<string>();
  let version = 0;

  createEffect(() => {
    const current = JSON.parse(JSON.stringify(props.spec)) as Cs2KillfeedSpec;
    const mine = ++version;
    renderCs2Killfeed(current, 2)
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
