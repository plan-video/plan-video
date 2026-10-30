// Keeps Node's own fetch dispatcher. Loading @atproto's OAuth client loads undici 8, which makes itself
// the global dispatcher and refuses the byte-valued Content-Length Node 22's fetch sends, so every upload
// (YouTube, TikTok, LinkedIn) fails. Must be imported first; server.mjs puts the dispatcher back after
// loading. @atproto's own requests pass their dispatcher explicitly, so they keep their SSRF guard.

const KEY = Symbol.for("undici.globalDispatcher.1");

// Reading fetch makes Node load its undici, which sets up its dispatcher.
void globalThis.fetch;
const own = globalThis[KEY];

export function keepNodeFetch() {
  if (own && globalThis[KEY] !== own) globalThis[KEY] = own;
}
