import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";
import { FileType } from "./types";

/**
 * 读取 JSON 文件（支持 JSON5 注释格式）
 */
export function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  return JSON5.parse(content) as T;
}

/**
 * 写入 JSON 文件
 */
export function writeJsonFile<T>(filePath: string, data: T): void {
  const dir = resolve(filePath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 根据文件类型读取文件
 */
export function readFileByType<T>(
  filePath: string,
  fileType: FileType
): T | null {
  switch (fileType) {
    case FileType.I18nDefault:
    case FileType.Json:
      return readJsonFile<T>(filePath);
    default:
      return null;
  }
}

/**
 * 根据文件类型写入文件
 */
export function writeFileByType(
  filePath: string,
  data: unknown,
  fileType: FileType
): void {
  switch (fileType) {
    case FileType.I18nDefault:
    case FileType.Json:
      writeJsonFile(filePath, data);
      break;
    default:
      break;
  }
}
