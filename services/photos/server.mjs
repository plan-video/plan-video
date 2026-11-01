import { createServer } from "node:http";

import { handlePhotos } from "./handler.mjs";

const HOST = "127.0.0.1";
const PORT = 8793;

const server = createServer((req, res) => {
  handlePhotos(req, res).catch((error) => {
    console.error("[photos] request failed", error instanceof Error ? error.message : error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`photos listening on ${HOST}:${PORT}`));
