import * as Diff from "deep-diff";
import type { ValueDiffResult } from "./types";

/**
 * 计算 JSON 对象的增量差异（key 存在性）
 * 返回新文件相对于旧文件的增量 key 列表
 */
export function computeJsonDiff<T extends Record<string, unknown>>(
  newData: T,
  oldData: T | null
): Set<string> {
  const newKeys = collectAllKeys(newData, "");
  const oldKeys = oldData ? collectAllKeys(oldData, "") : new Set<string>();

  const diff = new Set<string>();
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      diff.add(key);
    }
  }
  return diff;
}

/**
 * 收集 JSON 对象中所有的叶子 key（使用 dot notation）
 */
function collectAllKeys(obj: unknown, prefix: string): Set<string> {
  const keys = new Set<string>();

  if (obj === null || obj === undefined) {
    return keys;
  }

  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v !== "object" || v === null) {
        keys.add(path);
      } else if (Array.isArray(v)) {
        keys.add(path);
      } else {
        for (const subKey of collectAllKeys(v, path)) {
          keys.add(subKey);
        }
      }
    }
  } else if (Array.isArray(obj)) {
    keys.add(prefix);
  } else {
    keys.add(prefix);
  }

  return keys;
}

/**
 * 从 translation.json 中获取指定文件的已翻译 keys
 */
export function getTranslatedKeysFromManifest(
  manifest: { files: Array<{ file: string; keys: string[] }> } | null,
  file: string
): Set<string> {
  if (!manifest) {
    return new Set();
  }

  const record = manifest.files.find((f) => f.file === file);
  if (!record) {
    return new Set();
  }

  return new Set(record.keys);
}

/**
 * 更新 translation.json 的文件记录
 */
export function updateTranslationManifest(
  manifest: { files: Array<{ file: string; keys: string[] }> },
  file: string,
  newKeys: string[]
): typeof manifest {
  const existingRecord = manifest.files.find((f) => f.file === file);

  if (existingRecord) {
    const keySet = new Set(existingRecord.keys);
    for (const key of newKeys) {
      keySet.add(key);
    }
    existingRecord.keys = Array.from(keySet).sort();
  } else {
    manifest.files.push({
      file,
      keys: newKeys.sort(),
    });
  }

  return manifest;
}

/**
 * 获取新增的翻译 key（相对于已记录的）
 */
export function getNewTranslationKeys(
  filePath: string,
  allKeys: string[],
  manifest: { files: Array<{ file: string; keys: string[] }> } | null
): string[] {
  const translatedKeys = getTranslatedKeysFromManifest(manifest, filePath);
  return allKeys.filter((key) => !translatedKeys.has(key));
}

// ===== NEW FUNCTIONS USING DEEP-DIFF =====

/**
 * 使用 deep-diff 计算值级别差异
 * 检测键值对是否发生变化，用于判断是否需要重新翻译
 */
export function computeValueDiff(
  defaultData: Record<string, unknown>,
  zhDefaultData: Record<string, unknown> | null
): ValueDiffResult {
  const result: ValueDiffResult = {
    newKeys: [],
    changedKeys: [],
    unchangedKeys: [],
  };

  if (!zhDefaultData) {
    // No zh.default - all keys are "new"
    result.newKeys = Object.keys(defaultData);
    return result;
  }

  // Use deep-diff to detect changes
  const differences = Diff.diff(zhDefaultData, defaultData);

  const allKeys = new Set([
    ...Object.keys(defaultData),
    ...Object.keys(zhDefaultData),
  ]);

  for (const key of allKeys) {
    const defaultValue = defaultData[key];
    const zhDefaultValue = zhDefaultData[key];

    if (!(key in zhDefaultData)) {
      // Key exists only in default (new)
      result.newKeys.push(key);
    } else if (!(key in defaultData)) {
      // Key exists only in zh.default (shouldn't happen in normal flow)
      continue;
    } else {
      // Key exists in both - check if value changed
      // Use deep-diff to detect if this specific key changed
      const keyDiffs = differences?.filter((d) => {
        if (d.kind !== "E") return false;
        const path = d.path || [];
        const pathStr = path.join(".");
        const keyParts = key.split(".");
        if (path.length === 1 && path[0] === key) {
          // Simple key like "key1" or dot-notation stored flat like "Guild.CapeDinos.Name"
          return true;
        } else if (path.length === keyParts.length && pathStr === key) {
          // Dot-notation key like "Guild.CapeDinos.Name" matches ["Guild", "CapeDinos", "Name"]
          return true;
        }
        return false;
      });

      if (keyDiffs && keyDiffs.length > 0) {
        result.changedKeys.push(key);
      } else {
        result.unchangedKeys.push(key);
      }
    }
  }

  return result;
}

/**
 * 获取需要翻译的键列表（新增 + 变更）
 */
export function getKeysToTranslate(
  defaultData: Record<string, unknown>,
  zhDefaultData: Record<string, unknown> | null
): string[] {
  const diff = computeValueDiff(defaultData, zhDefaultData);
  return [...diff.newKeys, ...diff.changedKeys];
}
