/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A fixed loopback port so an agent's config can be written once (3274 spells "dapi" on a keypad).
// No token: the server checks the Host header, which keeps browser pages out, and anything else
// running as the user can already reach the app.
export const MCP_HOST = "127.0.0.1";
export const MCP_PORT = 3274;
export const MCP_PATH = "/mcp";
export const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}${MCP_PATH}`;
