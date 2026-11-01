// The publisher answers only the gateway (services/gateway), which takes its public traffic and holds no keys.
// SENDER_SECRET lets the two know each other; everything else is still checked here, as if it came straight in.

import { createHash, timingSafeEqual } from "node:crypto";

export const SENDER_PORT = 8794;
export const SECRET_HEADER = "x-plan-video-gateway";
const HEALTH = "/api/publisher/health";

const digest = (value) => createHash("sha256").update(String(value ?? "")).digest();

/** Health is open to anyone anyway, and tells a publisher with no secret from one that's down. */
export function onlyFromGateway(secret, handle) {
  return (req, res) => {
    const known = !!secret && timingSafeEqual(digest(req.headers[SECRET_HEADER]), digest(secret));
    if (known || (req.url || "").split("?")[0] === HEALTH) return handle(req, res);
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Only the gateway can reach the publisher." }));
  };
}
