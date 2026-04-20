import fs from "node:fs";
import type { ModConfig } from "./types";
import { FileType } from "./types";

/**
 * 加载配置文件
 */
export function loadConfig(configPath: string): ModConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(content) as ModConfig;
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
