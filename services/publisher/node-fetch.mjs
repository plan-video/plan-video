// Keeps Node's own fetch working as Node made it. Loading @atproto's OAuth
// client loads undici 8, which on load makes itself the dispatcher behind
// Node's global fetch. Node 22's fetch hands it header values as bytes, and
// undici 8 refuses a Content-Length that isn't text, so every upload that sets
// one (YouTube, TikTok, LinkedIn) failed before it left the server.
// Imported first, this takes Node's dispatcher before that happens; server.mjs
// puts it back once everything has loaded. @atproto's own requests pass their
// dispatcher explicitly, so they keep their guard.

const KEY = Symbol.for("undici.globalDispatcher.1");

// Reading fetch makes Node load its undici, which sets up its dispatcher.
void globalThis.fetch;
const own = globalThis[KEY];

export function keepNodeFetch() {
  if (own && globalThis[KEY] !== own) globalThis[KEY] = own;
}
