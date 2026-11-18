/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ updateUser: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { updateUser: server.updateUser } } }));

import { finishOnboarding, onboardingDue, onboardingStep, reopenOnboarding, setOnboardingStep } from "./onboarding";

function memoryStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => void rows.set(key, value),
    removeItem: (key: string) => void rows.delete(key),
  };
}

const newcomer = { id: "newcomer", created_at: "2026-11-06T09:00:00Z", user_metadata: {} };

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  server.updateUser.mockReset();
  server.updateUser.mockResolvedValue({ error: null });
});

describe("who the setup guide opens for", () => {
  it("opens for a new account", () => {
    expect(onboardingDue(newcomer)).toBe(true);
  });

  it("leaves accounts from before the guide alone", () => {
    expect(onboardingDue({ ...newcomer, created_at: "2026-10-01T09:00:00Z" })).toBe(false);
    expect(onboardingDue({ ...newcomer, created_at: undefined })).toBe(false);
  });

  it("stays closed on a device that didn't finish it", () => {
    expect(onboardingDue({ ...newcomer, user_metadata: { onboarded_at: "2026-11-06T10:00:00Z" } })).toBe(false);
  });

  it("stays closed here when the account can't be told it's done", async () => {
    server.updateUser.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    finishOnboarding(newcomer.id);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(onboardingDue(newcomer)).toBe(false);
  });
});

describe("the step it's on", () => {
  it("keeps the step for the return from a network's sign-in page", () => {
    setOnboardingStep(newcomer.id, "accounts");
    expect(onboardingStep(newcomer.id)).toBe("accounts");
  });

  it("ignores a step this version doesn't have", () => {
    sessionStorage.setItem(`plan.onboarding-step.${newcomer.id}`, "gone");
    expect(onboardingStep(newcomer.id)).toBeNull();
  });

  it("closes on finishing, and tells the account", () => {
    setOnboardingStep(newcomer.id, "times");
    finishOnboarding(newcomer.id);
    expect(onboardingStep(newcomer.id)).toBeNull();
    expect(server.updateUser).toHaveBeenCalledWith({ data: { onboarded_at: expect.any(String) } });
  });

  it("can be opened again from the start after finishing", () => {
    finishOnboarding(newcomer.id);
    reopenOnboarding(newcomer.id);
    expect(onboardingStep(newcomer.id)).toBe("workspace");
    expect(onboardingDue(newcomer)).toBe(false);
  });
});
