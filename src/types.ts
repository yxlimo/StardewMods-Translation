/**
 * 配置文件格式
 */
export interface ModConfig {
  /** 基础目录（可选，默认使用 config 文件名） */
  baseDir?: string;
  files: FileEntry[];
}

/**
 * 文件条目
 */
export interface FileEntry {
  /** 原始文件路径（相对于 origin/{baseDir}/） */
  file: string;
  /** 翻译后文件路径（相对于 zh/{baseDir}/） */
  target: string;
  /** 是否全量翻译 */
  translateAll?: boolean;
  /** 使用 path 匹配的 key 列表（xpath-like 语法） */
  translateKeys?: string[];
  /** 已翻译的 key-value 对（从 translation.json 合并） */
  keys?: Record<string, string>;
}

/**
 * 文件类型枚举
 */
export enum FileType {
  /** i18n/default.json - 全量翻译 */
  I18nDefault = "i18n/default.json",
  /** JSON 文件 - 按 key 翻译 */
  Json = "json",
  /** 其他文件 */
  Unknown = "unknown",
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  success: boolean;
  file: string;
  target: string;
  translatedCount: number;
  skippedCount: number;
  errors?: string[];
}

/**
 * 翻译清单（translation.json）
 * 用于跟踪已翻译的 keys
 */
export interface TranslationManifest {
  version: string;
  files: TranslationFileRecord[];
}

/**
 * 翻译文件记录
 */
export interface TranslationFileRecord {
  file: string;
  keys: string[];
}

/**
 * Mod 信息（从 manifest.json 提取）
 */
export interface ModInfo {
  name: string;
  uniqueId: string;
  version: string;
  path: string;
  i18nFiles: I18nFileInfo[];
  updateKeys?: string[];
}

/**
 * i18n 文件信息
 */
export interface I18nFileInfo {
  /** 相对于 mod 根目录的路径 */
  relativePath: string;
  /** default.json 的绝对路径 */
  defaultPath: string;
  /** zh.json 的绝对路径（可能不存在） */
  zhPath: string | null;
}

/**
 * Manifest 结构
 */
export interface Manifest {
  Name: string;
  Version: string;
  UniqueID: string;
  UpdateKeys?: string[];
  [key: string]: unknown;
}

/**
 * 值差异结果
 */
export interface ValueDiffResult {
  newKeys: string[];
  changedKeys: string[];
  unchangedKeys: string[];
}
