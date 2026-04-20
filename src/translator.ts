import path from "node:path";
import fs from "node:fs";
import { getFileType } from "./config";
import {
  readJsonFile,
  writeJsonFile,
  readFileByType,
  writeFileByType,
} from "./fileHandler";
import { computeJsonDiff, computeValueDiff } from "./diff";
import { translateBatch } from "./llm";
import _ from "lodash";
import { FileType } from "./types";
import type { FileEntry, TranslationResult } from "./types";
import { backupI18nDefault } from "./versionManager";

/**
 * Verbose logging flag
 */
let verbose = false;

/**
 * Set verbose mode
 */
export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

/**
 * Verbose log helper
 */
function log(...args: unknown[]): void {
  if (verbose) {
    console.log("[verbose]", ...args);
  }
}

/**
 * 翻译条目（用于批量 LLM 调用）
 */
interface TranslationItem {
  fileIndex: number;
  path: string;
  value: string;
}

/**
 * 文件数据
 */
interface FileData {
  entry: FileEntry;
  fileType: FileType;
  originData: unknown;
  targetData: unknown;
  outputData: unknown;
  skippedCount: number;
  translatedCount: number;
}

/**
 * 翻译 i18n/default.json 文件
 */
export async function translateI18nFile(
  originPath: string,
  targetPath: string,
  result: TranslationResult
): Promise<void> {
  const originData = readJsonFile<Record<string, unknown>>(originPath);
  const zhDefaultPath = targetPath.replace(/\/zh\.json$/, "/zh.json.default");
  const targetData = fs.existsSync(targetPath)
    ? readJsonFile<Record<string, unknown>>(targetPath)
    : null;

  // zh.json 存在但 zh.json.default 不存在，报错
  if (targetData && !fs.existsSync(zhDefaultPath)) {
    throw new Error(`zh.json.default not found at ${zhDefaultPath}`);
  }

  const zhDefaultData = targetData ? readJsonFile<Record<string, unknown>>(zhDefaultPath) : null;

  let outputData = deepClone(originData);

  const valueDiff = computeValueDiff(originData, zhDefaultData);
  const keysToTranslateSet = new Set([
    ...valueDiff.newKeys,
    ...valueDiff.changedKeys,
  ]);
  const unchangedKeys = valueDiff.unchangedKeys;

  log(`[i18n] valueDiff:`, {
    newKeys: valueDiff.newKeys,
    changedKeys: valueDiff.changedKeys,
    unchangedKeys: valueDiff.unchangedKeys,
  });

  const keysToTranslate: string[] = [];
  const valuesToTranslate: string[] = [];
  const pathValueMap = new Map<string, string>();

  for (const key of keysToTranslateSet) {
    const value = _.get(originData, key);
    if (typeof value === "string" && value.trim()) {
      keysToTranslate.push(key);
      valuesToTranslate.push(value);
      pathValueMap.set(key, value);
    }
  }

  if (valuesToTranslate.length > 0) {
    console.log(`Translating ${valuesToTranslate.length} keys via LLM...`);
    const translations = await translateBatch(valuesToTranslate, "English", "Chinese");
    for (let i = 0; i < keysToTranslate.length; i++) {
      const key = keysToTranslate[i];
      const translated = translations[i] || pathValueMap.get(key);
      if (translated) {
        outputData = _.set(outputData, key, translated);
        result.translatedCount++;
      }
    }
  }

  if (targetData && unchangedKeys.length > 0) {
    for (const key of unchangedKeys) {
      const value = _.get(targetData, key);
      if (typeof value === "string" && value.trim()) {
        outputData = _.set(outputData, key, value);
        result.skippedCount++;
      }
    }
  }

  writeJsonFile(targetPath, outputData);

  const zhDefaultDstPath = targetPath.replace(/\/zh\.json$/, "/zh.json.default");
  backupI18nDefault(originPath, zhDefaultDstPath);

  result.success = true;
}

/**
 * 翻译普通 JSON 文件
 */
export async function translateJsonFile(
  originPath: string,
  targetPath: string,
  entry: FileEntry,
  result: TranslationResult
): Promise<void> {
  const originContent = readJsonFile<Record<string, unknown>>(originPath);
  let outputData = deepClone(originContent);
  const existingKeys = entry.keys || {};

  if (entry.translateKeys && entry.translateKeys.length > 0) {
    const pathsToTranslate: string[] = [];
    const valuesToTranslate: string[] = [];
    const pathValueMap = new Map<string, string>();

    for (const keyPattern of entry.translateKeys) {
      if (_.has(originContent, keyPattern)) {
        const value = _.get(originContent, keyPattern);
        if (typeof value === "string" && value.trim()) {
          if (existingKeys[keyPattern]) {
            outputData = _.set(outputData, keyPattern, existingKeys[keyPattern]);
            result.translatedCount++;
            continue;
          }
          pathsToTranslate.push(keyPattern);
          valuesToTranslate.push(value);
          pathValueMap.set(keyPattern, value);
        }
      }
    }

    if (valuesToTranslate.length > 0) {
      const translations = await translateBatch(valuesToTranslate, "English", "Chinese");
      for (let i = 0; i < pathsToTranslate.length; i++) {
        const key = pathsToTranslate[i];
        const translated = translations[i] || pathValueMap.get(key);
        if (translated) {
          outputData = _.set(outputData, key, translated);
          result.translatedCount++;
        }
      }
    }
  }

  writeJsonFile(targetPath, outputData);
}

/**
 * 深拷贝
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
