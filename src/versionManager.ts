/**
 * versionManager - Handle version comparison and manifest updates
 */

import fs from "node:fs";
import path from "node:path";
import type { Manifest } from "./types";

/**
 * Compare two semver versions
 * Returns: negative if v1 < v2, 0 if equal, positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map((p) => parseInt(p, 10) || 0);
  const parts2 = v2.split(".").map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Check if translation is needed based on version comparison
 */
export function needsTranslation(
  defaultVersion: string,
  zhVersion: string | null
): boolean {
  if (!zhVersion) return true;
  return compareVersions(defaultVersion, zhVersion) > 0;
}

/**
 * Read manifest.json from a directory
 */
export function readManifest(dirPath: string): Manifest | null {
  const manifestPath = path.join(dirPath, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

/**
 * Get version from mod's manifest
 */
export function getModVersion(
  baseDir: string,
  isZh: boolean,
  originDir: string,
  zhDir: string
): string | null {
  const dir = isZh ? zhDir : originDir;
  const manifest = readManifest(path.resolve(dir, baseDir));
  return manifest?.Version ?? null;
}

/**
 * Update zh manifest version to match default
 */
export function updateZhManifestVersion(
  baseDir: string,
  newVersion: string,
  zhDir: string
): void {
  const zhManifestPath = path.resolve(zhDir, baseDir, "manifest.json");

  if (!fs.existsSync(zhManifestPath)) {
    console.warn(`Warning: zh manifest not found at ${zhManifestPath}`);
    return;
  }

  try {
    const manifest = JSON.parse(
      fs.readFileSync(zhManifestPath, "utf-8")
    ) as Manifest;
    manifest.Version = newVersion;

    fs.writeFileSync(zhManifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`Updated zh manifest version to ${newVersion}`);
  } catch (e) {
    console.error(`Error updating zh manifest: ${e}`);
  }
}

/**
 * Ensure zh manifest exists (copy from default if needed)
 */
export function ensureZhManifest(
  baseDir: string,
  originDir: string,
  zhDir: string
): boolean {
  const defaultManifestPath = path.resolve(originDir, baseDir, "manifest.json");
  const zhManifestPath = path.resolve(zhDir, baseDir, "manifest.json");

  if (!fs.existsSync(defaultManifestPath)) {
    console.error(`Default manifest not found: ${defaultManifestPath}`);
    return false;
  }

  if (fs.existsSync(zhManifestPath)) {
    return true;
  }

  try {
    const zhModDir = path.resolve(zhDir, baseDir);
    if (!fs.existsSync(zhModDir)) {
      fs.mkdirSync(zhModDir, { recursive: true });
    }

    fs.copyFileSync(defaultManifestPath, zhManifestPath);
    console.log(`Created zh manifest from default`);
    return true;
  } catch (e) {
    console.error(`Error creating zh manifest: ${e}`);
    return false;
  }
}

/**
 * Get i18n default file path
 */
export function getI18nDefaultPath(baseDir: string, originDir: string): string {
  return path.resolve(originDir, baseDir, "i18n", "default.json");
}

/**
 * Get i18n zh file path
 */
export function getI18nZhPath(baseDir: string, zhDir: string): string {
  return path.resolve(zhDir, baseDir, "i18n", "zh.json");
}

/**
 * Get i18n zh.default file path (backup of original before translation)
 */
export function getI18nZhDefaultPath(baseDir: string, zhDir: string): string {
  return path.resolve(zhDir, baseDir, "i18n", "zh.json.default");
}

/**
 * Backup default.json to zh.json.default after translation
 */
export function backupI18nDefault(srcPath: string, dstPath: string): void {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`default.json not found at ${srcPath}, mod files may be incomplete`);
  }

  try {
    const dstDir = path.resolve(dstPath, "..");
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    fs.copyFileSync(srcPath, dstPath);
    console.log(`Backed up default.json to zh.json.default`);
  } catch (e) {
    throw new Error(`Failed to backup default.json: ${e}`);
  }
}
