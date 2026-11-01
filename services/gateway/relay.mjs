// Takes all the publisher's public traffic and passes it on whole, so the publisher is never on the internet.
// It holds no keys: the publisher still checks every session and signed link, so anyone who takes this
// over can do no more than the sessions and links that come through while they're here.

import { request } from "node:http";
import { pipeline } from "node:stream";

export const GATEWAY_PORT = 8798;
export const SENDER_PORT = 8794;
export const SECRET_HEADER = "x-plan-video-gateway";

const PREFIX = "/api/publisher/";
const HEALTH = `${PREFIX}health`;
/** The publisher's own limit on a request; nothing it answers takes more. */
const BODY_MAX = 64 * 1024;
const PASSED_ON = ["authorization", "content-type", "range"];
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Null past BODY_MAX. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_MAX ? null : Buffer.concat(chunks)));
    req.on("error", reject);
    // Someone who leaves mid-request ends it with neither.
    req.on("close", () => reject(new Error("it stopped before the end")));
  });
}

export function createRelay({ secret, port = SENDER_PORT, log = console }) {
  function ask({ method, path, headers, body, signal }) {
    return new Promise((resolve, reject) => {
      // A new connection each time: a kept one the publisher has just closed would fail a request it never saw.
      const upstream = request({ host: "127.0.0.1", port, method, path, agent: false, signal, headers: { ...headers, [SECRET_HEADER]: secret } }, resolve);
      upstream.on("error", reject);
      upstream.end(body ?? undefined);
    });
  }

  async function relay(req, res, stop) {
    const reads = req.method !== "GET" && req.method !== "HEAD";
    const body = reads ? await readBody(req) : null;
    if (reads && !body) return json(res, 413, { error: "That request is too large." });
    const headers = Object.fromEntries(PASSED_ON.filter((name) => req.headers[name] !== undefined).map((name) => [name, req.headers[name]]));
    headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "";
    if (body) headers["content-length"] = body.length;
    const answer = await ask({ method: req.method, path: req.url, headers, body, signal: stop.signal });
    res.writeHead(answer.statusCode, Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP_BY_HOP.has(name))));
    await new Promise((resolve) => pipeline(answer, res, () => resolve()));
  }

  return function handle(req, res) {
    const path = (req.url || "").split("?")[0];
    if (!path.startsWith(PREFIX)) {
      json(res, 404, { error: "Unknown publisher route." });
      return;
    }
    const stop = new AbortController();
    let left = false;
    res.once("close", () => {
      left = true;
      stop.abort();
    });
    relay(req, res, stop).catch((error) => {
      if (left) return;
      log.error("[gateway] a request failed", error instanceof Error ? error.message : error);
      if (res.headersSent) res.destroy();
      else if (path === HEALTH) json(res, 503, { ok: false, problems: ["the gateway can't reach the publisher"] });
      else json(res, 503, { error: "Publishing isn't available right now." });
    });
  };
}
