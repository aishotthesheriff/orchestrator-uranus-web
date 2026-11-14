/**
 * Where the files the app writes while it runs are kept: generated images and log files.
 *
 * By default that is the folder the app is started from. On a host whose deploys replace
 * the app folder (Hostinger gives every deploy a new one), set DATA_DIR to a folder outside
 * it, or every deploy loses the images that saved turns point to.
 */
import path from "path";

export function dataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? path.resolve(configured) : process.cwd();
}

export function generatedImagesDir(): string {
  return path.join(dataDir(), "generated_images");
}

export function logsDir(): string {
  return path.join(dataDir(), "logs");
}
