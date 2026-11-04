import { describe, expect, it } from "vitest";

import { analyticsSources, reportsNumbers } from "@/lib/social-analytics";

const page = { id: "page", handle: "Acme", platform: "linkedin", linkedin: { organizationId: "42" } };
const person = { id: "me", handle: "me", platform: "linkedin", linkedin: { personId: "p1" } };

describe("LinkedIn numbers", () => {
  it("come from company Pages, not personal profiles", () => {
    expect(reportsNumbers(page)).toBe(true);
    expect(reportsNumbers(person)).toBe(false);
    expect(analyticsSources([page, person]).map((source) => source.key)).toEqual(["linkedin:page"]);
  });

  it("show as a sample for any account in the guest demo", () => {
    expect(analyticsSources([person], { sample: true }).map((source) => source.key)).toEqual(["linkedin:me"]);
  });
});
