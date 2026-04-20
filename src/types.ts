/**
 * 配置文件格式
 */
export interface ModConfig {
  baseDir: string;
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
