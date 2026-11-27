import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, { text: string; mtime: number }>();

vi.mock("./browser-store", () => ({
  baseName: (path: string) => path.slice(path.lastIndexOf("/") + 1),
  parentPath: (path: string) => path.slice(0, path.lastIndexOf("/")),
  readText: async (path: string) => files.get(path)?.text ?? null,
  statPath: async (path: string) => {
    const file = files.get(path);
    return file ? { size: file.text.length, mtime: file.mtime } : null;
  },
  copyTree: vi.fn(),
  existsPath: vi.fn(),
  listDirectory: vi.fn(),
  readBytes: vi.fn(),
  removeTree: vi.fn(),
  writeBytes: vi.fn(),
  writeText: vi.fn(),
}));

const { BROWSER_PROJECTS_ROOT, browserGetProject } = await import("./browser");

const dir = `${BROWSER_PROJECTS_ROOT}/@guest/night-market`;
const made = Date.parse("2026-11-27T10:00:00Z");

beforeEach(() => {
  files.clear();
  files.set(`${dir}/package.json`, { text: JSON.stringify({ projectId: "p1", displayName: "Night Market", main: "index.tsx" }), mtime: made });
  files.set(`${dir}/index.tsx`, { text: "", mtime: made });
  files.set(`${dir}/assets.yml`, { text: "", mtime: made });
});

describe("browserGetProject", () => {
  // New post exports a linked project again when this moves, so an edit made after the export goes out.
  it("dates the project by its last saved edit, not by when it was made", async () => {
    const edited = made + 60_000;
    files.set(`${dir}/composition.json`, { text: "{}", mtime: edited });
    expect((await browserGetProject(dir))?.modifiedAt).toBe(new Date(edited).toISOString());
  });

  it("dates a project nobody has edited by when it was made", async () => {
    expect((await browserGetProject(dir))?.modifiedAt).toBe(new Date(made).toISOString());
  });
});
