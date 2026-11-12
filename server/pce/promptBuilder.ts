import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import { templateLoadDuration } from "../metrics.js";
import { getCurrentReference } from "../reference/referenceLoader.js";
import { storage } from "../storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type PceTemplateName = "master" | "narrative" | "image" | "actions";
type InternalTemplateName = PceTemplateName | "legacyMaster";

const TEMPLATE_FILES: Record<InternalTemplateName, string> = {
  master: "masterPrompt.txt",
  narrative: "narrativePrompt.txt",
  image: "imagePrompt.txt",
  actions: "actionsPrompt.txt",
  legacyMaster: "legacyMasterPrompt.txt"
};

// Map PCE template names to prompt_templates.name in database
const PCE_PROMPT_NAMES: Record<PceTemplateName, string> = {
  master: "pce_master",
  narrative: "pce_narrative",
  image: "pce_image",
  actions: "pce_actions"
};

const templateCache = new Map<InternalTemplateName, string>();

interface TemplateLoadMetricsState {
  cacheHits: number;
  cacheMisses: number;
  lastLoadDurationMs: number | null;
  lastLoadTimestamp: string | null;
  lastLoadWasCacheHit: boolean | null;
}

const templateMetrics = new Map<InternalTemplateName, TemplateLoadMetricsState>();

function getOrCreateMetrics(templateName: InternalTemplateName): TemplateLoadMetricsState {
  let metrics = templateMetrics.get(templateName);
  if (!metrics) {
    metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      lastLoadDurationMs: null,
      lastLoadTimestamp: null,
      lastLoadWasCacheHit: null
    };
    templateMetrics.set(templateName, metrics);
  }
  return metrics;
}

function recordTemplateLoadMetrics(
  templateName: InternalTemplateName,
  durationMs: number,
  wasCacheHit: boolean
): void {
  const metrics = getOrCreateMetrics(templateName);
  if (wasCacheHit) {
    metrics.cacheHits += 1;
  } else {
    metrics.cacheMisses += 1;
  }

  metrics.lastLoadDurationMs = durationMs;
  metrics.lastLoadTimestamp = new Date().toISOString();
  metrics.lastLoadWasCacheHit = wasCacheHit;
}

const TEMPLATE_DOC_BLOCK_PATTERN = /<!--\s*PCE_TEMPLATE_DOC_START[\s\S]*?PCE_TEMPLATE_DOC_END\s*-->/g;
const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

export type MetaPromptPlaceholderIssueReason = "missing-variable" | "missing-path" | "non-scalar";

export interface MetaPromptPlaceholderIssue {
  placeholder: string;
  reason: MetaPromptPlaceholderIssueReason;
  path: string;
}

export interface BuildMetaPromptOptions {
  /**
   * When true, the template will be validated against the provided variables
   * and the call will throw if any placeholders cannot be satisfied.
   */
  validate?: boolean;
}

/**
 * Separated prompts interface for system/user separation
 */
export interface SeparatedPrompts {
  system: string;
  user: string;
}

/**
 * Loads PCE prompt directly from database
 * Returns null if not found in database (will fall back to file)
 */
async function loadPcePromptFromDatabase(
  templateName: PceTemplateName
): Promise<{ system: string; user: string } | null> {
  try {
    const promptName = PCE_PROMPT_NAMES[templateName];
    const prompt = await storage.getActivePromptTemplate(promptName);

    if (!prompt) {
      return null; // Not found in database, fall back to file
    }

    // Find global system prompt for inheritance
    const globalPrompt = await storage.getActivePromptTemplate("global_system_prompt");

    let systemPrompt: string;
    // Support both snake_case (from database) and camelCase (for compatibility)
    const inheritGlobalPrompt = prompt.inherit_global_prompt ?? prompt.inheritGlobalPrompt;
    const systemContent = prompt.system_content ?? prompt.systemContent;

    // Check if inheritance is enabled (explicitly 1) and global prompt exists
    if (inheritGlobalPrompt === 1 && globalPrompt) {
      systemPrompt = globalPrompt.content;
      if (systemContent) {
        systemPrompt = systemPrompt + "\n\n" + systemContent;
      }
      // Validate that we have a system prompt after inheritance
      if (!systemPrompt || !systemPrompt.trim()) {
        throw new Error(
          `PCE prompt '${promptName}' has empty system prompt after global inheritance. Global prompt inheritance enabled but global_system_prompt has empty content.`
        );
      }
    } else {
      // Inheritance disabled (0) or no global prompt - use only systemContent
      if (!systemContent || !systemContent.trim()) {
        throw new Error(
          `PCE prompt '${promptName}' has empty system prompt. Check database - ensure either systemContent is set or inheritGlobalPrompt is enabled (1) with a valid global_system_prompt.`
        );
      }
      systemPrompt = systemContent;
    }

    // User prompt is always the content field
    const userPrompt = prompt.content || "";

    if (!userPrompt.trim()) {
      throw new Error(
        `PCE prompt '${promptName}' exists in database but has empty user prompt (content). Please ensure content field is populated.`
      );
    }

    return {
      system: systemPrompt,
      user: userPrompt
    };
  } catch (error) {
    console.warn(`Failed to load PCE prompt from database: ${error}`);
    return null;
  }
}

/**
 * Loads PCE prompt from reference system (database/reference files)
 * Returns null if not found in reference (will fall back to file)
 */
async function loadPcePromptFromReference(
  templateName: PceTemplateName
): Promise<{ system: string; user: string } | null> {
  try {
    const reference = await getCurrentReference();
    const promptName = PCE_PROMPT_NAMES[templateName];
    const prompt = reference.data.prompts.find(
      (p: any) => p.name === promptName && p.active === 1
    );

    if (!prompt) {
      return null; // Not found in reference, fall back to file
    }

    // Find global system prompt for inheritance
    const globalPrompt = reference.data.prompts.find(
      (p: any) => p.name === "global_system_prompt" && p.active === 1
    );

    let systemPrompt: string;
    const inheritGlobalPrompt = prompt.inherit_global_prompt ?? prompt.inheritGlobalPrompt ?? 1;
    const systemContent = prompt.system_content ?? prompt.systemContent;

    if (inheritGlobalPrompt === 1 && globalPrompt) {
      systemPrompt = globalPrompt.content;
      if (systemContent) {
        systemPrompt = systemPrompt + "\n\n" + systemContent;
      }
    } else {
      systemPrompt = systemContent || "";
    }

    // User prompt is always the content field
    const userPrompt = prompt.content || "";

    if (!systemPrompt.trim() || !userPrompt.trim()) {
      throw new Error(
        `PCE prompt '${promptName}' exists in reference but has empty system or user content. Please ensure both systemContent and content fields are populated.`
      );
    }

    return {
      system: systemPrompt,
      user: userPrompt
    };
  } catch (error) {
    console.warn(`Failed to load PCE prompt from reference: ${error}`);
    return null;
  }
}

/**
 * Loads the master prompt template from masterPrompt.txt
 * Uses caching to avoid reading from disk on every call
 * (Used as fallback when prompt not in reference system)
 */
async function loadTemplateInternal(templateName: InternalTemplateName): Promise<string> {
  const startTime = performance.now();
  const timer = templateLoadDuration.startTimer({ template: templateName, cache: 'miss' });

  if (templateCache.has(templateName)) {
    const cached = templateCache.get(templateName);
    if (cached !== undefined) {
      const duration = performance.now() - startTime;
      recordTemplateLoadMetrics(templateName, duration, true);
      timer({ cache: 'hit' });
      return cached;
    }
  }

  const templateFile = TEMPLATE_FILES[templateName];
  const templatePath = path.join(__dirname, templateFile);

  try {
    const template = await fs.readFile(templatePath, "utf8");
    templateCache.set(templateName, template);
    const duration = performance.now() - startTime;
    recordTemplateLoadMetrics(templateName, duration, false);
    timer({ cache: 'miss' });
    return template;
  } catch (error) {
    const duration = performance.now() - startTime;
    recordTemplateLoadMetrics(templateName, duration, false);
    timer({ cache: 'miss' });
    throw new Error(`Failed to load prompt template '${templateName}' from ${templatePath}: ${error}`);
  }
}

export async function loadTemplate(templateName: PceTemplateName): Promise<string> {
  return loadTemplateInternal(templateName);
}

/**
 * Clears the template cache (useful for testing or when template is updated)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  templateMetrics.clear();
}

export interface TemplateLoadMetricsSnapshot {
  cacheHits: number;
  cacheMisses: number;
  totalLoads: number;
  lastLoadDurationMs: number | null;
  lastLoadTimestamp: string | null;
  lastLoadWasCacheHit: boolean | null;
  perTemplate: Record<string, TemplateLoadMetricsState & { totalLoads: number }>;
}

export function getTemplateLoadMetrics(): TemplateLoadMetricsSnapshot {
  let cacheHits = 0;
  let cacheMisses = 0;
  let lastLoadTimestamp: string | null = null;
  let lastLoadDurationMs: number | null = null;
  let lastLoadWasCacheHit: boolean | null = null;

  const perTemplate: Record<string, TemplateLoadMetricsState & { totalLoads: number }> = {};

  templateMetrics.forEach((metrics, templateName) => {
    const totalLoads = metrics.cacheHits + metrics.cacheMisses;
    perTemplate[templateName] = {
      ...metrics,
      totalLoads
    };

    cacheHits += metrics.cacheHits;
    cacheMisses += metrics.cacheMisses;

    const lastTimestamp = metrics.lastLoadTimestamp;
    if (!lastTimestamp) {
      return;
    }

    if (!lastLoadTimestamp || lastTimestamp > lastLoadTimestamp) {
      lastLoadTimestamp = lastTimestamp;
      lastLoadDurationMs = metrics.lastLoadDurationMs;
      lastLoadWasCacheHit = metrics.lastLoadWasCacheHit;
    }
  });

  return {
    cacheHits,
    cacheMisses,
    totalLoads: cacheHits + cacheMisses,
    lastLoadDurationMs,
    lastLoadTimestamp,
    lastLoadWasCacheHit,
    perTemplate
  };
}

/**
 * Strips documentation annotations from the template so that only prompt
 * content is delivered to the LLM.
 */
function stripTemplateAnnotations(rawTemplate: string): string {
  return rawTemplate.replace(TEMPLATE_DOC_BLOCK_PATTERN, "").trimStart();
}

/**
 * Escapes a string for safe inclusion in a RegExp constructor.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates that every placeholder used in the template can be satisfied
 * by the provided variables.
 */
export function validateMetaPromptVariables(
  template: string,
  variables: Record<string, unknown>
): MetaPromptPlaceholderIssue[] {
  const issues: MetaPromptPlaceholderIssue[] = [];
  const templateBody = stripTemplateAnnotations(template);
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_PATTERN.exec(templateBody)) !== null) {
    const rawPath = match[1];
    if (!rawPath || seen.has(rawPath)) {
      continue;
    }

    seen.add(rawPath);
    const segments = rawPath.split(".");
    const rootKey = segments[0];
    const placeholder = `{{${rawPath}}}`;

    if (!Object.prototype.hasOwnProperty.call(variables, rootKey)) {
      issues.push({
        placeholder,
        reason: "missing-variable",
        path: rootKey
      });
      continue;
    }

    let current: unknown = (variables as any)[rootKey];

    if (segments.length === 1) {
      if (current === null || current === undefined) {
        issues.push({
          placeholder,
          reason: "missing-variable",
          path: rootKey
        });
      } else if (typeof current === "object" && !Array.isArray(current)) {
        issues.push({
          placeholder,
          reason: "non-scalar",
          path: rootKey
        });
      }
      continue;
    }

    let encounteredIssue: MetaPromptPlaceholderIssue | null = null;
    for (let i = 1; i < segments.length; i += 1) {
      const segment = segments[i];
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object"
      ) {
        encounteredIssue = {
          placeholder,
          reason: "missing-path",
          path: `${segments.slice(0, i).join(".")}.${segment}`
        };
        break;
      }

      current = (current as any)[segment];
    }

    if (!encounteredIssue && (current === null || current === undefined)) {
      encounteredIssue = {
        placeholder,
        reason: "missing-path",
        path: rawPath
      };
    }

    if (encounteredIssue) {
      issues.push(encounteredIssue);
    }
  }

  return issues;
}

/**
 * Gets a nested property value from an object using dot notation
 * e.g., "IMAGE_MODEL.modelKey" -> imageModel.modelKey
 */
function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((current, prop) => current?.[prop], obj);
}

function renderTemplateString(
  template: string,
  variables: Record<string, any>,
  options?: BuildMetaPromptOptions
): string {
  const templateBody = stripTemplateAnnotations(template);

  if (options?.validate) {
    const issues = validateMetaPromptVariables(template, variables);
    if (issues.length > 0) {
      const formattedIssues = issues.map(issue => {
        switch (issue.reason) {
          case "missing-variable":
            return `${issue.placeholder} (missing variable '${issue.path}')`;
          case "missing-path":
            return `${issue.placeholder} (missing path '${issue.path}')`;
          case "non-scalar":
            return `${issue.placeholder} (expected scalar value for '${issue.path}')`;
          default:
            return `${issue.placeholder}`;
        }
      });
      throw new Error(`Meta prompt validation failed: ${formattedIssues.join(", ")}`);
    }
  }

  let result = templateBody;
  const unresolvedPlaceholders: Set<string> = new Set();

  for (const [key, value] of Object.entries(variables)) {
    if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
      const nestedRegex = new RegExp(`\\{\\{${escapeRegExp(key)}\\.([^}]+)\\}\\}`, "g");
      result = result.replace(nestedRegex, (match, propertyPath) => {
        const nestedValue = getNestedValue(value, propertyPath);
        if (nestedValue === null || nestedValue === undefined) {
          unresolvedPlaceholders.add(match);
          return "";
        }
        return String(nestedValue);
      });
    } else {
      const nestedRegex = new RegExp(`\\{\\{${escapeRegExp(key)}\\.([^}]+)\\}\\}`, "g");
      result = result.replace(nestedRegex, (match) => {
        unresolvedPlaceholders.add(match);
        return "";
      });
    }
  }

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, "g");

    if (value === null || value === undefined) {
      result = result.replace(regex, (match) => {
        unresolvedPlaceholders.add(match);
        return "";
      });
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      result = result.replace(regex, (match) => {
        unresolvedPlaceholders.add(match);
        return "";
      });
      continue;
    }

    result = result.replace(regex, String(value));
  }

  if (options?.validate && unresolvedPlaceholders.size > 0) {
    const formatted = Array.from(unresolvedPlaceholders).join(", ");
    throw new Error(`Meta prompt validation failed: unresolved placeholders detected: ${formatted}`);
  }

  return result.trim();
}

export async function buildMetaPrompt(
  variables: Record<string, any>,
  options?: BuildMetaPromptOptions
): Promise<string> {
  const template = await loadTemplateInternal("legacyMaster");
  return renderTemplateString(template, variables, options);
}

export async function buildMetaPromptFromTemplate(
  template: string,
  variables: Record<string, any>,
  options?: BuildMetaPromptOptions
): Promise<string> {
  return renderTemplateString(template, variables, options);
}

/**
 * Loads PCE prompt template (from reference system or file fallback)
 * @param useDatabase If true, loads directly from database instead of reference system
 */
async function loadPceTemplate(templateName: PceTemplateName, useDatabase: boolean = false): Promise<SeparatedPrompts> {
  if (useDatabase) {
    // Try database first
    const dbPrompt = await loadPcePromptFromDatabase(templateName);
    if (dbPrompt) {
      return dbPrompt;
    }
  } else {
    // Try reference system first
    const referencePrompt = await loadPcePromptFromReference(templateName);
    if (referencePrompt) {
      return referencePrompt;
    }
  }

  // Fallback to .txt file (backward compatibility)
  // For file-based templates, treat entire content as system prompt
  // and use empty user prompt (maintains current behavior)
  const template = await loadTemplateInternal(templateName);
  return {
    system: stripTemplateAnnotations(template),
    user: "" // Empty user prompt for file-based templates
  };
}

/**
 * Builds separated system/user prompts with variable substitution
 * Returns both system and user prompts, with user being empty string if not provided
 * @param useDatabase If true, loads prompts directly from database instead of reference system
 */
export async function buildPcePrompt(
  templateName: PceTemplateName,
  variables: Record<string, any>,
  options?: BuildMetaPromptOptions & { useDatabase?: boolean }
): Promise<SeparatedPrompts> {
  const prompts = await loadPceTemplate(templateName, options?.useDatabase ?? false);

  return {
    system: renderTemplateString(prompts.system, variables, options),
    user: prompts.user ? renderTemplateString(prompts.user, variables, options) : ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface FlattenedMasterEnrichment {
  MASTER_CONTEXT?: Record<string, unknown>;
  MASTER_VARIABLES?: Record<string, unknown>;
  MASTER_GUIDANCE?: Record<string, unknown>;
  MASTER_ENRICHMENT?: Record<string, unknown>;
}

export function flattenMasterEnrichment(enrichment: unknown): FlattenedMasterEnrichment {
  if (!isRecord(enrichment)) {
    return {};
  }

  const flattened: FlattenedMasterEnrichment = {
    MASTER_ENRICHMENT: enrichment
  };

  if (isRecord(enrichment.context)) {
    flattened.MASTER_CONTEXT = enrichment.context;
  }

  if (isRecord(enrichment.variables)) {
    flattened.MASTER_VARIABLES = enrichment.variables;
  }

  if (isRecord(enrichment.guidance)) {
    flattened.MASTER_GUIDANCE = enrichment.guidance;
  }

  return flattened;
}
