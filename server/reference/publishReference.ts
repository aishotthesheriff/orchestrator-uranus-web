import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import type { ReferenceRelease } from "@shared/schema";
import { storage } from "../storage";
import { clearReferenceCache } from "./referenceLoader";
import { CONTENT_TABLES, RELEASE_FORMAT_VERSION, assertValidReleaseVersion } from "./contentTables";

export interface PublishReferenceOptions {
  version: string;
  author: string;
  notes?: string;
  makeCurrent?: boolean;
}

/** One workspace file of a release: where it is, how many rows it holds, and its checksum. */
export interface WorkspaceFileInfo {
  file: string;
  rows: number;
  sha256: string;
}

/** The contents of a release's metadata.json. Format 1 releases have only the first four fields. */
export interface ReleaseMetadata {
  version: string;
  publishedBy: string;
  publishedAt: string;
  notes: string | null;
  formatVersion?: number;
  workspace?: Record<string, WorkspaceFileInfo>;
}

export interface PublishResult {
  version: string;
  manifest: Record<string, string>;
  publishedAt: string;
  /** Problems worth fixing that did not block the publish (shown to the admin). */
  warnings: string[];
  formatVersion: number;
  /** Rows written per content table (active and inactive). */
  workspaceRows: Record<string, number>;
}

/** A release row plus what is on disk for it. */
export type ReferenceReleaseInfo = ReferenceRelease & {
  /** False when releases/<version>/ is missing, so the release cannot be activated here. */
  filesOnDisk: boolean;
  /** 1 = runtime files only (active rows); 2 = also the full workspace. Null when not on disk. */
  formatVersion: number | null;
  /** Rows per content table in the release's workspace (format 2 only). */
  workspaceRows: Record<string, number> | null;
};

/** The runtime tables, in the order they are exported. Each becomes `<name>.json`. */
const RUNTIME_TABLES = [
  "items",
  "events",
  "npcs",
  "prompts",
  "image_prompts",
  "settings",
  "image_models",
  "mod_story_themes",
  "mod_visual_styles",
  "llm_models",
] as const;

const WORKSPACE_DIR = "workspace";

function releasesRoot(): string {
  return path.join(process.cwd(), "releases");
}

function toJsonFile(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function loadRuntimeTable(table: (typeof RUNTIME_TABLES)[number]): Promise<unknown> {
  switch (table) {
    case "items":
      return storage.getActiveItems();
    case "events":
      return storage.getActiveEvents();
    case "npcs":
      return storage.getActiveNpcTemplates();
    case "prompts":
      return storage.getActivePromptTemplates();
    case "image_prompts":
      return storage.getActiveImagePrompts();
    case "settings": {
      // Settings are exported as a key/value map, not an array of rows.
      const settings = await storage.getActiveSettings();
      const obj: Record<string, string> = {};
      for (const s of settings as any[]) obj[s.key] = s.value;
      return obj;
    }
    case "image_models":
      return storage.getActiveImageModels();
    case "mod_story_themes":
      return storage.getActiveStoryThemes();
    case "mod_visual_styles":
      return storage.getActiveVisualStyles();
    case "llm_models":
      return storage.getActiveLlmModels();
  }
}

export interface RuntimeExportResult {
  /** Table name to file name (relative to the release directory). */
  manifest: Record<string, string>;
  /** Tables that could not be read and were written empty. */
  errors: string[];
}

/**
 * Writes the runtime files the game loads (active rows only) plus system_defaults.json and
 * manifest.json into `dir`. Used by publishing, and by the release verifier to compare what
 * the database would publish now against a published release.
 */
export async function exportReferenceTables(dir: string): Promise<RuntimeExportResult> {
  await fs.mkdir(dir, { recursive: true });
  const manifest: Record<string, string> = {};
  const errors: string[] = [];

  for (const table of RUNTIME_TABLES) {
    const fileName = `${table}.json`;
    try {
      const data = await loadRuntimeTable(table);
      await fs.writeFile(path.join(dir, fileName), toJsonFile(data), "utf8");
      const count = Array.isArray(data) ? data.length : Object.keys(data as object).length;
      console.log(`[publish] Exported ${table}: ${count} records`);
    } catch (error) {
      console.error(`[publish] Error exporting ${table}:`, error);
      // Still create the file, empty, to keep the manifest consistent.
      await fs.writeFile(path.join(dir, fileName), toJsonFile(table === "settings" ? {} : []), "utf8");
      errors.push(`Could not export ${table}; it was published empty (${error instanceof Error ? error.message : String(error)}).`);
    }
    manifest[table] = fileName;
  }

  // system_defaults.json: the default model, style and theme keys
  const systemDefaults: {
    image_model_key?: string;
    visual_style_key?: string;
    story_theme_key?: string;
    llm_model_key?: string;
  } = {};
  try {
    const defaultImageModel = await storage.getDefaultImageModel();
    const defaultVisualStyle = await storage.getDefaultVisualStyle();
    const defaultStoryTheme = await storage.getDefaultStoryTheme();
    const defaultLlmModel = await storage.getDefaultLlmModel();

    if (defaultImageModel) {
      systemDefaults.image_model_key = defaultImageModel.modelKey;
    } else {
      console.warn(`[publish] No default image model found (is_default = true)`);
    }

    if (defaultVisualStyle) {
      systemDefaults.visual_style_key = defaultVisualStyle.visualStyleKey;
    } else {
      console.warn(`[publish] No default visual style found (default = true)`);
    }

    if (defaultStoryTheme) {
      systemDefaults.story_theme_key = defaultStoryTheme.storyThemeKey;
    } else {
      console.warn(`[publish] No default story theme found (default = true)`);
    }

    if (defaultLlmModel) {
      systemDefaults.llm_model_key = defaultLlmModel.modelKey;
    } else {
      console.warn(`[publish] No default story (LLM) model found (is_default = true); the game will use its built-in model`);
    }

    await fs.writeFile(path.join(dir, "system_defaults.json"), toJsonFile(systemDefaults), "utf8");
    console.log(`[publish] Exported system_defaults: ${JSON.stringify(systemDefaults)}`);
  } catch (error) {
    console.error(`[publish] Error exporting system_defaults:`, error);
    await fs.writeFile(path.join(dir, "system_defaults.json"), toJsonFile({}), "utf8");
    errors.push(`Could not export system defaults; they were published empty (${error instanceof Error ? error.message : String(error)}).`);
  }
  manifest["system_defaults"] = "system_defaults.json";

  await fs.writeFile(path.join(dir, "manifest.json"), toJsonFile(manifest), "utf8");
  return { manifest, errors };
}

/**
 * Writes every row of every content table (active and inactive, raw database rows) into
 * `<dir>/workspace/`. This is what lets an empty database be loaded from the release.
 * Unlike the runtime export, a table that cannot be read fails the whole export.
 */
export async function exportWorkspace(dir: string): Promise<Record<string, WorkspaceFileInfo>> {
  const workspaceDir = path.join(dir, WORKSPACE_DIR);
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const result: Record<string, WorkspaceFileInfo> = {};
  for (const spec of CONTENT_TABLES) {
    const rows = await storage.dumpContentTable(spec.table);
    const content = toJsonFile(rows);
    const file = `${WORKSPACE_DIR}/${spec.table}.json`;
    await fs.writeFile(path.join(dir, file), content, "utf8");
    result[spec.table] = {
      file,
      rows: rows.length,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    };
    console.log(`[publish] Workspace ${spec.table}: ${rows.length} rows`);
  }
  return result;
}

/** Reads releases/<dirName>/metadata.json, or null when it is missing or unreadable. */
export async function readReleaseMetadata(dirName: string): Promise<ReleaseMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(releasesRoot(), dirName, "metadata.json"), "utf8");
    return JSON.parse(raw) as ReleaseMetadata;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Publishes a new reference release by exporting all reference tables to JSON files
 * and creating a database record for the release.
 */
export async function publishReference(options: PublishReferenceOptions): Promise<PublishResult> {
  const { version, author, notes, makeCurrent = false } = options;
  assertValidReleaseVersion(version);

  // Create the version-specific directory
  const versionDir = path.join(releasesRoot(), version);
  await fs.mkdir(versionDir, { recursive: true });

  // Runtime files (what the game loads) and the full workspace (what a database is loaded from)
  const { manifest, errors: exportErrors } = await exportReferenceTables(versionDir);
  const workspace = await exportWorkspace(versionDir);

  // Create metadata.json with release information
  const publishedAt = new Date().toISOString();
  const metadata: ReleaseMetadata = {
    version,
    publishedBy: author,
    publishedAt,
    notes: notes || null,
    formatVersion: RELEASE_FORMAT_VERSION,
    workspace,
  };
  const metadataPath = path.join(versionDir, "metadata.json");
  await fs.writeFile(metadataPath, toJsonFile(metadata), "utf8");

  // Validate that at least one image model has isDefault = true
  try {
    const modelsPath = path.join(versionDir, `image_models.json`);
    const modelsRaw = await fs.readFile(modelsPath, "utf8").catch(() => "[]");
    const models = JSON.parse(modelsRaw) as any[];
    const hasDefault = models.some(m => (m.isDefault === true || m.is_default === true));
    if (!hasDefault) {
      console.warn(`[publish] No image model with isDefault=true found in image_models; consider setting one as default.`);
    }
  } catch (e) {
    console.warn(`[publish] Skipped isDefault validation: ${e}`);
  }

  // None of these block publishing, but each would surprise a player.
  const warnings: string[] = [...exportErrors];
  try {
    const llmModels = await storage.getActiveLlmModels();
    const activeKeys = new Set(llmModels.map(m => m.modelKey));
    if (!llmModels.some(m => m.isDefault)) {
      warnings.push("No story model is marked as default; the game will use its built-in model (gpt-4o-mini).");
    }
    for (const model of llmModels) {
      if (model.lastCheckOk === false) {
        warnings.push(`Story model "${model.displayName}" (${model.modelKey}) failed its last health check.`);
      }
      if (model.fallbackModelKey && !activeKeys.has(model.fallbackModelKey)) {
        warnings.push(`Story model "${model.displayName}" falls back to "${model.fallbackModelKey}", which is not an active catalog model; the default model will be used instead.`);
      }
    }
    for (const theme of await storage.getActiveStoryThemes()) {
      if (theme.llmModelKey && !activeKeys.has(theme.llmModelKey)) {
        warnings.push(`Theme "${theme.label}" forces story model "${theme.llmModelKey}", which is not an active catalog model; it will fall back to the default.`);
      }
    }
  } catch (e) {
    console.warn(`[publish] Skipped story model validation: ${e}`);
  }
  for (const warning of warnings) console.warn(`[publish] ${warning}`);

  // Insert or update database record
  let release = await storage.getReferenceRelease(version);
  if (release) {
    // Release already exists, update it
    release = await storage.updateReferenceRelease(version, {
      published_by: author,
      notes: notes || null,
      is_current: makeCurrent ? 1 : 0,
    });
    console.log(`[publish] Updated existing reference release ${version}`);
  } else {
    // New release, create it
    release = await storage.createReferenceRelease({
      version,
      published_by: author,
      notes: notes || null,
      is_current: makeCurrent ? 1 : 0,
    });
    console.log(`[publish] Created new reference release ${version}`);
  }

  // If making current, copy to current directory and update database
  if (makeCurrent) {
    await copyVersionToCurrent(version);
    await storage.setCurrentReferenceRelease(version);
    clearReferenceCache(); // Clear cache when publishing as current
    console.log(`[publish] Published and activated ${version} - copied to current/`);
  }

  return {
    version: release.version,
    manifest,
    publishedAt: release.published_at.toISOString(),
    warnings,
    formatVersion: RELEASE_FORMAT_VERSION,
    workspaceRows: Object.fromEntries(Object.entries(workspace).map(([table, info]) => [table, info.rows])),
  };
}

/**
 * Makes releases/current/ a copy of a version directory.
 *
 * Files are located by name inside the version directory, so releases whose manifest holds
 * absolute paths from another machine (older releases recorded `/app/releases/...`) still work.
 * The copy is built next to current/ and swapped in, so current/ is never left half written.
 */
export async function copyVersionToCurrent(version: string): Promise<void> {
  assertValidReleaseVersion(version);
  const releasesDir = releasesRoot();
  const versionDir = path.join(releasesDir, version);
  const currentDir = path.join(releasesDir, "current");
  const stagingDir = path.join(releasesDir, ".current-staging");

  // Read manifest from version directory
  const manifestContent = await fs.readFile(path.join(versionDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestContent) as Record<string, string>;

  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  // Copy all files listed in manifest
  const newManifest: Record<string, string> = {};
  for (const [tableName, recordedPath] of Object.entries(manifest)) {
    const fileName = path.basename(recordedPath);
    await fs.copyFile(path.join(versionDir, fileName), path.join(stagingDir, fileName));
    newManifest[tableName] = fileName;
  }
  await fs.writeFile(path.join(stagingDir, "manifest.json"), toJsonFile(newManifest), "utf8");

  // The workspace (format 2 releases)
  const workspaceDir = path.join(versionDir, WORKSPACE_DIR);
  if (await exists(workspaceDir)) {
    await fs.cp(workspaceDir, path.join(stagingDir, WORKSPACE_DIR), { recursive: true });
  }

  // Copy metadata.json to current directory
  const stagedMetadataPath = path.join(stagingDir, "metadata.json");
  try {
    await fs.copyFile(path.join(versionDir, "metadata.json"), stagedMetadataPath);
  } catch (error) {
    console.warn(`[activate] Failed to copy metadata.json: ${error}`);
    // If metadata.json doesn't exist, create a basic one from database
    const release = await storage.getReferenceRelease(version);
    if (release) {
      const metadata: ReleaseMetadata = {
        version: release.version,
        publishedBy: release.published_by,
        publishedAt: release.published_at.toISOString(),
        notes: release.notes || null,
      };
      await fs.writeFile(stagedMetadataPath, toJsonFile(metadata), "utf8");
    }
  }

  // Swap the finished copy in
  await fs.rm(currentDir, { recursive: true, force: true });
  await fs.rename(stagingDir, currentDir);

  console.log(`[activate] Copied all files from ${version} to current/`);
}

/**
 * Activates an existing reference release by setting it as current
 */
export async function activateReferenceRelease(version: string): Promise<void> {
  // Check if release exists
  const release = await storage.getReferenceRelease(version);
  if (!release) {
    throw new Error(`Reference release '${version}' not found`);
  }

  // Copy all files from version directory to current directory
  await copyVersionToCurrent(version);

  // Set as current in database
  await storage.setCurrentReferenceRelease(version);

  // Clear cache so next request loads new version
  clearReferenceCache();
  console.log(`✅ Activated reference version ${version} and cleared cache`);
}

async function describeRelease(release: ReferenceRelease): Promise<ReferenceReleaseInfo> {
  const filesOnDisk = await exists(path.join(releasesRoot(), release.version, "manifest.json"));
  const metadata = filesOnDisk ? await readReleaseMetadata(release.version) : null;
  return {
    ...release,
    filesOnDisk,
    formatVersion: filesOnDisk ? metadata?.formatVersion ?? 1 : null,
    workspaceRows: metadata?.workspace
      ? Object.fromEntries(Object.entries(metadata.workspace).map(([table, info]) => [table, info.rows]))
      : null,
  };
}

/**
 * Gets all published reference releases, with what is on disk for each
 */
export async function getAllReferenceReleases(): Promise<ReferenceReleaseInfo[]> {
  const releases = await storage.getAllReferenceReleases();
  return Promise.all(releases.map(describeRelease));
}

/**
 * Gets the current active reference release metadata from database
 * Note: This returns metadata only (version, publishedAt, etc.)
 * The actual data files are loaded from releases/current/ directory
 */
export async function getCurrentReferenceRelease(): Promise<ReferenceReleaseInfo | undefined> {
  const release = await storage.getCurrentReferenceRelease();
  return release ? describeRelease(release) : undefined;
}
