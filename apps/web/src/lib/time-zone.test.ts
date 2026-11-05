import { describe, expect, it } from "vitest";

import { clockAt, momentOf } from "./time-zone";

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
