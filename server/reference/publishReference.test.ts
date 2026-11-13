import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createHash } from "crypto";

// Publishing reads the database through `storage` and writes under <cwd>/releases.
// Storage is faked and cwd points at a temp folder, so no database or real release is touched.
const db = {
  tables: {} as Record<string, Record<string, unknown>[]>,
  releases: [] as any[],
};

const active = (table: string) => (db.tables[table] ?? []).filter((r) => r.active === 1);

vi.mock("../storage.js", () => ({
  storage: {
    getActiveItems: async () => active("items").map((r) => ({ id: r.id, name: r.name, active: r.active })),
    getActiveEvents: async () => [],
    getActiveNpcTemplates: async () => [],
    getActivePromptTemplates: async () => [],
    getActiveImagePrompts: async () => [],
    getActiveSettings: async () => active("app_settings"),
    getActiveImageModels: async () => [],
    getActiveStoryThemes: async () => [],
    getActiveVisualStyles: async () => [],
    getActiveLlmModels: async () => [],
    getDefaultImageModel: async () => ({ modelKey: "flux-schnell" }),
    getDefaultVisualStyle: async () => null,
    getDefaultStoryTheme: async () => null,
    getDefaultLlmModel: async () => null,
    dumpContentTable: async (table: string) => db.tables[table] ?? [],
    getReferenceRelease: async (version: string) => db.releases.find((r) => r.version === version),
    getAllReferenceReleases: async () => db.releases,
    getCurrentReferenceRelease: async () => db.releases.find((r) => r.is_current === 1),
    createReferenceRelease: async (release: any) => {
      const row = { ...release, published_at: new Date("2026-01-02T03:04:05.000Z") };
      db.releases.push(row);
      return row;
    },
    updateReferenceRelease: async (version: string, updates: any) => {
      const row = db.releases.find((r) => r.version === version);
      Object.assign(row, updates);
      return row;
    },
    setCurrentReferenceRelease: async (version: string) => {
      for (const r of db.releases) r.is_current = r.version === version ? 1 : 0;
    },
  },
}));

import { CONTENT_TABLE_NAMES } from "./contentTables";
import {
  activateReferenceRelease,
  copyVersionToCurrent,
  getAllReferenceReleases,
  publishReference,
} from "./publishReference";
import { clearReferenceCache, getCurrentReference } from "./referenceLoader";

let root: string;
const releasePath = (...parts: string[]) => path.join(root, "releases", ...parts);
const readJson = async (...parts: string[]) => JSON.parse(await fs.readFile(releasePath(...parts), "utf8"));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uranus-publish-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  clearReferenceCache();
  db.releases = [];
  db.tables = {
    items: [
      { id: "wrench", name: "Wrench", tags: ["tool"], active: 1 },
      { id: "retired", name: "Retired item", tags: [], active: 0 },
    ],
    app_settings: [
      { key: "pce_enabled", value: "true", description: "Use the PCE", active: 1 },
      { key: "old_flag", value: "1", description: null, active: 0 },
    ],
    interview_questions: [{ id: "q1", question: "Name?", active: 1 }],
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("publishReference", () => {
  it("writes the runtime files with active rows only and a manifest of file names", async () => {
    await publishReference({ version: "v1.0.0", author: "tester" });

    expect(await readJson("v1.0.0", "items.json")).toEqual([{ id: "wrench", name: "Wrench", active: 1 }]);
    expect(await readJson("v1.0.0", "settings.json")).toEqual({ pce_enabled: "true" });
    expect(await readJson("v1.0.0", "system_defaults.json")).toEqual({ image_model_key: "flux-schnell" });

    const manifest = await readJson("v1.0.0", "manifest.json");
    expect(manifest.items).toBe("items.json");
    expect(manifest.system_defaults).toBe("system_defaults.json");
    for (const file of Object.values(manifest)) {
      expect(path.isAbsolute(file as string)).toBe(false);
    }
  });

  it("writes every row of every content table to the workspace, with counts and checksums", async () => {
    const result = await publishReference({ version: "v1.0.0", author: "tester", notes: "first" });

    // Inactive rows and tables the runtime files never held are included
    expect(await readJson("v1.0.0", "workspace", "items.json")).toEqual(db.tables.items);
    expect(await readJson("v1.0.0", "workspace", "app_settings.json")).toEqual(db.tables.app_settings);
    expect(await readJson("v1.0.0", "workspace", "interview_questions.json")).toEqual(db.tables.interview_questions);

    const metadata = await readJson("v1.0.0", "metadata.json");
    expect(metadata).toMatchObject({ version: "v1.0.0", publishedBy: "tester", notes: "first", formatVersion: 2 });
    expect(Object.keys(metadata.workspace).sort()).toEqual([...CONTENT_TABLE_NAMES].sort());
    expect(metadata.workspace.items.rows).toBe(2);
    expect(metadata.workspace.pce_test_scenarios.rows).toBe(0);

    const itemsFile = await fs.readFile(releasePath("v1.0.0", metadata.workspace.items.file), "utf8");
    expect(metadata.workspace.items.sha256).toBe(createHash("sha256").update(itemsFile, "utf8").digest("hex"));

    expect(result.formatVersion).toBe(2);
    expect(result.workspaceRows.items).toBe(2);
  });

  it("fails the publish when a content table cannot be read", async () => {
    const { storage } = await import("../storage.js");
    vi.spyOn(storage, "dumpContentTable").mockRejectedValueOnce(new Error("connection lost"));

    await expect(publishReference({ version: "v1.0.0", author: "tester" })).rejects.toThrow("connection lost");
    expect(db.releases).toHaveLength(0);
  });

  it("activates the release: current/ holds the files, the workspace, and loads in the game", async () => {
    await publishReference({ version: "v1.0.0", author: "tester", makeCurrent: true });

    expect(await readJson("current", "workspace", "items.json")).toEqual(db.tables.items);
    expect((await readJson("current", "metadata.json")).version).toBe("v1.0.0");
    expect(db.releases[0].is_current).toBe(1);

    const reference = await getCurrentReference();
    expect(reference.version).toBe("v1.0.0");
    expect(reference.data.items).toEqual([{ id: "wrench", name: "Wrench", active: 1 }]);
    expect(reference.data.settings).toEqual({ pce_enabled: "true" });
    expect(reference.data.system_defaults).toEqual({ image_model_key: "flux-schnell" });
  });

  it("rejects versions that are not safe directory names", async () => {
    for (const version of ["current", "../escape", "a/b", "", "v1 0", "x".repeat(65)]) {
      await expect(publishReference({ version, author: "tester" })).rejects.toThrow("Invalid release version");
    }
    await expect(fs.access(releasePath())).rejects.toThrow();
  });
});

describe("activating an older release", () => {
  // Releases published before format 2 recorded absolute paths from inside the Docker container.
  async function writeOldRelease(version: string) {
    await fs.mkdir(releasePath(version), { recursive: true });
    await fs.writeFile(releasePath(version, "items.json"), JSON.stringify([{ id: "old-item", active: 1 }]));
    await fs.writeFile(releasePath(version, "settings.json"), JSON.stringify({ a: "1" }));
    await fs.writeFile(
      releasePath(version, "manifest.json"),
      JSON.stringify({
        items: `/app/releases/${version}/items.json`,
        settings: `/app/releases/${version}/settings.json`,
      })
    );
    await fs.writeFile(
      releasePath(version, "metadata.json"),
      JSON.stringify({ version, publishedBy: "dev", publishedAt: "2025-10-28T00:00:00.000Z", notes: null })
    );
    db.releases.push({ version, published_by: "dev", notes: null, published_at: new Date(), is_current: 0 });
  }

  it("finds the files by name when the manifest holds paths from another machine", async () => {
    await writeOldRelease("v0.9.0");

    await activateReferenceRelease("v0.9.0");

    expect(await readJson("current", "manifest.json")).toEqual({ items: "items.json", settings: "settings.json" });
    expect((await getCurrentReference()).data.items).toEqual([{ id: "old-item", active: 1 }]);
    await expect(fs.access(releasePath("current", "workspace"))).rejects.toThrow();
  });

  it("leaves current/ untouched when the release's files are missing", async () => {
    await publishReference({ version: "v1.0.0", author: "tester", makeCurrent: true });
    await writeOldRelease("v0.9.0");
    await fs.rm(releasePath("v0.9.0", "items.json"));

    await expect(copyVersionToCurrent("v0.9.0")).rejects.toThrow();

    expect((await readJson("current", "metadata.json")).version).toBe("v1.0.0");
  });

  it("reports the format and whether the files are on disk for each release", async () => {
    await publishReference({ version: "v1.0.0", author: "tester" });
    await writeOldRelease("v0.9.0");
    db.releases.push({ version: "v0.1.0", published_by: "dev", notes: null, published_at: new Date(), is_current: 0 });

    const byVersion = Object.fromEntries((await getAllReferenceReleases()).map((r) => [r.version, r]));

    expect(byVersion["v1.0.0"]).toMatchObject({ filesOnDisk: true, formatVersion: 2 });
    expect(byVersion["v1.0.0"].workspaceRows?.items).toBe(2);
    expect(byVersion["v0.9.0"]).toMatchObject({ filesOnDisk: true, formatVersion: 1, workspaceRows: null });
    expect(byVersion["v0.1.0"]).toMatchObject({ filesOnDisk: false, formatVersion: null, workspaceRows: null });
  });
});
