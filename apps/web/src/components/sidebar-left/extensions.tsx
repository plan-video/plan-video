/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";

import { SidebarTabs } from "@/agent-chat";
import { Icon } from "@/components/ui/icon";
import { EXTENSIONS, openExtension, setOpenExtension, type Extension } from "@/extensions";
import { t } from "@/lib/i18n";

export function ExtensionsPanel() {
  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <Show
        when={openExtension()}
        keyed
        fallback={
          <>
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <div class="flex min-w-0 flex-1 items-center">
                <SidebarTabs />
              </div>
            </div>
            <Market />
          </>
        }
      >
        {(extension) => <OpenExtension extension={extension} />}
      </Show>
    </div>
  );
}

function OpenExtension(props: { extension: Extension }) {
  return (
    <>
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-2 pr-4">
        <button
          type="button"
          aria-label={t("Back to extensions")}
          title={t("All extensions")}
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
          onClick={() => setOpenExtension(null)}
        >
          <Icon name="chevron-left" />
        </button>
        <span class="min-w-0 truncate text-[13px] font-medium text-foreground">{t(props.extension.name)}</span>
        <Show when={props.extension.tag}>{(tag) => <TagBadge tag={tag()} />}</Show>
      </div>
      <Dynamic component={props.extension.Panel} />
    </>
  );
}

function Market() {
  const [query, setQuery] = createSignal("");

  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    return EXTENSIONS.filter((extension) => {
      if (extension.unlisted) return false;
      const text = `${t(extension.name)} ${extension.tag ?? ""} ${t(extension.summary)}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex flex-col gap-3 p-4">
        <label class="flex h-7 items-center gap-1 rounded-md bg-input pl-1 pr-2 focus-within:ring-1 focus-within:ring-ring">
          <Icon name="search" class="text-muted-foreground" />
          <input
            type="text"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("Search extensions")}
            aria-label={t("Search extensions")}
            autocomplete="off"
            class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        <Show
          when={shown().length}
          fallback={<span class="py-6 text-center text-xs text-muted-foreground">{t("No extensions match that.")}</span>}
        >
          <div class="flex min-w-0 flex-col gap-3">
            <For each={shown()}>{(extension) => <ExtensionCard extension={extension} />}</For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ExtensionCard(props: { extension: Extension }) {
  return (
    <button
      type="button"
      title={t(props.extension.summary)}
      class="group flex w-full min-w-0 flex-col gap-1 rounded-lg border border-foreground/8 bg-secondary p-1 text-left transition-colors hover:border-foreground/16 hover:bg-secondary-hover focus-ring"
      onClick={() => setOpenExtension(props.extension.id)}
    >
      {/* The covers size themselves for a tall card; here they fill the tile. */}
      <div class="relative h-20 w-full overflow-hidden rounded-md bg-black [&>*:first-child]:h-full [&>*:first-child]:py-3">
        <Dynamic component={props.extension.Cover} />
      </div>
      <div class="flex h-7 w-full min-w-0 items-center gap-1.5 pl-1.5 pr-1">
        <span class="min-w-0 truncate text-xs font-medium text-foreground">{t(props.extension.name)}</span>
        <Show when={props.extension.tag}>{(tag) => <TagBadge tag={tag()} size="sm" />}</Show>
        <Icon
          name="chevron-right"
          class="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
    </button>
  );
}

// Marks from Simple Icons (CC0). Call of Duty and Rust have no small mark, so they get letters.
const GAME_ICONS: Record<string, { tile: string; ink: string; path?: string; letters?: string }> = {
  Valorant: { tile: "#FF4655", ink: "#FFFFFF", path: "M23.792 2.152a.252.252 0 0 0-.098.083c-3.384 4.23-6.769 8.46-10.15 12.69-.107.093-.025.288.119.265 2.439.003 4.877 0 7.316.001a.66.66 0 0 0 .552-.25c.774-.967 1.55-1.934 2.324-2.903a.72.72 0 0 0 .144-.49c-.002-3.077 0-6.153-.003-9.23.016-.11-.1-.206-.204-.167zM.077 2.166c-.077.038-.074.132-.076.205.002 3.074.001 6.15.001 9.225a.679.679 0 0 0 .158.463l7.64 9.55c.12.152.308.25.505.247 2.455 0 4.91.003 7.365 0 .142.02.222-.174.116-.265C10.661 15.176 5.526 8.766.4 2.35c-.08-.094-.174-.272-.322-.184z" },
  CS2: { tile: "#E8A33D", ink: "#141414", path: "M21.7101 3.2348a.0218.0218 0 0 1-.0216-.0215c.001-.0815.003-.3698.004-.424 0-.1292-.1428-.1831-.2117-.0829-.0113.016-.1457.212-.2287.3323a.0244.0244 0 0 1-.0198.0103h-6.5508a.0473.0473 0 0 1-.0473-.0463l-.0131-.177a.0477.0477 0 0 1 .056-.0477l.335.0319a.059.059 0 0 0 .0624-.0445l.2441-.989a.0475.0475 0 0 0-.0295-.0542l-.2268-.0848a.0427.0427 0 0 1-.0263-.0295c-.0412-.1722-.3766-1.3235-1.9935-1.581-.7867-.125-1.302.2107-1.577.4784a1.594 1.594 0 0 0-.3018.4095l-.0965.2125c-.008.0164-.046.2157-.046.234l.0513.9815a.109.109 0 0 0 .0422.0856l.3546.153-.1958.3244a.055.055 0 0 1-.053.0402s-.417.0108-.6227.0192c-.3856.0155-1.2444.4858-1.8773 1.8385-.6219 1.3282-.724 1.5496-.724 1.5496a.0736.0736 0 0 1-.0684.0398l-.5776.0019c-.0356 0-.0736.0285-.0886.0608l-.8982 2.5428c-.0149.0323-.006.081.0173.1081l.627.3918a.059.059 0 0 1 .0195.059l-.3274.9664a.1916.1916 0 0 1-.0235.0618l-.4343.3824a.1056.1056 0 0 0-.0356.059l-.5978 1.5308a.0632.0632 0 0 1-.0608.0455l-.3355.0018a.1633.1633 0 0 0-.162.1488l-.2007 2.2883a1.7194 1.7194 0 0 1-.0159.1207l-.1583.908a.128.128 0 0 1-.0333.0553l-.5584.4263c-.2559.2443-.5988.6903-.7665 1.0015l-1.86 3.9235c-.045.0833-.0811.227-.0788.3221l.1321.2354c.002.0842-.0319.4559-.0707.5307L.817 23.6545a.0985.0985 0 0 0-.003.0856l.0309.0706.0932.1859 1.8913.0029c.1173.0106.247-.1396.2507-.3005l.1027-1.2965-.0268-.1952 3.6063-4.232c.0942-.1146.222-.3168.2861-.4506l1.7186-3.7892a.1712.1712 0 0 1 .1004-.088l.1086-.035a.1694.1694 0 0 1 .1827.0528c.1505.1807.5042.781.6765 1.0315.1425.2079.8495 1.2304 1.1582 1.5675.0853.0926.3481.198.4658.2696a.083.083 0 0 1 .029.1119l-1.0298 1.8083-.4549 2.1357a.9542.9542 0 0 0-.0356.1526l-.4118 1.4831c.003.1873-.141.2856-.1527.5064l-.15 1.084a.0581.0581 0 0 0 .0582.0614l2.5445.014c.0951-.0003.1902-.0045.2854-.0067a1.1049 1.1049 0 0 0 .0755-.0069c.1242-.0158.5629-.0754.75-.1503.1097-.0388.1809-.0819.2268-.1295.1855-.1935.2002-.278.2034-.3975.001-.0212-.011-.0726-.0283-.1049-.0053-.0117-.0316-.0382-.059-.0477l-1.1815-.3562a.3693.3693 0 0 1-.1889-.1338l-.3172-.469a.0865.0865 0 0 1 .0173-.0973l.618-.609a.2017.2017 0 0 0 .0483-.072l1.9036-4.488c.089-.285.0595-.6056 0-.9445-.044-.2504-.6854-1.3264-.8532-1.6236-.1476-.262-1.0677-1.8707-1.286-2.2517-.0793-.1376-.1894-.1328-.2287-.276l-.0726-1.1173a.0398.0398 0 0 1 .0356-.0505l.3312-.0276a.093.093 0 0 0 .0741-.0487l1.147-2.1544a.0958.0958 0 0 0-.002-.094l-.2349-.2907a.0874.0874 0 0 1-.001-.0875l.3515-.3796a.054.054 0 0 1 .0736-.0206l.9343.5266a.3819.3819 0 0 0 .186.0505c.259-.0019.6858-.1549.908-.2906a.3833.3833 0 0 0 .1386-.148l.4583-1.0703c.006-.0136.0262-.0117.029.0028l.1278.5953a.0635.0635 0 0 0 .0788.0501l1.3494-.3a.0662.0662 0 0 0 .05-.0786l-.318-1.3437a.0716.0716 0 0 1 .009-.0534l.1313-.2036a.281.281 0 0 0 .036-.0814l.1589-.725a.0408.0408 0 0 1 .0397-.0323l3.7327.0047a.0916.0916 0 0 0 .0932-.0931v-.6336a.022.022 0 0 1 .0216-.0216h1.4393a.0465.0465 0 0 0 .0464-.0463v-.2855a.0465.0465 0 0 0-.0464-.0463h-1.4398z" },
  PUBG: { tile: "#F2A900", ink: "#141414", path: "M1.425 20.693c-.107-.247-.132-.4-.131-.8 0-.376.015-.478.208-1.416a38 38 0 0 0 .2-1.015c-.1-.056-.481-.376-.7-.587-.49-.472-.799-.938-.942-1.415-.059-.195-.067-.282-.056-.592.013-.341.02-.378.127-.599a2 2 0 0 1 .257-.39c.14-.15.145-.161.188-.465.024-.171.072-.493.105-.715.054-.36.056-.424.018-.592a2.84 2.84 0 0 1 .082-1.529c.358-.99 1.39-1.681 3-2.007 1.226-.249 2.815-.265 4.374-.045 1.537.218 3.344.715 5.011 1.38.214.086.392.152.396.148.014-.014-1.28-.668-1.61-.814A17 17 0 0 0 8.28 8.073C7.472 7.92 7.22 7.9 6.147 7.9c-.931 0-1.068.007-1.46.073a7 7 0 0 0-.836.18c-.1.03-.056-.046.082-.141.516-.356 1.36-.69 2.23-.886.853-.191.851-.177.023-.165-.407.006-.74.002-.74-.009s.025-.041.055-.068a10 10 0 0 0 .342-.376c.493-.56 1.253-1.22 1.923-1.667 1.278-.854 2.553-1.345 4.124-1.588.51-.08 2.061-.08 2.6 0 1.682.245 2.964.707 4.14 1.49.554.37.864.624 1.339 1.101.953.958 1.613 2.02 2.191 3.527.31.808.601 1.76.756 2.474l.072.331.164.115c.09.063.183.152.206.198s.166.448.316.894c.151.445.286.814.3.82s.026.111.026.234c0 .213-.004.225-.086.264-.106.05-1.037.255-1.16.255-.127 0-.23-.11-.322-.343l-.177-.436c-.054-.128-.172-.416-.263-.638-.302-.739-.295-.725-.394-.766-.08-.033-.128-.026-.393.064-.166.057-.35.13-.407.165a.55.55 0 0 0-.221.4c-.001.091.23.762.289.84.067.089 1.591 1.11 1.688 1.131.06.013.253-.014.528-.074l.438-.094c.003 0 .016.215.028.478.021.45.018.486-.043.607-.104.204-.003.16-1.67.723-1.314.444-1.564.497-2.353.497a4.5 4.5 0 0 1-2.388-.644c-.48-.283-1.052-.767-1.224-1.037-.133-.209-.16-.04.34-2.195.1-.427.194-.781.211-.787.017-.005.09.1.163.236s.164.266.202.29.287.14.552.259c.409.182.515.217.695.228a.82.82 0 0 0 .79-.41c.083-.131.097-.2.213-1.07l.158-1.178c.098-.725.09-.957-.046-1.248-.153-.327-.328-.474-.881-.741-.918-.444-.862-.435-1.279-.204-.158.088-.29.161-.293.164a8 8 0 0 0 .313-.006l.318-.01.52.24c.408.19.555.275.678.392.301.29.393.655.31 1.241-.052.37-.085.458-.23.615-.185.202-.334.269-.596.27-.208 0-.243-.01-.732-.24-.509-.24-.516-.242-.79-.249l-.276-.007-.039.156-.166.685c-.162.673-.477 1.976-.735 3.038-.11.454-.258 1.063-.327 1.355-.159.668-.214.86-.307 1.075-.219.503-.689.99-1.2 1.245-.578.287-1.076.342-1.828.205a45 45 0 0 0-4.48-.615c-.606-.053-2.655-.053-3.051 0-.826.111-1.187.19-1.535.337a1.93 1.93 0 0 0-.847.672c-.174.257-.253.71-.191 1.092.029.177-.008.192-.079.03zm.317-3.394c0-.028.06-.365.165-.929.1-.538.212-.748.576-1.086.604-.56 1.758-.924 3.331-1.05.557-.045 2.451-.014 3.072.05 1.287.131 1.77.195 2.88.38.906.151.886.15.7.073a58 58 0 0 0-2.054-.744c-1.222-.412-1.941-.578-3.207-.74-.625-.08-2.496-.081-3.082-.001-1.13.154-1.95.382-2.568.717-.523.282-.895.643-1.049 1.02-.09.22-.075.702.03.956.124.299.332.586.65.9.436.428.556.526.556.454m-.558-4.09c.15-.107.649-.33.963-.43.525-.169.957-.256 1.805-.367.497-.065 2.617-.093 3.284-.043l.716.053c.286.022.316-.01.392-.418l.184-.974c.19-1 .248-1.318.249-1.375 0-.105-.107-.19-.281-.217-.792-.129-2.275-.198-3.255-.153-2.203.1-3.583.628-4.102 1.566a1.6 1.6 0 0 0-.219.662q-.018.188.01.105c.143-.436.52-.88.926-1.094.237-.125.26-.132.26-.088 0 .015-.063.058-.14.096q-.273.131-.513.593c-.153.295-.193.468-.297 1.291a61 61 0 0 1-.096.74c-.021.135-.008.14.114.053m9.586-.184c.066-.052.078-.085.078-.236 0-.159-.01-.184-.102-.266-.12-.108-.188-.114-.298-.028-.161.128-.122.44.069.544.11.06.16.057.253-.014m7.349-1.91c.223-.15.319-.421.251-.712-.118-.515-.662-.73-.966-.384-.283.322-.166.91.22 1.1.178.088.361.087.495-.004m-.321-.32c-.187-.102-.245-.433-.103-.586.108-.117.285-.115.4.006.166.172.172.42.016.551-.105.088-.19.096-.313.029m-6.548-.146c.098-.139.036-.446-.105-.521-.09-.049-.204-.039-.257.022-.14.16-.142.312-.003.476.1.12.29.132.366.023z" },
  "Call of Duty": { tile: "#141414", ink: "#FFFFFF", letters: "COD" },
  Twitch: { tile: "#9146FF", ink: "#FFFFFF", path: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" },
  TikTok: { tile: "#000000", ink: "#FFFFFF", path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" },
  Rust: { tile: "#CD412B", ink: "#FFFFFF", letters: "R" },
};

function TagBadge(props: { tag: string; size?: "sm" | "md" }) {
  const icon = () => GAME_ICONS[props.tag];
  return (
    <Show
      when={icon()}
      fallback={<span class="shrink-0 rounded-[4px] bg-foreground/10 px-1.5 py-px text-xxs font-450 text-muted-foreground">{props.tag}</span>}
    >
      {(icon) => (
        <span
          role="img"
          aria-label={props.tag}
          title={props.tag}
          class="grid shrink-0 place-items-center rounded-[4px] inset-ring-1 inset-ring-white/10"
          classList={{ "size-4": props.size !== "sm", "size-3.5": props.size === "sm" }}
          style={{ background: icon().tile, color: icon().ink }}
        >
          <svg viewBox="0 0 24 24" class={icon().path ? "size-[72%]" : "size-full"} fill="currentColor" aria-hidden="true">
            <Show
              when={icon().path}
              fallback={
                <text x="12" y="12" dy="0.36em" text-anchor="middle" font-weight="800" font-size={icon().letters!.length > 1 ? "10" : "15"} letter-spacing={icon().letters!.length > 1 ? "-0.6" : "0"}>
                  {icon().letters}
                </text>
              }
            >
              {(d) => <path d={d()} />}
            </Show>
          </svg>
        </span>
      )}
    </Show>
  );
}
