import { expect, test, vi } from "vitest";
import { FakeIdb } from "@/lib/fake-idb";
const shared = vi.hoisted(() => ({ idb: null as unknown as FakeIdb, release: (() => {}) as () => void, uploads: new Set<string>() }));
const saved = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) });
vi.mock("idb", () => ({ openDB: async () => shared.idb.open() }));
vi.mock("somoto", () => ({ toast: { error: () => {} } }));
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {}, waitForAccountSync: async () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));
vi.mock("@/lib/cloud-storage", () => ({
  cloudEnabled: true,
  cloudHoldUps: () => new Map(),
  cloudUploads: () => shared.uploads,
  queueCloud: (name: string) => void shared.uploads.add(name),
  isSentCopy: () => false,
  deleteFromCloud: () => new Promise<void>((resolve) => { shared.release = resolve; }),
}));
const { loadWorkspaces } = await import("@/lib/workspaces");
loadWorkspaces("user-1");
const { hydrateCalendar, isUploading } = await import("@/components/calendar/store");
const { savePosts } = await import("./save");
const a = new File(["a"], "a.mp4", { type: "video/mp4" });
const b = new File(["b"], "b.mp4", { type: "video/mp4" });
const base = { id: "p", title: "t", caption: "Words", platforms: ["x" as const, "linkedin" as const], when: new Date(Date.now() - 1000), status: "scheduled" as const };

test("a post's network captions are saved before a slow delete of its old file", async () => {
  shared.idb = new FakeIdb();
  await hydrateCalendar();
  const when = new Date("2099-01-05T10:00:00Z");
  shared.release = () => {};
  const first = savePosts([{ ...base, when, status: "draft" as const, files: { shared: [a, b] }, captions: { x: "OLD words for X" } }]);
  await first;
  const second = savePosts([{ ...base, files: { shared: [a] }, captions: { x: "NEW words for X" } }]);
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  const row = shared.idb.rows("events").find((r) => r.id === "p")!;
  shared.release();
  await second;
  expect((row.captions as { x?: string })?.x).toBe("NEW words for X");
});

test("a file that already has its cloud copy doesn't read as uploading", async () => {
  if (!shared.idb) shared.idb = new FakeIdb();
  await hydrateCalendar();
  shared.uploads.clear();
  const id = "q";
  await savePosts([{ ...base, id, when: new Date("2099-01-05T10:00:00Z"), status: "draft" as const, files: { shared: [a] } }]);
  // the copy lands
  const media = shared.idb.rows("media").find((r) => String(r.id).startsWith("q_"))!;
  shared.idb.stores.get("media")!.set(media.id, { ...media, cloud: { key: `posts/u/${media.id}`, at: new Date().toISOString() } });
  shared.uploads.clear();
  await savePosts([{ ...base, id, when: new Date("2099-01-05T11:00:00Z"), status: "scheduled" as const, files: { shared: [a] } }]);
  expect({ jobs: [...shared.uploads].map((j) => j.replace(/_.*/, "_…")), isUploading: isUploading(id) }).toEqual({ jobs: [], isUploading: false });
});
