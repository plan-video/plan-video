/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor, type JSX } from "solid-js";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context";

/**
 * Resolves a user's avatar_url (either a direct HTTP URL from OAuth
 * or a Supabase Storage path) into a displayable image URL.
 */
export function useAvatar(): Accessor<string | null> {
  const auth = useAuth();
  const [displayUrl, setDisplayUrl] = createSignal<string | null>(null);

  createEffect(() => {
    const metadata = auth.user()?.user_metadata;
    const saved = typeof metadata?.avatar_url === "string" ? metadata.avatar_url : "";
    const picture = typeof metadata?.picture === "string" ? metadata.picture : "";
    // An uploaded photo is a storage path in `avatar_url` and wins. A Google
    // sign-in often leaves the photo only in `picture`.
    const url = saved || (picture.startsWith("http") ? picture : "");
    if (!url) {
      setDisplayUrl(null);
      return;
    }

    if (url.startsWith("http")) {
      setDisplayUrl(url);
      return;
    }

    // Storage path — download the blob
    if (!supabase) return;
    void supabase.storage
      .from("avatars")
      .download(url)
      .then(({ data }) => {
        if (data) {
          const prev = displayUrl();
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          setDisplayUrl(URL.createObjectURL(data));
        }
      });
  });

  onCleanup(() => {
    const url = displayUrl();
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  });

  return displayUrl;
}

/**
 * A profile photo. Google's picture host rejects the request when this site
 * is named as the referrer, so the request goes out without one. A photo
 * that still cannot load shows `fallback` instead of a broken image.
 */
export function AvatarPhoto(props: { url: string | null; class: string; fallback: JSX.Element }) {
  const [failed, setFailed] = createSignal(false);
  // Tried again only for another address: one that didn't load stays on the fallback when the list around it is drawn again.
  const url = createMemo(() => props.url);
  createEffect(on(url, () => setFailed(false), { defer: true }));

  return (
    <Show when={url()} fallback={props.fallback}>
      {(url) => (
        <Show when={!failed()} fallback={props.fallback}>
          <img
            src={url()}
            alt=""
            class={props.class}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </Show>
      )}
    </Show>
  );
}
