/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, on, type Component } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { Icon } from "@/components/ui/icon";
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
import { insertBarKillfeeds, type KillfeedAnimation, type KillfeedLayout, type KillfeedPlacement } from "@/engine/killfeed";
import { BAR_GAMES, type BarGame } from "@/lib/bar-killfeed-assets";
import { defaultBarSpec, renderBarKillfeed, usualBarSpec, type BarSpec } from "@/lib/bar-killfeed";
import { plain } from "@/lib/killfeed-feed";
import { msg, t } from "@/lib/i18n";

export const BAR_KILLFEED_DRAG_TYPE = "application/x-plan-bar-killfeed";

const ANIMATIONS: { id: KillfeedAnimation; label: string }[] = [
  { id: "none", label: msg("None") },
  { id: "slide", label: msg("Slide") },
  { id: "fade", label: msg("Fade") },
];

function inGameLayout(game: BarGame): KillfeedLayout {
  return game.anchor === "bottom-left" ? "bottomLeft" : "valorant";
}

function createBarKillfeed(game: BarGame): { Panel: Component; Cover: Component } {
  /** Kept across tab switches. */
  const feed = createKillfeedFeed<BarSpec>(defaultBarSpec(game));
  const { spec, set: setSpec } = feed;
  const [placement, setPlacement] = createStore<KillfeedPlacement>({ layout: inGameLayout(game), animation: "slide" });
  const [query, setQuery] = createSignal("");

  const layoutOptions: { id: KillfeedLayout; label: string }[] = [
    { id: "stacked", label: msg("Same size") },
    { id: inGameLayout(game), label: msg("In game") },
  ];

  const dragPayload = () => JSON.stringify({ id: game.id, ...feedDrag(feed, placement) });

  const groups = game.groups.filter((group) => game.weapons.some((weapon) => weapon.group === group.id));

  function Panel() {
    const world = useWorld();
    const [adding, setAdding] = createSignal(false);
    const [group, setGroup] = createSignal(groups[0]?.id ?? "");
    createEffect(
      on(feed.selected, () => {
        const weapon = game.weapons.find((item) => item.id === spec().weapon);
        if (!weapon || !groups.some((option) => option.id === weapon.group)) return;
        setGroup(weapon.group);
        setQuery("");
      }, { defer: true }),
    );

    const shown = createMemo(() => {
      const words = query().toLowerCase().split(/\s+/).filter(Boolean);
      return game.weapons.filter((weapon) => {
        if (!words.length && weapon.group !== group()) return false;
        const text = weapon.label.toLowerCase();
        return words.every((word) => text.includes(word));
      });
    });

    const add = async () => {
      setAdding(true);
      try {
        const placed = await insertBarKillfeeds(world, game.id, plain(feed.entries()), { placement, spacing: feed.spacing() });
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

    const selected = () => game.weapons.find((weapon) => weapon.id === spec().weapon);

    let weaponRow: HTMLDivElement | undefined;
    const groupLabel = () => t(groups.find((option) => option.id === group())?.label ?? "");

    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <FeedStage
            feed={feed}
            background={game.previewBackground}
            draw={(entry, scale, width) => renderBarKillfeed(game, entry, scale, width)}
            usual={usualBarSpec(game)}
            scale={2}
            align={placement.layout === "valorant" ? "right" : "left"}
            upwards={placement.layout === "bottomLeft"}
            onDragStart={handleDragStart}
          />

          <div class="flex flex-col gap-5 px-3 pb-4 pt-1">
            <FeedField feed={feed} />

            <Section label={t("Players")} action={<SwapButton onClick={swap} />}>
              <div class="flex flex-col gap-1.5">
                <NameRow label={t("Killer")} color={nameColor(game.style.killer)} value={spec().killer} onChange={(killer) => setSpec("killer", killer)} />
                <NameRow label={t("Victim")} color={nameColor(game.style.victim)} value={spec().victim} onChange={(victim) => setSpec("victim", victim)} />
              </div>
            </Section>

            <Section label={t("Weapon")} action={<span class="truncate text-xs text-foreground">{selected()?.label}</span>}>
              <div ref={weaponRow} class="flex gap-1.5">
                <label class="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pl-1 pr-2 focus-within:ring-1 focus-within:ring-ring">
                  <Icon name="search" class="shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                    placeholder={t("Search")}
                    aria-label={t("Search weapons")}
                    autocomplete="off"
                    class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <Show when={groups.length > 1}>
                  <div class="w-[42%] shrink-0">
                    <PickRow value={groupLabel()} title={t("Weapon group")} dim={!!query().trim()} anchor={() => weaponRow}>
                      {(close) => (
                        <OptionList
                          label={t("Weapon group")}
                          options={groups}
                          value={group()}
                          onChange={(id) => {
                            setGroup(id);
                            setQuery("");
                            close();
                          }}
                        />
                      )}
                    </PickRow>
                  </div>
                </Show>
              </div>
              <WeaponGrid>
                <For each={shown()}>
                  {(weapon) => (
                    <WeaponTile label={weapon.label} url={weapon.url} selected={spec().weapon === weapon.id} onClick={() => setSpec("weapon", weapon.id)} />
                  )}
                </For>
              </WeaponGrid>
            </Section>

            <Show when={game.extras.length}>
              <Section label={t("Extras")}>
                <ToggleGrid count={game.extras.length}>
                  <For each={game.extras}>
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
            </Show>

            <MoreOptions>
              <Row label={t("Layout")}>
                <Segmented options={layoutOptions} value={placement.layout} onChange={(layout) => setPlacement("layout", layout)} />
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
    event.dataTransfer?.setData(BAR_KILLFEED_DRAG_TYPE, dragPayload());
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  };

  const coverSpec: BarSpec = { ...defaultBarSpec(game), extras: game.coverExtras };

  function Cover() {
    return (
      <div class="flex w-full items-center justify-center px-3 py-5" style={{ background: game.coverBackground }}>
        <Notice spec={coverSpec} />
      </div>
    );
  }

  function Notice(props: { spec: BarSpec }) {
    const [src, setSrc] = createSignal<string>();
    let version = 0;

    createEffect(() => {
      const current = JSON.parse(JSON.stringify(props.spec)) as BarSpec;
      const mine = ++version;
      renderBarKillfeed(game, current, 2)
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

  return { Panel, Cover };
}

const cod = createBarKillfeed(BAR_GAMES[0]!);
const pubg = createBarKillfeed(BAR_GAMES[1]!);
const rust = createBarKillfeed(BAR_GAMES[2]!);

export const CodKillfeedPanel = cod.Panel;
export const CodKillfeedCover = cod.Cover;
export const PubgKillfeedPanel = pubg.Panel;
export const PubgKillfeedCover = pubg.Cover;
export const RustKillfeedPanel = rust.Panel;
export const RustKillfeedCover = rust.Cover;

/** The games draw names in near-white, which a light panel cannot show. */
const nameColor = (color: string) => `light-dark(var(--muted-foreground), ${color})`;
