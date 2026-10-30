// lib/post-rows.ts against a local Supabase (supabase start), skipped when none answers: pages follow on from
// the last row, so posts changed while the pages are read are never skipped.

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";

import { readPostRows } from "./post-rows";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const reachable = await fetch(`${URL}/rest/v1/`, { headers: { apikey: SERVICE } })
  .then((response) => response.ok)
  .catch(() => false);

describe.skipIf(!reachable)("reading posts a page at a time", () => {
  test("every post is read once, however many, and one changed meanwhile isn't skipped", async () => {
    const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const { data: made } = await db.auth.admin.createUser({ email: `rows-${randomUUID().slice(0, 8)}@posts.test`, password: "rows-password", email_confirm: true });
    const owner = made.user!.id;
    const ids = Array.from({ length: 450 }, (_, index) => `p${String(index).padStart(4, "0")}`);
    for (let index = 0; index < ids.length; index += 150) {
      const { error } = await db.from("posts").insert(
        ids.slice(index, index + 150).map((id) => ({ owner_id: owner, id, workspace_id: "default", data: { id, title: id, status: "draft" } })),
      );
      expect(error).toBeNull();
    }
    // Pages of 100, and while they're read, posts from early pages change, which moves them to the end.
    let pages = 0;
    const paging = { from: db.from.bind(db) };
    const touched: string[] = [];
    const watched = new Proxy(db, {
      get(target, key) {
        if (key !== "from") return Reflect.get(target, key);
        return (table: string) => {
          pages++;
          if (pages > 1 && pages < 5) {
            const id = ids[(pages - 2) * 10]!;
            touched.push(id);
            void target.from("posts").update({ data: { id, title: `changed ${pages}`, status: "draft" } }).match({ owner_id: owner, id }).then(() => undefined);
          }
          return paging.from(table);
        };
      },
    });
    const rows = await readPostRows(watched, owner, "default", null, 100);
    const seen = new Set(rows.map((row) => row.id));
    expect([...ids].filter((id) => !seen.has(id))).toEqual([]);
    // In change order throughout.
    const times = rows.map((row) => row.updated_at);
    expect([...times].sort()).toEqual(times);
    // Only what changed since a time.
    const since = rows[rows.length - 1]!.updated_at;
    await db.from("posts").update({ data: { id: "p0001", title: "later", status: "draft" } }).match({ owner_id: owner, id: "p0001" });
    const later = await readPostRows(db, owner, "default", since);
    expect(later.map((row) => row.id)).toContain("p0001");
    expect(later.length).toBeLessThan(10);
    expect(touched.length).toBe(3);
  });
});
