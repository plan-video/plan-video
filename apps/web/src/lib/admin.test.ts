/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: null }));

import { attention, monthlyRevenue, networkSummaries, xSpend, type AdminReport } from "./admin";

function report(over: Partial<AdminReport> = {}): AdminReport {
  return {
    // 03:00 UTC: still the 20th in Pacific time, the 21st in UTC.
    at: "2026-11-21T03:00:00Z",
    deliveries: [],
    busiest: [],
    youtube_uploads_today: 0,
    x_posts_month: 0,
    x_links_month: 0,
    x_owners: [],
    caption_seconds_month: 0,
    people: 0,
    people_week: 0,
    plans: {},
    database_bytes: 0,
    api_usage: [],
    limits: [],
    networks: ["youtube", "x", "instagram"],
    health: { problems: [], lastPass: null },
    caps: { youtubeDailyUnits: 10_000, xPostsByLevel: { 1: 0, 2: 150, 3: 400, 4: 800 }, xLinksByLevel: { 1: 0, 2: 10, 3: 25, 4: 40 }, xPostsPerDay: 50 },
    prices: { xPost: 0.015, xLinkPost: 0.2, captionHour: 0.22 },
    costs: [],
    ...over,
  };
}

const row = (day: string, network: string, units = 0, limited = 0) => ({ day, network, kind: "upload", calls: 1, failed: 0, limited, units });

describe("admin numbers", () => {
  it("bills a post with a link at the link price only", () => {
    expect(xSpend(report({ x_posts_month: 100, x_links_month: 10 }))).toBeCloseTo(90 * 0.015 + 10 * 0.2);
  });

  it("reads YouTube's quota on its Pacific day and the others on the UTC day", () => {
    const networks = networkSummaries(
      report({ api_usage: [row("2026-11-20", "youtube", 1600), row("2026-11-21", "youtube", 50), row("2026-11-20", "x"), row("2026-11-21", "x")] }),
    );
    const youtube = networks.find((network) => network.id === "youtube")!;
    expect(youtube.meters[0]).toMatchObject({ used: 1600, limit: 10_000 });
    expect(networks.find((network) => network.id === "x")!.calls).toBe(1);
    expect(networks.find((network) => network.id === "tiktok")!.configured).toBe(false);
  });

  it("warns about limits near full, refusals and late posts, the pressing first", () => {
    const busy = report({
      api_usage: [row("2026-11-20", "youtube", 9000)],
      busiest: [{ platform: "instagram", posts: 10 }],
      deliveries: [{ platform: "x", sent_day: 4, failed_day: 0, sent_week: 4, failed_week: 0, waiting: 2, overdue: 2 }],
      limits: [{ network: "x", label: "posts-24h", scope: "app", used: 10, limit: 100, resetAt: null, seenAt: "2026-11-21T02:00:00Z" }],
    });
    busy.api_usage.push(row("2026-11-21", "x", 0, 3));
    const warnings = attention(busy, networkSummaries(busy), { model: "m", usdPerMillion: 0.1, spent: 90, budget: 100, freeSpent: 0, resetsAt: null });
    expect(warnings[0]).toBe("X: 2 posts are over 15 minutes late");
    expect(warnings).toContain("YouTube: Quota today at 90%");
    expect(warnings).toContain("X refused 3 calls for a limit today");
    expect(warnings).toContain("Assistant: 90% of today's spending cap used");
    expect(warnings.some((warning) => warning.startsWith("Instagram"))).toBe(false);
  });

  it("counts what paid plans bring in a month", () => {
    expect(monthlyRevenue({ 1: 50, 2: 3, 3: 2, 4: 1 })).toBe(3 * 19 + 2 * 39 + 79);
  });
});
