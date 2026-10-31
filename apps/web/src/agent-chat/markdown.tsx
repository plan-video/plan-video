/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { createMemo } from "solid-js";


marked.setOptions({ gfm: true, breaks: true, async: false });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/**
 * A picture or styled background fetches its address the moment it shows, so a reply
 * tricked into writing one could leak what it knows. Links only go anywhere when clicked.
 */
const NO_REMOTE = {
  FORBID_TAGS: ["img", "picture", "source", "video", "audio", "track", "iframe", "object", "embed", "svg", "math", "link", "style", "form", "input"],
  FORBID_ATTR: ["style", "src", "srcset", "poster", "background", "action", "formaction"],
};

function render(text: string, local: boolean): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ...(local ? NO_REMOTE : {}) });
}

const MARKDOWN_CLASS = [
  "text-[12px] leading-5 text-foreground break-words min-w-0 max-w-full",
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[12px] [&_h1]:font-450 [&_h2]:font-450 [&_h3]:font-450 [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1",
  "[&_strong]:font-450 [&_b]:font-450",
  "[&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:pl-4 [&_ol]:pl-4 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:my-0.5",
  "[&_code]:rounded [&_code]:bg-input [&_code]:px-1 [&_code]:py-px [&_code]:text-[11px] [&_code]:font-mono",
  "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-input [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-2 [&_hr]:border-border",
  "[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:border-border [&_td]:border-border [&_th]:px-1.5 [&_td]:px-1.5 [&_th]:py-0.5 [&_td]:py-0.5 [&_th]:text-left",
  "[&_img]:max-w-full [&_img]:rounded-md",
].join(" ");

/** `local` keeps the reply from loading anything from elsewhere, for text written from what an agent read. */
export function Markdown(props: { text: string; local?: boolean }) {
  const html = createMemo(() => render(props.text, !!props.local));
  return <div class={MARKDOWN_CLASS} innerHTML={html()} />;
}
