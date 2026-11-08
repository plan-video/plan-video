import { createSignal } from "solid-js";
import { expect, test, vi } from "vitest";
import { FakeIdb } from "@/lib/fake-idb";
const shared = vi.hoisted(() => ({ idb: null as unknown as FakeIdb, online: true }));
const saved = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) });
vi.mock("idb", () => ({ openDB: async () => shared.idb.open() }));
vi.mock("somoto", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/components/brand/mascot", () => ({ SquirrelPhone: () => null }));
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {}, waitForAccountSync: async () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));
vi.mock("@/lib/supabase", () => ({ supabase: null }));
vi.mock("@/lib/cloud-storage", () => ({ cloudEnabled: false, cloudHoldUps: () => new Map(), cloudUploads: () => new Set(), queueCloud: () => {} }));
vi.mock("@/lib/account-sync", () => ({ flushAccountSync: async () => true }));
vi.mock("@/lib/team-sync", () => ({ flushTeamSync: async () => true }));
vi.mock("@/lib/post-sync", () => ({ flushPostSync: async () => true, postSyncProblem: createSignal(null)[0], refusedPosts: createSignal(new Map())[0], unsyncedPosts: createSignal(new Set())[0] }));
vi.mock(import("@/lib/social-connections"), async (original) => ({
  ...(await original()),
  accountsFor: () => [{ id: "c1", platform: "x", x: {} }] as never,
  loadSocialConnections: () => {},
  socialConnections: () => [{ id: "c1", platform: "x", x: {} }] as never,
}));
vi.mock("@/lib/publishing", () => ({ requestSend: async () => { throw new Error("The publisher answered 503"); } }));
shared.idb = new FakeIdb();
const { loadWorkspaces } = await import("@/lib/workspaces");
loadWorkspaces("user-1");
const { allPosts, createEvent, hydrateCalendar, revisePost } = await import("@/components/calendar/store");
const { localDateKey } = await import("@/components/calendar/utils");
const { timeOf } = await import("@/components/publish/save");
const { publishPost, updatePost } = await import("./posts");


test("an agent's Post now that fails leaves a future post scheduled at its own time", async () => {
  await hydrateCalendar();
  const when = new Date(Date.now() + 5 * 86_400_000);
  await createEvent({ id: "tue", allDay: false, calendarId: "posts", day: localDateKey(when), description: "Words", duration: 15, link: "", platforms: ["x"], accounts: {}, repeat: "", repeatEnd: "", start: timeOf(when), status: "scheduled", title: "tue" });
  await expect(publishPost({ id: "tue" }, { app: { requireUser: () => ({ id: "user-1" }) } } as never)).rejects.toThrow();
  const after = allPosts().find((post) => post.id === "tue");
  expect(after).toMatchObject({ day: localDateKey(when), start: timeOf(when), status: "scheduled" });
});

const planned = (id: string, when: Date) =>
  createEvent({ id, allDay: false, calendarId: "posts", day: localDateKey(when), description: "Words", duration: 15, link: "", platforms: ["x"], accounts: {}, start: timeOf(when), status: "scheduled", title: "Words" } as never);
const USER = { requireUser: () => ({ id: "user-1" }) };

test("a post changed while its Allow waits isn't sent, and the person is asked again", async () => {
  await hydrateCalendar();
  await planned("edited", new Date(Date.now() + 5 * 86_400_000));
  const confirm = async () => {
    revisePost("edited", { description: "Words the person never saw" });
    return true;
  };
  await expect(publishPost({ id: "edited" }, { app: USER, confirm } as never)).rejects.toThrow(/changed while/);
});

test("an agent taking a post off the schedule asks first, and a no changes nothing", async () => {
  await hydrateCalendar();
  await planned("kept", new Date(Date.now() + 5 * 86_400_000));
  const asked: unknown[] = [];
  const confirm = async (request: unknown) => {
    asked.push(request);
    return false;
  };
  await expect(updatePost({ id: "kept", draft: true }, { app: USER, confirm, confirmEvery: true } as never)).rejects.toThrow(/didn't confirm/);
  expect(asked).toMatchObject([{ leavesSchedule: true }]);
  expect(allPosts().find((post) => post.id === "kept")?.status).toBe("scheduled");
});
