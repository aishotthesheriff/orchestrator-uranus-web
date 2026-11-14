import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { generatedImagesDir } from './paths';

export interface ImageMetadata {
  templateName: string;
  promptHash: string;
  variablesHash: string;
  gameId?: string;
  turnNumber?: number;
  generatedAt: Date;
}

export interface StorageStats {
  totalFiles: number;
  totalSizeBytes: number;
  averageFileSize: number;
  oldestFile: Date | null;
  newestFile: Date | null;
}

const STORAGE_DIR = generatedImagesDir();

// Ensure storage directory exists
async function ensureStorageDir(): Promise<void> {
  try {
    await fs.access(STORAGE_DIR);
  } catch {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  }
}

export async function saveImageToFile(
  base64Data: string, 
  metadata: ImageMetadata
): Promise<{ filePath: string; fileSize: number }> {
  await ensureStorageDir();

  // Extract base64 data (remove data:image/png;base64, prefix if present)
  const base64Content = base64Data.includes(',') 
    ? base64Data.split(',')[1] 
    : base64Data;

  // Create filename with template name and hash for uniqueness
  const filename = `${metadata.templateName}_${metadata.promptHash.substring(0, 8)}_${randomUUID().substring(0, 8)}.png`;
  const filePath = path.join(STORAGE_DIR, filename);

  // Convert base64 to buffer and write to file
  const buffer = Buffer.from(base64Content, 'base64');
  await fs.writeFile(filePath, buffer);

  // Get file stats for size
  const stats = await fs.stat(filePath);

  return {
    filePath,
    fileSize: stats.size
  };
}

export async function loadImageFromFile(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    throw new Error(`Failed to load image from file: ${filePath}. Error: ${error}`);
  }
}

export async function deleteImageFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Don't throw if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to delete image file: ${filePath}. Error: ${error}`);
    }
  }
}

export async function getStorageStats(): Promise<StorageStats> {
  await ensureStorageDir();

  try {
    const files = await fs.readdir(STORAGE_DIR);
    const imageFiles = files.filter(file => file.endsWith('.png'));

    if (imageFiles.length === 0) {
      return {
        totalFiles: 0,
        totalSizeBytes: 0,
        averageFileSize: 0,
        oldestFile: null,
        newestFile: null
      };
    }

    let totalSize = 0;
    let oldestTime = Infinity;
    let newestTime = 0;

    for (const file of imageFiles) {
      const filePath = path.join(STORAGE_DIR, file);
      const stats = await fs.stat(filePath);

      totalSize += stats.size;

      const mtime = stats.mtime.getTime();
      if (mtime < oldestTime) oldestTime = mtime;
      if (mtime > newestTime) newestTime = mtime;
    }

    return {
      totalFiles: imageFiles.length,
      totalSizeBytes: totalSize,
      averageFileSize: totalSize / imageFiles.length,
      oldestFile: oldestTime === Infinity ? null : new Date(oldestTime),
      newestFile: newestTime === 0 ? null : new Date(newestTime)
    };
  } catch (error) {
    throw new Error(`Failed to get storage stats: ${error}`);
  }
}

export async function cleanupOrphanedFiles(validFilePaths: string[]): Promise<number> {
  await ensureStorageDir();

  try {
    const files = await fs.readdir(STORAGE_DIR);
    const imageFiles = files.filter(file => file.endsWith('.png'));

    let deletedCount = 0;

    for (const file of imageFiles) {
      const filePath = path.join(STORAGE_DIR, file);
      const isReferenced = validFilePaths.some(validPath => 
        path.resolve(validPath) === path.resolve(filePath)
      );

      if (!isReferenced) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (error) {
    throw new Error(`Failed to cleanup orphaned files: ${error}`);
  }
}
