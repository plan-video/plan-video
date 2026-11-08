import { describe, expect, it, vi } from "vitest";

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value), removeItem: (key: string) => void saved.delete(key) });
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));

const { chosenZone, clockAt, momentOf, setTimeZone, setTimeZoneOwner } = await import("./time-zone");

describe("the chosen zone", () => {
  it("belongs to one account, so the next person on this browser doesn't get it", () => {
    setTimeZoneOwner("a");
    setTimeZone("Asia/Tokyo");
    expect(chosenZone()).toBe("Asia/Tokyo");
    setTimeZoneOwner("b");
    expect(chosenZone()).toBeNull();
    setTimeZone("Europe/Paris");
    setTimeZoneOwner(null);
    expect(chosenZone()).toBeNull();
    setTimeZoneOwner("a");
    expect(chosenZone()).toBe("Asia/Tokyo");
  });
});

describe("momentOf", () => {
  it("reads a skipped time as just after the change, on both sides of UTC, as the publisher does", () => {
    expect(momentOf("2027-03-14", "02:30", "America/New_York")?.toISOString()).toBe("2027-03-14T07:30:00.000Z");
    expect(clockAt(momentOf("2027-03-14", "02:30", "America/New_York")!, "America/New_York")).toBe("03:30");
    expect(momentOf("2027-03-28", "02:30", "Europe/Amsterdam")?.toISOString()).toBe("2027-03-28T01:30:00.000Z");
  });

  it("leaves other times as they were", () => {
    expect(momentOf("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(momentOf("2026-10-25", "02:30", "Europe/Amsterdam")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(momentOf("2026-10-12", "18:00", "Europe/Amsterdam")?.toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });
});
