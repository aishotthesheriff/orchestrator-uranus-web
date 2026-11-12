import { storage } from "../server/storage.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_DOC_BLOCK_PATTERN = /<!--\s*PCE_TEMPLATE_DOC_START[\s\S]*?PCE_TEMPLATE_DOC_END\s*-->/g;
const DIVIDER_LINE = "═══════════════════════════════════════════════════════";

const PCE_PROMPTS = [
  {
    name: "pce_master",
    file: "masterPrompt.txt",
    description: "PCE Master Enrichment Stage - Generates context, variables, and guidance for downstream stages"
  },
  {
    name: "pce_narrative",
    file: "narrativePrompt.txt",
    description: "PCE Narrative Generation Stage - Produces player-facing narration for the turn"
  },
  {
    name: "pce_image",
    file: "imagePrompt.txt",
    description: "PCE Image Prompt Generation Stage - Converts narrative into image generation prompts"
  },
  {
    name: "pce_actions",
    file: "actionsPrompt.txt",
    description: "PCE Actions Generation Stage - Recommends next action chips for the player"
  }
];

/**
 * Strips documentation annotations from the template
 */
function stripTemplateAnnotations(rawTemplate: string): string {
  return rawTemplate.replace(TEMPLATE_DOC_BLOCK_PATTERN, "").trimStart();
}

/**
 * Intelligently splits a template into system and user prompts
 * System: Everything before first divider (role, task, instructions)
 * User: Everything after first divider (data sections with variables)
 */
function splitTemplateIntelligently(template: string): { system: string; user: string } {
  const stripped = stripTemplateAnnotations(template);
  
  // Find first divider line
  const dividerIndex = stripped.indexOf(DIVIDER_LINE);
  
  if (dividerIndex === -1) {
    // No divider found - entire template is system prompt
    return {
      system: stripped,
      user: ""
    };
  }
  
  // Split at divider
  const systemPart = stripped.substring(0, dividerIndex).trim();
  const userPart = stripped.substring(dividerIndex).trim();
  
  // Handle edge case: empty sections
  if (!systemPart) {
    return {
      system: "",
      user: userPart
    };
  }
  
  if (!userPart) {
    return {
      system: systemPart,
      user: ""
    };
  }
  
  return {
    system: systemPart,
    user: userPart
  };
}

async function migratePcePrompts() {
  console.log("Starting PCE prompt migration to reference system...");

  for (const { name, file, description } of PCE_PROMPTS) {
    try {
      const filePath = path.join(__dirname, "../server/pce", file);
      const content = await fs.readFile(filePath, "utf8");

      // Check if prompt already exists
      const existing = await storage.getActivePromptTemplate(name);
      if (existing) {
        console.log(`Prompt '${name}' already exists, skipping...`);
        continue;
      }

      // Split intelligently
      const { system, user } = splitTemplateIntelligently(content);

      // Create with inherit_global_prompt = 1 (default)
      await storage.createPromptTemplate({
        name,
        content: user, // User prompt (data sections)
        systemContent: system, // System prompt (instructions)
        inheritGlobalPrompt: 1, // Inherit global system prompt
        description,
        version: 1,
        active: 1
      });

      console.log(`✓ Migrated ${name} to prompt_templates`);
      console.log(`  System prompt length: ${system.length} chars`);
      console.log(`  User prompt length: ${user.length} chars`);
    } catch (error) {
      console.error(`✗ Failed to migrate ${name}:`, error);
    }
  }

  console.log("Migration complete!");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migratePcePrompts()
    .then(() => {
      console.log("Done.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}

export { migratePcePrompts };

