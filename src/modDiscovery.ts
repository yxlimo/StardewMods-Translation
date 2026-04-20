/**
 * modDiscovery - Auto-discover mods in mods/default directory
 */

import fs from "node:fs";
import path from "node:path";
import type { ModInfo, ModConfig, FileEntry, I18nFileInfo } from "./types";

/**
 * Discover all mods in the default directory
 */
export function discoverMods(originDir: string, zhDir: string): ModInfo[] {
  const mods: ModInfo[] = [];

  if (!fs.existsSync(originDir)) {
    return mods;
  }

  const entries = fs.readdirSync(originDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const modPath = path.join(originDir, entry.name);
    const modInfo = getModInfo(modPath, entry.name, zhDir);

    if (modInfo) {
      mods.push(modInfo);
    }
  }

  return mods;
}

/**
 * Find manifest.json in subdirectories (excluding i18n)
 */
function findManifestInSubdirs(modPath: string): { UniqueID: string; Version: string } | null {
  if (!fs.existsSync(modPath)) {
    return null;
  }

  try {
    const entries = fs.readdirSync(modPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "i18n") {
        continue;
      }

      const subdirPath = path.join(modPath, entry.name);
      const manifestPath = path.join(subdirPath, "manifest.json");

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        return manifest;
      }
    }
  } catch {
    // Ignore errors during subdirectory scanning
  }

  return null;
}

/**
 * Find all i18n folders in a mod directory (including subdirectories)
 */
function findI18nFiles(modPath: string, zhDir: string): I18nFileInfo[] {
  const i18nFiles: I18nFileInfo[] = [];
  const modName = modPath.split("/").pop() || "";

  scanForI18n(modPath, modName, i18nFiles, zhDir);

  return i18nFiles;
}

/**
 * Recursively scan for i18n folders
 */
function scanForI18n(
  modPath: string,
  modName: string,
  i18nFiles: I18nFileInfo[],
  zhDir: string,
  currentPrefix: string = ""
): void {
  if (!fs.existsSync(modPath)) {
    return;
  }

  try {
    const entries = fs.readdirSync(modPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(modPath, entry.name);
      const newPrefix = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;

      if (entry.name === "i18n") {
        if (currentPrefix === "") {
          const defaultPath = path.join(entryPath, "default.json");
          if (fs.existsSync(defaultPath)) {
            const zhPath = path.join(zhDir, modName, "i18n", "zh.json");
            i18nFiles.push({
              relativePath: "i18n",
              defaultPath,
              zhPath: fs.existsSync(zhPath) ? zhPath : null,
            });
          }
        }
        continue;
      }

      const i18nInSubdir = path.join(entryPath, "i18n");
      if (fs.existsSync(i18nInSubdir)) {
        const defaultPath = path.join(i18nInSubdir, "default.json");
        if (fs.existsSync(defaultPath)) {
          const zhPath = path.join(zhDir, modName, newPrefix, "i18n", "zh.json");
          i18nFiles.push({
            relativePath: `${newPrefix}/i18n`,
            defaultPath,
            zhPath: fs.existsSync(zhPath) ? zhPath : null,
          });
        }
      }

      scanForI18n(entryPath, modName, i18nFiles, zhDir, newPrefix);
    }
  } catch {
    // Ignore errors during scanning
  }
}

/**
 * Get mod info from manifest.json
 */
export function getModInfo(modPath: string, modName: string, zhDir: string): ModInfo | null {
  const manifestPath = path.join(modPath, "manifest.json");

  let manifest: { UniqueID: string; Version: string } | null = null;

  if (!fs.existsSync(manifestPath)) {
    manifest = findManifestInSubdirs(modPath);
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      return null;
    }
  }

  if (!manifest) {
    return null;
  }

  const i18nFiles = findI18nFiles(modPath, zhDir);

  return {
    name: modName,
    uniqueId: manifest.UniqueID,
    version: manifest.Version,
    path: modPath,
    i18nFiles,
  };
}

/**
 * Generate default config for a mod (i18n-only translation)
 */
export function generateDefaultConfig(modInfo: ModInfo): ModConfig {
  const files: FileEntry[] = [];

  for (const i18nFile of modInfo.i18nFiles) {
    files.push({
      file: `${i18nFile.relativePath}/default.json`,
      target: `${i18nFile.relativePath}/zh.json`,
    });
  }

  return {
    baseDir: modInfo.name,
    files,
  };
}
