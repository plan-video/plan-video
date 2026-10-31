/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export { defineTool } from "./tool";
export type { Tool, GenericTool } from "./tool";

export { catalog, tools, toolByName, isToolName } from "./catalog";
export type { AnyTool, ToolName, ToolByName, ToolInput, ToolArgs, ToolResult } from "./catalog";

export { DapiError, isDapiError } from "./errors";
export type { DapiErrorCode } from "./errors";

export { chooseAccounts } from "./social-accounts";
export type { AccountChoice, ConnectedAccount } from "./social-accounts";
export { checkTikTokCreator, promotionFlags, tiktokConsent, PROMOTION_QUESTION, TIKTOK_BRANDED_POLICY, TIKTOK_MUSIC_USAGE } from "./tiktok";
export type { TikTokCreatorRules, TikTokPromotion } from "./tiktok";
export { analytics as analyticsTool } from "./tools/analytics";
export { listMedia as listMediaTool } from "./tools/library";
