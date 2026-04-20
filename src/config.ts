import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModConfig, FileEntry } from "./types";
import { FileType } from "./types";

const CONFIG_DIR = resolve("mods", "config");
const ORIGIN_DIR = resolve("mods", "default");
const ZH_DIR = resolve("mods", "zh");

/**
 * 加载配置文件，同时合并已翻译的 keys
 */
export function loadConfig(configPath: string): ModConfig {
  const content = readFileSync(configPath, "utf-8");
  const config = JSON.parse(content) as ModConfig;

  // Merge translation keys from existing translated files
  config.files = config.files.map((fileEntry: FileEntry) => {
    if (fileEntry.translateAll) {
      return fileEntry;
    }

    const targetPath = getTargetPath(config.baseDir, fileEntry.target);
    const existingTranslation = loadExistingTranslation(targetPath);

    if (existingTranslation) {
      // Merge existing translation keys into file entry
      return {
        ...fileEntry,
        keys: existingTranslation,
      };
    }

    return fileEntry;
  });

  return config;
}

/**
 * 加载已翻译的文件，提取所有字符串值作为 keys
 */
function loadExistingTranslation(targetPath: string): Record<string, string> | null {
  try {
    const content = readFileSync(targetPath, "utf-8");
    const data = JSON.parse(content);
    return flattenToTranslationKeys(data, "");
  } catch {
    return null;
  }
}

/**
 * 将嵌套 JSON 展平为 path -> translation value 的映射
 */
function flattenToTranslationKeys(
  obj: unknown,
  prefix: string
): Record<string, string> {
  const result: Record<string, string> = {};

  if (obj === null || obj === undefined) {
    return result;
  }

  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Use bracket notation for array indices to match query.ts path format
      const path = prefix ? `${prefix}["${key}"]` : key;
      if (typeof value === "string" && value.trim()) {
        result[path] = value;
      } else if (typeof value === "object" && value !== null) {
        Object.assign(result, flattenToTranslationKeys(value, path));
      }
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const value = obj[i];
      // Use bracket notation for array indices to match query.ts path format
      const path = prefix ? `${prefix}[${i}]` : `[${i}]`;
      if (typeof value === "string" && value.trim()) {
        result[path] = value;
      } else if (typeof value === "object" && value !== null) {
        Object.assign(result, flattenToTranslationKeys(value, path));
      }
    }
  } else if (typeof obj === "string" && obj.trim()) {
    result[prefix] = obj;
  }

  return result;
}

/**
 * 判断文件类型
 */
export function getFileType(filePath: string): FileType {
  if (filePath.endsWith("i18n/default.json")) {
    return FileType.I18nDefault;
  }
  if (filePath.endsWith(".json")) {
    return FileType.Json;
  }
  if (filePath.endsWith(".tmx")) {
    return FileType.Tmx;
  }
  return FileType.Unknown;
}

/**
 * 获取原始文件完整路径
 */
export function getOriginPath(baseDir: string, file: string): string {
  return resolve(ORIGIN_DIR, baseDir, file);
}

/**
 * 获取翻译后文件完整路径
 */
export function getTargetPath(baseDir: string, target: string): string {
  return resolve(ZH_DIR, baseDir, target);
}

export { CONFIG_DIR, ORIGIN_DIR, ZH_DIR };
