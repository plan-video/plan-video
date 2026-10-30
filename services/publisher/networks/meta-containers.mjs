// What Instagram and Threads share: a post is made in two steps. A container
// is made for each picture or video, from a link it pulls the file from, and
// for a carousel one more holds them. Once Meta has worked on the files, the
// container is published. So a post with files is `processing` in between:
// send makes the containers, check asks after them, and publish makes the
// post once they're ready, after the publisher has claimed the row, so it's
// made once only.
//
// The row keeps what send made as `<kind>:<id>,<id>…`: `one` for a single
// container to publish, `set` for a carousel's items, whose holder publish makes.

import { PublishError } from "../errors.mjs";
import { META_NAMES, metaFetch, publishError } from "../meta.mjs";

/** A carousel's holder is made once its items are ready, and is quick: publish waits this long for it. */
const HOLDER_WAIT_MS = 60_000;
/** How long Meta may work on a post's files before it's given up on. */
const PROCESSING_MS = 60 * 60_000;
/** A post with pictures alone is usually ready in seconds, so send waits this long before leaving it to check. */
const QUICK_WAIT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `config` says how the network names things:
 *   network                 "instagram" | "threads"
 *   api                     the API's address, with its version
 *   create, publishPath     the account's container and publish routes
 *   statusFields            the fields to ask a container for
 *   statusOf(data)          "ready" | "working" | "failed" | "expired", and why
 *   limitError(error)       a time to wait for, when the account posted its most for the day
 */
export function containers(config) {
  const name = META_NAMES[config.network];

  async function make(session, fields) {
    const made = await metaFetch(`${config.api}/${session.accountId}/${config.create}`, { method: "POST", token: session.accessToken, form: fields, timeout: 120_000 });
    if (!made.ok || !made.data?.id) throw publishError(config.network, made.error, "take the post's files");
    return String(made.data.id);
  }

  async function stateOf(session, id) {
    const asked = await metaFetch(`${config.api}/${id}?fields=${config.statusFields}`, { token: session.accessToken });
    if (!asked.ok) throw publishError(config.network, asked.error, "say how the post's files are coming along");
    return config.statusOf(asked.data);
  }

  /** "ready" when every container is, "working" while any is; throws when one failed. */
  async function allReady(session, ids) {
    let working = false;
    for (const id of ids) {
      const { state, why } = await stateOf(session, id);
      if (state === "failed") throw new PublishError(`${name} couldn't use one of the post's files${why ? `: ${why}` : "."} Check its format and length, then post it again.`);
      if (state === "expired") throw new PublishError(`${name} let the post's files expire before it went out. Post it again.`);
      if (state === "working") working = true;
    }
    return working ? "working" : "ready";
  }

  /** Waits up to `ms` for the containers to be ready. */
  async function waitFor(session, ids, ms) {
    const until = Date.now() + ms;
    for (;;) {
      if ((await allReady(session, ids)) === "ready") return true;
      if (Date.now() >= until) return false;
      await sleep(3_000);
    }
  }

  /** Publishes a container. When Meta's answer is lost, it may have made the post anyway, so that's never tried again on its own. */
  async function publishContainer(session, id) {
    const done = await metaFetch(`${config.api}/${session.accountId}/${config.publishPath}`, { method: "POST", token: session.accessToken, form: { creation_id: id }, timeout: 120_000 });
    if (done.error?.lost) throw new PublishError(`${name} didn't confirm the post. Check the account, and post it again if it isn't there.`);
    if (!done.ok || !done.data?.id) {
      const wait = config.limitError(done.error);
      if (wait) throw new PublishError(`This ${name} account has posted as much as ${name} allows in a day. It goes out on its own once it can.`, { until: wait, retry: true });
      // Not ready after all: looked at again.
      if (done.error?.code === 9007) throw new PublishError(`${name} is still working on the post's files.`, { retry: true });
      throw publishError(config.network, done.error, "publish the post");
    }
    const mediaId = String(done.data.id);
    const link = await metaFetch(`${config.api}/${mediaId}?fields=permalink`, { token: session.accessToken });
    return { state: "sent", publishId: mediaId, ...(link.ok && typeof link.data?.permalink === "string" ? { url: link.data.permalink } : {}) };
  }

  /** What the row says send made. */
  function made(delivery) {
    const at = delivery.publish_id.indexOf(":");
    return { kind: delivery.publish_id.slice(0, at), ids: delivery.publish_id.slice(at + 1).split(",").filter(Boolean) };
  }

  /** Makes the post once its files are ready: a carousel gets its holder first. */
  async function finish({ session, kind, ids, holder }) {
    if (kind === "one") return publishContainer(session, ids[0]);
    const id = await make(session, holder(ids));
    if (!(await waitFor(session, [id], HOLDER_WAIT_MS))) throw new PublishError(`${name} is still putting the post together.`, { retry: true });
    return publishContainer(session, id);
  }

  return {
    /**
     * Makes the containers: `single` the fields of one, or `items` those of a
     * carousel's, whose holder `holder(ids)` describes. Publishes at once when
     * they're ready within a few seconds; otherwise check and publish finish it.
     */
    async start({ session, single, items, holder }) {
      if (single) {
        const id = await make(session, single);
        if (await waitFor(session, [id], QUICK_WAIT_MS)) return publishContainer(session, id);
        return { state: "processing", publishId: `one:${id}` };
      }
      const ids = [];
      for (const fields of items) ids.push(await make(session, fields));
      if (await waitFor(session, ids, QUICK_WAIT_MS)) return finish({ session, kind: "set", ids, holder });
      return { state: "processing", publishId: `set:${ids.join(",")}` };
    },

    /** Whether Meta has the files ready. Only asks: the post is made in publish. */
    async check({ session, delivery }) {
      const { ids } = made(delivery);
      if ((await allReady(session, ids)) === "ready") return { state: "ready" };
      if (Date.now() - Date.parse(delivery.updated_at) > PROCESSING_MS) throw new PublishError(`${name} didn't finish working on the post's files. Post it again.`);
      return { state: "processing", publishId: delivery.publish_id };
    },

    finish,

    made,
  };
}

/** The first `max` code points of the text: Instagram and Threads count their limits in characters. */
export function clipText(text, max) {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join("");
}
