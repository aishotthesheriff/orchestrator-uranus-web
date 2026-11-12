import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";
import { getThemeForcedLlmModelKeys } from "../llm/models";

export const storyThemesReference = express.Router();

storyThemesReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    // Reference data is published with camelCase fields from storage.getActiveStoryThemes()
    // Format: { id, storyThemeKey, label, narratorTemplate, tags, active, rank, default, createdAt, updatedAt }
    const themes = (reference.data.mod_story_themes || []).filter((theme: any) => theme.active === 1);
    // forcedLlmModelKey: the story model this theme imposes, if any (overrides the player's choice).
    const forced = await getThemeForcedLlmModelKeys();
    res.json(
      themes.map((theme: any) => ({
        ...theme,
        forcedLlmModelKey: forced.get(theme.storyThemeKey ?? theme.story_theme_key) ?? null,
      }))
    );
  } catch (error) {
    console.error("Error fetching story themes from reference:", error);
    res.status(500).json({ error: "Failed to fetch story themes from reference" });
  }
});

