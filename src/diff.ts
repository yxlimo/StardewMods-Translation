import type { TranslationManifest, TranslationFileRecord } from "./types";

/**
 * 计算 JSON 对象的增量差异
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
  manifest: TranslationManifest | null,
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
  manifest: TranslationManifest,
  file: string,
  newKeys: string[]
): TranslationManifest {
  const existingRecord = manifest.files.find((f) => f.file === file);

  if (existingRecord) {
    // 合并 keys
    const keySet = new Set(existingRecord.keys);
    for (const key of newKeys) {
      keySet.add(key);
    }
    existingRecord.keys = Array.from(keySet).sort();
  } else {
    // 新增记录
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
  manifest: TranslationManifest | null
): string[] {
  const translatedKeys = getTranslatedKeysFromManifest(manifest, filePath);
  return allKeys.filter((key) => !translatedKeys.has(key));
}
