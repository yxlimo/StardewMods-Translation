import * as path from "node:path";
import {
  getOriginPath,
  getTargetPath,
  getFileType,
} from "./config";
import { query } from "./query";
import {
  readJsonFile,
  writeJsonFile,
  readFileByType,
  writeFileByType,
} from "./fileHandler";
import { computeJsonDiff } from "./diff";
import { translateBatch } from "./llm";
import { getFileOperator, type FileOperator } from "./fileOperator";
import { FileType } from "./types";
import type { FileEntry, TranslationResult } from "./types";

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
 * 翻译单个 mod 的所有文件到 staging 目录
 * 一次性读取所有文件，比对出需要翻译的 key，调用一次 LLM 获取所有结果
 */
export async function translateAllToStaging(
  baseDir: string,
  files: FileEntry[],
  stagingDir: string
): Promise<TranslationResult[]> {
  // Step 1: 收集所有文件数据，识别需要翻译的内容
  const fileDataMap: FileData[] = [];
  const itemsToTranslate: TranslationItem[] = [];

  for (const entry of files) {
    const fileType = getFileType(entry.file);
    const originPath = getOriginPath(baseDir, entry.file);
    const targetPath = getTargetPath(baseDir, entry.target);

    const originData = readFileByType(originPath, fileType);
    const targetData = readFileByType(targetPath, fileType);

    let outputData: unknown = null;
    let skippedCount = 0;

    if (fileType === FileType.I18nDefault || fileType === FileType.Json) {
      if (!originData) {
        fileDataMap.push({
          entry,
          fileType,
          originData,
          targetData,
          outputData: null,
          skippedCount: 0,
          translatedCount: 0,
        });
        continue;
      }

      outputData = deepClone(originData);
      const operator = getFileOperator("json");

      if (fileType === FileType.I18nDefault) {
        // i18n 文件：使用 computeJsonDiff 找差异
        const diffKeys = computeJsonDiff(
          originData as Record<string, unknown>,
          targetData as Record<string, unknown> | null
        );

        log(`[${entry.file}] diffKeys (${diffKeys.size}):`, [...diffKeys]);

        for (const key of diffKeys) {
          // key 可能包含点（如 "Guild.CapeDinos.Name"），用反引号强制作为单 key 查询
          const queryKey = key.includes(".") ? `\`${key}\`` : key;
          const queryResults = operator.query(originData, queryKey);
          if (queryResults.length > 0) {
            const { path: queryPath, value } = queryResults[0];
            if (typeof value === "string" && value.trim()) {
              itemsToTranslate.push({
                fileIndex: fileDataMap.length,
                path: queryPath,
                value,
              });
            }
          }
        }

        log(`[${entry.file}] targetData keys:`, Object.keys(targetData || {}));
        log(`[${entry.file}] itemsToTranslate from diff:`, itemsToTranslate.slice(-diffKeys.size).map(i => ({ path: i.path, value: i.value.slice(0, 50) })));

        // 合并已有翻译（key 存在于 zh 中就保留，不管值是否和 origin 相同）
        if (targetData) {
          const targetObj = targetData as Record<string, unknown>;
          for (const key of Object.keys(targetObj)) {
            if (diffKeys.has(key)) continue;
            const value = targetObj[key];
            // 只要 key 存在于 zh 中，就使用 zh 中的值
            if (typeof value === "string" && value.trim()) {
              outputData = operator.update(outputData, key, value);
              skippedCount++;
            }
          }
        }
      } else {
        // 普通 JSON 文件：使用 translateKeys
        if (entry.translateKeys && entry.translateKeys.length > 0) {
          for (const keyPattern of entry.translateKeys) {
            const queryResults = operator.query(originData, keyPattern);
            for (const { path: queryPath, value } of queryResults) {
              if (typeof value === "string" && value.trim()) {
                // 检查是否已有翻译
                if (targetData) {
                  const existingValue = getValueByPath(targetData, queryPath);
                  if (typeof existingValue === "string" && existingValue.trim()) {
                    outputData = operator.update(outputData, queryPath, existingValue);
                    skippedCount++;
                    continue;
                  }
                }
                // 需要翻译
                itemsToTranslate.push({
                  fileIndex: fileDataMap.length,
                  path: queryPath,
                  value,
                });
              }
            }
          }
        }
      }
    }

    fileDataMap.push({
      entry,
      fileType,
      originData,
      targetData,
      outputData,
      skippedCount,
      translatedCount: 0,
    });
  }

  // Step 2: 调用 LLM 批量翻译
  if (itemsToTranslate.length > 0) {
    log(`Total items to translate: ${itemsToTranslate.length}`);
    log("Items details:", itemsToTranslate.map(i => ({ file: files[i.fileIndex]?.file, path: i.path, value: i.value.slice(0, 50) })));

    console.log(`Translating ${itemsToTranslate.length} items via LLM...`);

    // 收集所有需要翻译的文本
    const allTexts: string[] = [];
    const textToItemMap = new Map<number, TranslationItem>();

    for (const item of itemsToTranslate) {
      allTexts.push(item.value);
      textToItemMap.set(allTexts.length - 1, item);
    }

    // 一次性调用 LLM
    const translations = await translateBatch(allTexts, "English", "Chinese");

    log("LLM translations:", translations.map((t, i) => ({ original: allTexts[i].slice(0, 30), translated: t.slice(0, 30) })));

    // 应用翻译结果
    for (let i = 0; i < allTexts.length; i++) {
      const text = allTexts[i];
      const translated = translations[i] || text;
      const item = textToItemMap.get(i);

      if (item) {
        const operator = getFileOperator("json");
        fileDataMap[item.fileIndex].outputData = operator.update(
          fileDataMap[item.fileIndex].outputData,
          item.path,
          translated
        );
        fileDataMap[item.fileIndex].translatedCount++;
      }
    }
  }

  // Step 3: 写入所有文件到 staging
  const results: TranslationResult[] = [];
  for (const fileData of fileDataMap) {
    const { entry, fileType, outputData } = fileData;

    if (outputData === null) {
      results.push({
        success: false,
        file: entry.file,
        translatedCount: 0,
        skippedCount: 0,
        errors: [`Origin file not found`],
      });
      continue;
    }

    const stagingPath = path.join(stagingDir, baseDir, entry.target);
    writeFileByType(stagingPath, outputData, fileType);

    results.push({
      success: true,
      file: entry.file,
      translatedCount: fileData.translatedCount,
      skippedCount: fileData.skippedCount,
      errors: [],
    });
  }

  return results;
}

/**
 * 翻译单个文件到 staging 目录
 */
export async function translateFileToStaging(
  baseDir: string,
  entry: FileEntry,
  stagingDir: string
): Promise<TranslationResult> {
  const fileType = getFileType(entry.file);
  const originPath = getOriginPath(baseDir, entry.file);
  const stagingPath = path.join(stagingDir, baseDir, entry.target);

  const result: TranslationResult = {
    success: true,
    file: entry.file,
    translatedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    switch (fileType) {
      case FileType.I18nDefault:
        await translateI18nFile(originPath, stagingPath, result);
        break;
      case FileType.Json:
        await translateJsonFile(
          baseDir,
          originPath,
          stagingPath,
          entry,
          result
        );
        break;
      default:
        result.errors?.push(`Unsupported file type: ${fileType}`);
        result.success = false;
    }
  } catch (e) {
    result.success = false;
    result.errors?.push(`Error: ${e}`);
  }

  return result;
}

/**
 * 翻译单个文件
 */
export async function translateFile(
  baseDir: string,
  entry: FileEntry
): Promise<TranslationResult> {
  const fileType = getFileType(entry.file);
  const originPath = getOriginPath(baseDir, entry.file);
  const targetPath = getTargetPath(baseDir, entry.target);

  const result: TranslationResult = {
    success: true,
    file: entry.file,
    translatedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    switch (fileType) {
      case FileType.I18nDefault:
        await translateI18nFile(originPath, targetPath, result);
        break;
      case FileType.Json:
        await translateJsonFile(
          baseDir,
          originPath,
          targetPath,
          entry,
          result
        );
        break;
      default:
        result.errors?.push(`Unsupported file type: ${fileType}`);
        result.success = false;
    }
  } catch (e) {
    result.success = false;
    result.errors?.push(`Error: ${e}`);
  }

  return result;
}

/**
 * 翻译 i18n/default.json 文件
 * 基于旧版本增量更新
 */
export async function translateI18nFile(
  originPath: string,
  targetPath: string,
  result: TranslationResult
): Promise<void> {
  const originData = readJsonFile<Record<string, unknown>>(originPath);
  const targetData = readJsonFile<Record<string, unknown> | null>(targetPath);

  if (!originData) {
    result.errors?.push(`Origin file not found: ${originPath}`);
    result.success = false;
    return;
  }

  // 计算差异：origin 中有但 target 中没有的 key（新增或修改的）
  const diffKeys = computeJsonDiff(originData, targetData);

  // 基于原始文件生成新输出（深拷贝）
  const operator: FileOperator = getFileOperator("json");
  let outputData = deepClone(originData);

  // 收集需要翻译的 key-value 对（基于 diffKeys 在 origin 中查询）
  // diffKeys 是新 key，不存在于 target，所以不需要检查已有翻译
  const keysToTranslate: string[] = [];
  const valuesToTranslate: string[] = [];
  const pathValueMap = new Map<string, string>();

  for (const key of diffKeys) {
    // key 可能包含点（如 "Guild.CapeDinos.Name"），用反引号强制作为单 key 查询
    const queryKey = key.includes(".") ? `\`${key}\`` : key;
    const queryResults = operator.query(originData, queryKey);
    if (queryResults.length > 0) {
      const { path: queryPath, value } = queryResults[0];
      if (typeof value === "string" && value.trim()) {
        keysToTranslate.push(queryPath);
        valuesToTranslate.push(value);
        pathValueMap.set(queryPath, value);
      }
    }
  }

  // 调用 LLM 批量翻译
  if (valuesToTranslate.length > 0) {
    console.log(`Translating ${valuesToTranslate.length} keys via LLM...`);
    const translations = await translateBatch(valuesToTranslate, "English", "Chinese");
    for (let i = 0; i < keysToTranslate.length; i++) {
      const queryPath = keysToTranslate[i];
      const translated = translations[i] || pathValueMap.get(queryPath);
      if (translated) {
        outputData = operator.update(outputData, queryPath, translated);
        result.translatedCount++;
      }
    }
  }

  // 如果目标文件存在，合并已有翻译（保留 target 中非 diffKeys 的内容）
  if (targetData) {
    for (const key of Object.keys(targetData)) {
      // 跳过已处理的 diffKeys
      if (diffKeys.has(key)) continue;
      // 直接合并非新增的 key
      // 对于 flat i18n 文件，key 是顶级键（如 "page.compatibility.link"）
      // query() 返回 0 结果因为它按 "." 分割路径进行嵌套遍历
      // 所以直接使用 key 作为路径
      const value = (targetData as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        outputData = operator.update(outputData, key, value);
        result.skippedCount++;
      }
    }
  }

  writeJsonFile(targetPath, outputData);
}

/**
 * 翻译普通 JSON 文件
 * 使用 fileOperator 统一接口
 */
export async function translateJsonFile(
  baseDir: string,
  originPath: string,
  targetPath: string,
  entry: FileEntry,
  result: TranslationResult
): Promise<void> {
  const originContent = readJsonFile<Record<string, unknown>>(originPath);

  if (!originContent) {
    result.errors?.push(`Origin file not found: ${originPath}`);
    result.success = false;
    return;
  }

  // 获取已翻译的 keys（从 config 合并而来）
  const existingKeys = entry.keys || {};

  // 基于原始文件生成新输出
  const operator: FileOperator = getFileOperator("json");
  let outputData = deepClone(originContent);

  if (entry.translateKeys && entry.translateKeys.length > 0) {
    // 收集需要翻译的文本
    const pathsToTranslate: string[] = [];
    const valuesToTranslate: string[] = [];
    const pathValueMap = new Map<string, string>();

    // 按指定 keys 翻译
    for (const keyPattern of entry.translateKeys) {
      const queryResults = operator.query(originContent, keyPattern);

      for (const { path: queryPath, value } of queryResults) {
        if (typeof value === "string" && value.trim()) {
          // 先尝试从已有翻译中获取
          if (existingKeys[queryPath]) {
            outputData = operator.update(outputData, queryPath, existingKeys[queryPath]);
            result.translatedCount++;
            continue;
          }
          // 需要 LLM 翻译
          pathsToTranslate.push(queryPath);
          valuesToTranslate.push(value);
          pathValueMap.set(queryPath, value);
        }
      }
    }

    // 批量调用 LLM 翻译
    if (valuesToTranslate.length > 0) {
      const translations = await translateBatch(valuesToTranslate, "English", "Chinese");
      for (let i = 0; i < pathsToTranslate.length; i++) {
        const queryPath = pathsToTranslate[i];
        const translated = translations[i] || pathValueMap.get(queryPath);
        if (translated) {
          outputData = operator.update(outputData, queryPath, translated);
          result.translatedCount++;
        }
      }
    }
  }

  writeJsonFile(targetPath, outputData);
}

/**
 * 按路径获取值（支持 query 语法）
 */
function getValueByPath(obj: unknown, pathStr: string): unknown {
  const results = query(obj, pathStr);
  return results.length > 0 ? results[0].value : undefined;
}

/**
 * 深拷贝
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
