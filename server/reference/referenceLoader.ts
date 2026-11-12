import fs from "fs/promises";
import path from "path";
import { storage } from "../storage";

export interface ReferenceData {
  version: string;
  data: {
    items: any[];
    events: any[];
    npcs: any[];
    prompts: any[];
    image_prompts: any[];
    settings: Record<string, string>;
    image_models: any[];
    llm_models?: any[];
    mod_story_themes?: any[];
    mod_visual_styles?: any[];
    system_defaults?: {
      image_model_key?: string;
      visual_style_key?: string;
      story_theme_key?: string;
      llm_model_key?: string;
    };
  };
  publishedAt: string;
  publishedBy: string;
  notes?: string;
}

let cache: ReferenceData | null = null;

/**
 * Gets the current active reference data with TTL caching
 * Now loads from releases/current/ directory instead of version lookup
 */
export async function getCurrentReference(): Promise<ReferenceData> {
  // Check if cache exists (no TTL check)
  if (cache) {
    return cache;
  }

  // Load reference data from releases/current/ directory
  const currentDir = path.join(process.cwd(), "releases", "current");
  const manifestPath = path.join(currentDir, "manifest.json");
  const metadataPath = path.join(currentDir, "metadata.json");

  try {
    // Check if current directory exists
    try {
      await fs.access(currentDir);
    } catch {
      throw new Error("No current reference directory found. Please activate a reference release first.");
    }

    // Load metadata from metadata.json file
    let metadata: { version: string; publishedBy: string; publishedAt: string; notes: string | null };
    try {
      const metadataContent = await fs.readFile(metadataPath, "utf8");
      metadata = JSON.parse(metadataContent);
    } catch (error) {
      throw new Error(`Failed to load metadata.json from current/: ${error}`);
    }

    // Load manifest and data files
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    const data: Record<string, any> = {};
    for (const [tableName, filePath] of Object.entries(manifest)) {
      try {
        // Resolve file path: if it's an absolute Docker path, convert to relative
        // Otherwise, if it's already relative, use it as-is
        if (typeof filePath !== 'string') {
          console.warn(`Invalid filePath for ${tableName}: expected string, got ${typeof filePath}`);
          continue;
        }
        let resolvedPath: string;
        if (filePath.startsWith('/app/releases/current/')) {
          // Docker absolute path - convert to relative path
          const fileName = path.basename(filePath);
          resolvedPath = path.join(currentDir, fileName);
        } else if (path.isAbsolute(filePath)) {
          // Other absolute path - try to resolve relative to currentDir if it's in releases/current
          const fileName = path.basename(filePath);
          resolvedPath = path.join(currentDir, fileName);
        } else {
          // Relative path - resolve relative to currentDir
          resolvedPath = path.join(currentDir, filePath);
        }
        
        const fileContent = await fs.readFile(resolvedPath, "utf8");
        data[tableName] = JSON.parse(fileContent);
      } catch (error) {
        console.warn(`Failed to load ${tableName} from ${filePath}:`, error);
        // Set appropriate default based on expected data type
        if (tableName === "settings" || tableName === "system_defaults") {
          data[tableName] = {};
        } else {
          data[tableName] = [];
        }
      }
    }

    // Update cache with metadata from file (no database query needed)
    cache = {
      version: metadata.version,
      data: {
        items: data.items || [],
        events: data.events || [],
        npcs: data.npcs || [],
        prompts: data.prompts || [],
        image_prompts: data.image_prompts || [],
        settings: data.settings || {},
        image_models: data.image_models || [],
        llm_models: data.llm_models || [],
        mod_story_themes: data.mod_story_themes || [],
        mod_visual_styles: data.mod_visual_styles || [],
        system_defaults: data.system_defaults || undefined,
      },
      publishedAt: metadata.publishedAt,
      publishedBy: metadata.publishedBy,
      notes: metadata.notes || undefined,
    };

    return cache;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load reference data from current/: ${errorMessage}`);
  }
}

/**
 * Clears the reference cache (useful for testing or manual cache invalidation)
 */
export function clearReferenceCache(): void {
  cache = null;
}

/**
 * Gets reference data for a specific version (bypasses cache)
 */
export async function getReferenceByVersion(version: string): Promise<ReferenceData> {
  const release = await storage.getReferenceRelease(version);
  if (!release) {
    throw new Error(`Reference release '${version}' not found`);
  }

  const folder = path.join(process.cwd(), "releases", version);
  const manifestPath = path.join(folder, "manifest.json");

  const manifestContent = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

    const data: Record<string, any> = {};
    for (const [tableName, filePath] of Object.entries(manifest)) {
      try {
        // Resolve file path: if it's an absolute Docker path, convert to relative
        // Otherwise, if it's already relative, use it as-is
        if (typeof filePath !== 'string') {
          console.warn(`Invalid filePath for ${tableName}: expected string, got ${typeof filePath}`);
          continue;
        }
        let resolvedPath: string;
        if (filePath.startsWith('/app/releases/current/') || filePath.startsWith('/app/releases/')) {
          // Docker absolute path - convert to relative path
          const fileName = path.basename(filePath);
          resolvedPath = path.join(folder, fileName);
        } else if (path.isAbsolute(filePath)) {
          // Other absolute path - try to resolve relative to folder if it's in releases/
          const fileName = path.basename(filePath);
          resolvedPath = path.join(folder, fileName);
        } else {
          // Relative path - resolve relative to folder
          resolvedPath = path.join(folder, filePath);
        }
        
        const fileContent = await fs.readFile(resolvedPath, "utf8");
        data[tableName] = JSON.parse(fileContent);
      } catch (error) {
        console.warn(`Failed to load ${tableName} from ${filePath}:`, error);
        // Set appropriate default based on expected data type
        if (tableName === "settings" || tableName === "system_defaults") {
          data[tableName] = {};
        } else {
          data[tableName] = [];
        }
      }
    }

  return {
    version: release.version,
    data: {
      items: data.items || [],
      events: data.events || [],
      npcs: data.npcs || [],
      prompts: data.prompts || [],
      image_prompts: data.image_prompts || [],
      settings: data.settings || {},
      image_models: data.image_models || [],
      llm_models: data.llm_models || [],
      mod_story_themes: data.mod_story_themes || [],
      mod_visual_styles: data.mod_visual_styles || [],
      system_defaults: data.system_defaults || undefined,
    },
    publishedAt: release.published_at.toISOString(),
    publishedBy: release.published_by,
    notes: release.notes || undefined,
  };
}
