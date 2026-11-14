import path from 'path';
import type { GeneratedImage, GameState } from '@shared/schema';
import { generatePromptHash, generateVariablesHash, generateSceneFingerprint, findSimilarScenes } from './cacheUtils.js';
import { computeImageKeys } from './aiService.js';
import { storage } from './storage.js';
import { getCurrentReference } from './reference/referenceLoader.js';
import { saveImageToFile } from './imageStorage.js';

/**
 * Converts a data URL or GeneratedImage object to a canonical static path URL.
 * 
 * @param imageData - Either a GeneratedImage object (with filePath) or an object with imageUrl and templateName
 * @param options - Optional gameState and userPreferences needed for hash computation when imageUrl is a data URL
 * @returns The canonical static path URL (e.g., /generated_images/filename.png) or the original imageUrl if conversion fails
 */
export async function convertImageUrlToStaticPath(
  imageData: GeneratedImage | { imageUrl: string; templateName: string },
  options?: {
    gameState?: GameState;
    userPreferences?: { theme?: string; style?: string; imageModelKey?: string; skipImageCache?: boolean };
  }
): Promise<string> {
  // Case 1: Direct GeneratedImage object - extract filename from filePath
  if ('filePath' in imageData && imageData.filePath) {
    const fileName = path.basename(imageData.filePath);
    return `/generated_images/${fileName}`;
  }

  // Case 2: imageUrl with templateName - need to lookup in database
  const { imageUrl, templateName } = imageData as { imageUrl: string; templateName: string };
  
  // If not a data URL, return as-is (already a static path or external URL)
  if (!imageUrl.startsWith('data:image')) {
    return imageUrl;
  }

  // Need gameState and userPreferences for hash computation
  if (!options?.gameState || !options?.userPreferences) {
    console.warn('[convertImageUrlToStaticPath] Cannot convert data URL without gameState and userPreferences');
    return imageUrl;
  }

  try {
    // Compute hashes to lookup image in database
    const keys = await computeImageKeys(
      templateName,
      options.gameState,
      options.userPreferences,
      {}
    );
    const promptHash = generatePromptHash(keys.finalPrompt);
    const variablesHash = generateVariablesHash(keys.variables);

    // Try exact match first
    let cachedImage = await storage.getGeneratedImageByHash(promptHash, variablesHash);

    // If not found, try similar scenes unless similarity caching is disabled.
    if (!cachedImage) {
      const similarityCacheEnabled = process.env.IMAGE_SIMILARITY_CACHE_ENABLED !== 'false';
      if (similarityCacheEnabled) {
        const templateImages = await storage.getGeneratedImagesByTemplate(keys.effectiveTemplateName);
        if (templateImages.length > 0) {
          const reference = await getCurrentReference();
          const backgroundValue = reference.data.settings?.image_background_setting || 'auto';
          const moderationValue = 'low'; // Always use low moderation
          const settings = {
            size: keys.template.size,
            quality: keys.template.quality,
            background: backgroundValue,
            moderation: moderationValue
          };
          const sceneFingerprint = generateSceneFingerprint(
            keys.effectiveTemplateName,
            options.gameState,
            keys.variables,
            settings,
            Array.isArray(keys.template.sceneTypes) ? keys.template.sceneTypes : [],
            Array.isArray(keys.template.tags) ? keys.template.tags : []
          );
          const candidateFingerprints = templateImages.map(img => img.sceneFingerprint as any);
          const similarScenes = findSimilarScenes(sceneFingerprint, candidateFingerprints, 0.85);
          if (similarScenes.length > 0) {
            cachedImage = templateImages.find(img =>
              JSON.stringify(img.sceneFingerprint) === JSON.stringify(similarScenes[0].fingerprint)
            );
          }
        }
      }
    }

    if (cachedImage) {
      const fileName = path.basename(cachedImage.filePath);
      return `/generated_images/${fileName}`;
    }

    // Fallback: if image not in DB, persist it now for inspection/debug
    console.warn('[convertImageUrlToStaticPath] Could not find image record in database, persisting from data URL');
    const fallbackHash = generatePromptHash(imageUrl);
    const fallbackVariablesHash = generateVariablesHash({ templateName, fallbackHash });
    const { filePath } = await saveImageToFile(imageUrl, {
      templateName: templateName || "custom",
      promptHash: fallbackHash,
      variablesHash: fallbackVariablesHash,
      gameId: options.gameState.id,
      turnNumber: options.gameState.turnNumber,
      generatedAt: new Date()
    });
    return `/generated_images/${path.basename(filePath)}`;
  } catch (error) {
    console.error('[convertImageUrlToStaticPath] Error converting image URL:', error);
    try {
      const fallbackHash = generatePromptHash(imageUrl);
      const fallbackVariablesHash = generateVariablesHash({ templateName, fallbackHash });
      const { filePath } = await saveImageToFile(imageUrl, {
        templateName: templateName || "custom",
        promptHash: fallbackHash,
        variablesHash: fallbackVariablesHash,
        gameId: options.gameState?.id,
        turnNumber: options.gameState?.turnNumber,
        generatedAt: new Date()
      });
      return `/generated_images/${path.basename(filePath)}`;
    } catch (saveError) {
      console.error('[convertImageUrlToStaticPath] Failed to persist fallback image:', saveError);
      return imageUrl;
    }
  }
}
