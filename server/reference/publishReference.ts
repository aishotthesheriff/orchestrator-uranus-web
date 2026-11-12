import fs from "fs/promises";
import path from "path";
import { storage } from "../storage";
import { clearReferenceCache } from "./referenceLoader";

export interface PublishReferenceOptions {
  version: string;
  author: string;
  notes?: string;
  makeCurrent?: boolean;
}

export interface PublishResult {
  version: string;
  manifest: Record<string, string>;
  publishedAt: string;
  /** Problems worth fixing that did not block the publish (shown to the admin). */
  warnings: string[];
}

/**
 * Publishes a new reference release by exporting all reference tables to JSON files
 * and creating a database record for the release.
 */
export async function publishReference(options: PublishReferenceOptions): Promise<PublishResult> {
  const { version, author, notes, makeCurrent = false } = options;

  // Create releases directory if it doesn't exist
  const releasesDir = path.join(process.cwd(), "releases");
  await fs.mkdir(releasesDir, { recursive: true });

  // Create version-specific directory
  const versionDir = path.join(releasesDir, version);
  await fs.mkdir(versionDir, { recursive: true });

  // Export reference tables to JSON
  const tables = ["items", "events", "npcs", "prompts", "image_prompts", "settings", "image_models", "mod_story_themes", "mod_visual_styles", "llm_models"];
  const manifest: Record<string, string> = {};

  for (const table of tables) {
    let data: any[] = [];
    
    try {
      switch (table) {
        case "items":
          data = await storage.getActiveItems();
          break;
        case "events":
          data = await storage.getActiveEvents();
          break;
        case "npcs":
          data = await storage.getActiveNpcTemplates();
          break;
        case "prompts":
          data = await storage.getActivePromptTemplates();
          break;
        case "image_prompts":
          data = await storage.getActiveImagePrompts();
          break;
        case "settings":
          // settings exported as key/value map in JSON file
          const settings = await storage.getActiveSettings?.();
          {
            const obj: Record<string, string> = {};
            if (settings && Array.isArray(settings)) {
              for (const s of settings as any[]) {
                obj[s.key] = s.value;
              }
            }
            // For settings, write a standalone object file
            const filePath = path.join(versionDir, `${table}.json`);
            await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf8");
            manifest[table] = filePath;
            continue; // skip common writer below
          }
        case "image_models":
          data = await storage.getActiveImageModels();
          break;
        case "mod_story_themes":
          data = await storage.getActiveStoryThemes();
          break;
        case "mod_visual_styles":
          data = await storage.getActiveVisualStyles();
          break;
        case "llm_models":
          data = await storage.getActiveLlmModels();
          break;
        default:
          console.warn(`[publish] Unknown table '${table}' in tables array, creating empty file`);
          data = [];
      }

      const filePath = path.join(versionDir, `${table}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
      manifest[table] = filePath;
      console.log(`[publish] Exported ${table}: ${data.length} records`);
    } catch (error) {
      console.error(`[publish] Error exporting ${table}:`, error);
      // Still create the file with empty array to maintain manifest consistency
      const filePath = path.join(versionDir, `${table}.json`);
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8");
      manifest[table] = filePath;
    }
  }

  // Generate system_defaults.json
  try {
    const defaultImageModel = await storage.getDefaultImageModel();
    const defaultVisualStyle = await storage.getDefaultVisualStyle();
    const defaultStoryTheme = await storage.getDefaultStoryTheme();
    const defaultLlmModel = await storage.getDefaultLlmModel();

    const systemDefaults: {
      image_model_key?: string;
      visual_style_key?: string;
      story_theme_key?: string;
      llm_model_key?: string;
    } = {};

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

    const systemDefaultsPath = path.join(versionDir, "system_defaults.json");
    await fs.writeFile(systemDefaultsPath, JSON.stringify(systemDefaults, null, 2), "utf8");
    manifest["system_defaults"] = systemDefaultsPath;
    console.log(`[publish] Exported system_defaults: ${JSON.stringify(systemDefaults)}`);
  } catch (error) {
    console.error(`[publish] Error exporting system_defaults:`, error);
    // Create empty defaults file to maintain manifest consistency
    const systemDefaultsPath = path.join(versionDir, "system_defaults.json");
    await fs.writeFile(systemDefaultsPath, JSON.stringify({}, null, 2), "utf8");
    manifest["system_defaults"] = systemDefaultsPath;
  }

  // Create manifest.json
  const manifestPath = path.join(versionDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  // Create metadata.json with release information
  const publishedAt = new Date().toISOString();
  const metadata = {
    version,
    publishedBy: author,
    publishedAt,
    notes: notes || null,
  };
  const metadataPath = path.join(versionDir, "metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

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

  // Story (LLM) model checks: none of these block publishing, but each would surprise a player.
  const warnings: string[] = [];
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
  };
}

/**
 * Copies all files from a version directory to the current directory
 */
async function copyVersionToCurrent(version: string): Promise<void> {
  const releasesDir = path.join(process.cwd(), "releases");
  const versionDir = path.join(releasesDir, version);
  const currentDir = path.join(releasesDir, "current");

  // Remove existing current directory if it exists
  try {
    await fs.rm(currentDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }

  // Create current directory
  await fs.mkdir(currentDir, { recursive: true });

  // Read manifest from version directory
  const manifestPath = path.join(versionDir, "manifest.json");
  const manifestContent = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent) as Record<string, string>;

  // Copy all files listed in manifest
  const newManifest: Record<string, string> = {};
  for (const [tableName, sourcePath] of Object.entries(manifest)) {
    const fileName = path.basename(sourcePath);
    const destPath = path.join(currentDir, fileName);
    
    // Copy the file
    await fs.copyFile(sourcePath, destPath);
    
    // Update manifest to point to current directory
    newManifest[tableName] = destPath;
  }

  // Write updated manifest to current directory
  const currentManifestPath = path.join(currentDir, "manifest.json");
  await fs.writeFile(currentManifestPath, JSON.stringify(newManifest, null, 2), "utf8");

  // Copy metadata.json to current directory
  const versionMetadataPath = path.join(versionDir, "metadata.json");
  const currentMetadataPath = path.join(currentDir, "metadata.json");
  try {
    await fs.copyFile(versionMetadataPath, currentMetadataPath);
  } catch (error) {
    console.warn(`[activate] Failed to copy metadata.json: ${error}`);
    // If metadata.json doesn't exist, create a basic one from database
    const release = await storage.getReferenceRelease(version);
    if (release) {
      const metadata = {
        version: release.version,
        publishedBy: release.published_by,
        publishedAt: release.published_at.toISOString(),
        notes: release.notes || null,
      };
      await fs.writeFile(currentMetadataPath, JSON.stringify(metadata, null, 2), "utf8");
    }
  }

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

/**
 * Gets all published reference releases
 */
export async function getAllReferenceReleases() {
  return await storage.getAllReferenceReleases();
}

/**
 * Gets the current active reference release metadata from database
 * Note: This returns metadata only (version, publishedAt, etc.)
 * The actual data files are loaded from releases/current/ directory
 */
export async function getCurrentReferenceRelease() {
  return await storage.getCurrentReferenceRelease();
}
