/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Web Animations, so nothing remounts; skipped for reduced motion.

const ENTER_MS = 120;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";

function prefersLessMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const entering = new WeakMap<Element, Animation>();

/** Cancelled once it ends or another starts, so an entrance can never leave content invisible at its first frame. */
export function playEnter(element: Element | undefined, distance = 3) {
  if (!element || typeof element.animate !== "function" || prefersLessMotion()) return;
  entering.get(element)?.cancel();
  const animation = element.animate(
    [
      { opacity: 0, transform: distance ? `translateY(${distance}px)` : "none" },
      { opacity: 1, transform: "none" },
    ],
    { duration: ENTER_MS, easing: EASE_OUT, fill: "none" },
  );
  entering.set(element, animation);
  const release = () => {
    animation.cancel();
    if (entering.get(element) === animation) entering.delete(element);
  };
  animation.onfinish = release;
  // A backstop for a timeline that never ends, like a tab hidden mid-fade.
  window.setTimeout(release, ENTER_MS + 400);
}

const ARRIVE_MS = 180;

/** Already-decoded images and later `src` swaps appear at once. Fades to the image's own opacity, so `opacity-60` holds. */
export function fadeInImages(root: Document = document) {
  if (typeof root.defaultView?.Element.prototype.animate !== "function") return;
  const shown = new WeakSet<HTMLImageElement>();

  const markReady = (image: HTMLImageElement) => {
    if (image.complete && image.naturalWidth > 0) shown.add(image);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLImageElement) markReady(node);
        else if (node instanceof Element) for (const image of node.getElementsByTagName("img")) markReady(image);
      }
    }
  }).observe(root, { childList: true, subtree: true });

  // `load` doesn't bubble, so listen on the way down.
  root.addEventListener(
    "load",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || shown.has(image)) return;
      shown.add(image);
      if (prefersLessMotion()) return;
      // A lone keyframe at offset 0 eases to the image's own computed opacity.
      image.animate([{ opacity: 0, offset: 0 }], { duration: ARRIVE_MS, easing: EASE_OUT });
    },
    true,
  );
}
