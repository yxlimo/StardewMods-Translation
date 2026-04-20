import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "../src/fileHandler";
import { computeJsonDiff } from "../src/diff";
import { getFileType } from "../src/config";
import { translateI18nFile } from "../src/translator";
import type { TranslationResult } from "../src/types";
import { FileType } from "../src/types";
import {
  setMockMode,
  setMockTranslation,
  clearMockTranslations,
} from "../src/llm";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { DEFAULT_DIR, ZH_DIR, TEST_MOD } from "./shared";

const TEST_ORIGIN = resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json");
const TEST_ZH = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json");

describe("fileHandler", () => {
  test("readJsonFile reads valid JSON", () => {
    const testData = { key: "value", nested: { key: 123 } };
    const path = "/tmp/test_translator.json";
    writeJsonFile(path, testData);

    const result = readJsonFile<typeof testData>(path);
    expect(result).toEqual(testData);
  });

  test("readJsonFile throws for non-existent file", () => {
    expect(() => readJsonFile("/tmp/nonexistent_file.json")).toThrow();
  });

  test("writeJsonFile creates directory if not exists", () => {
    const testData = { key: "value" };
    const path = "/tmp/nested/test/dir.json";
    writeJsonFile(path, testData);

    const result = readJsonFile<typeof testData>(path);
    expect(result).toEqual(testData);
  });

  test("writeJsonFile overwrites existing file", () => {
    const path = "/tmp/test_overwrite.json";
    writeJsonFile(path, { key: "original" });
    writeJsonFile(path, { key: "updated" });

    const result = readJsonFile<{ key: string }>(path);
    expect(result.key).toBe("updated");
  });
});

describe("config", () => {
  test("getFileType identifies i18n/default.json", () => {
    const fileType = getFileType("i18n/default.json");
    expect(fileType).toBe(FileType.I18nDefault);
  });

  test("getFileType identifies regular JSON", () => {
    const fileType = getFileType("Data/content.json");
    expect(fileType).toBe(FileType.Json);
  });

  test("getFileType identifies TMX", () => {
    const fileType = getFileType("Assets/map.tmx");
    expect(fileType).toBe(FileType.Tmx);
  });
});

describe("diff", () => {
  test("computeJsonDiff finds new keys", () => {
    const newData = { key1: "value1", key2: "value2" };
    const oldData = { key1: "value1" };

    const diff = computeJsonDiff(newData, oldData);

    expect(diff.has("key2")).toBe(true);
    expect(diff.has("key1")).toBe(false);
  });

  test("computeJsonDiff handles null oldData", () => {
    const newData = { key1: "value1", key2: "value2" };

    const diff = computeJsonDiff(newData, null);

    expect(diff.has("key1")).toBe(true);
    expect(diff.has("key2")).toBe(true);
  });
});

describe("translator with LLM", () => {
  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("New key in updated version", "新项目");
    setMockTranslation("Test string", "测试字符串");
    setMockTranslation("Hello", "你好");
    setMockTranslation("Some other text", "其他文本");
    mkdirSync(resolve(ZH_DIR, TEST_MOD, "i18n"), { recursive: true });
    if (existsSync(TEST_ZH)) {
      unlinkSync(TEST_ZH);
    }
    const zhDefaultPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default");
    if (existsSync(zhDefaultPath)) {
      unlinkSync(zhDefaultPath);
    }
    writeJsonFile(zhDefaultPath, { key1: "Hello", key2: "Test string", key3: "Some other text", key4: "New key in updated version" });
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
    const zhDefaultPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default");
    if (existsSync(zhDefaultPath)) {
      unlinkSync(zhDefaultPath);
    }
  });

  test("translateI18nFile translates new keys with mock LLM", async () => {
    const originData = {
      "key1": "Hello",
      "key2": "Test string",
      "key3": "Some other text",
      "key4": "New key in updated version",
    };
    const zhDefaultData = {
      "key1": "Old Hello",
      "key2": "Old Test string",
      "key3": "Old text",
      "key4": "Old version",
    };

    writeJsonFile(TEST_ORIGIN, originData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"), zhDefaultData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(4);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData["key4"]).toBe("新项目");
    expect(translatedData["key2"]).toBe("测试字符串");
    expect(translatedData["key1"]).toBe("你好");
  });

  test("translateI18nFile preserves existing translations when keys unchanged", async () => {
    const originData = {
      "key1": "Hello",
      "key2": "Test string",
    };
    const existingZhData = {
      "key1": "你好",
      "key2": "测试字符串",
    };

    writeJsonFile(TEST_ORIGIN, originData);
    writeJsonFile(TEST_ZH, existingZhData);
    const zhDefaultPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default");
    writeJsonFile(zhDefaultPath, originData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData["key1"]).toBe("你好");
    expect(translatedData["key2"]).toBe("测试字符串");
  });

  test("translateI18nFile handles non-string values", async () => {
    const originData = {
      "key1": "Hello",
      "key2": 123,
      "key3": null,
    };
    const zhDefaultData = {
      "key1": "Old Hello",
      "key2": 123,
      "key3": null,
    };

    writeJsonFile(TEST_ORIGIN, originData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"), zhDefaultData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(1);

    const translatedData = readJsonFile<Record<string, unknown>>(TEST_ZH);
    expect(translatedData["key2"]).toBe(123);
    expect(translatedData["key3"]).toBeNull();
  });

  test("translateI18nFile handles keys with dots", async () => {
    const originData = {
      "key1": "Hello",
      "Guild.CapeDinos.Name": "Cape Dino",
      "Menu.Save.ok_button": "OK",
    };
    const zhDefaultData = {
      "key1": "Hello",
      "Guild.CapeDinos.Name": "Old Dino Name",
      "Menu.Save.ok_button": "Old OK",
    };
    const existingZhData = {
      "key1": "你好",
    };
    writeJsonFile(TEST_ORIGIN, originData);
    const zhDefaultPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default");
    writeJsonFile(zhDefaultPath, zhDefaultData);
    writeJsonFile(TEST_ZH, existingZhData);

    setMockTranslation("Cape Dino", "披风恐龙");
    setMockTranslation("OK", "确认");

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(2);
    expect(result.skippedCount).toBe(1);

    const translatedData = readJsonFile<Record<string, unknown>>(TEST_ZH);
    expect(translatedData["key1"]).toBe("你好");
    expect(translatedData["Guild.CapeDinos.Name"]).toBe("披风恐龙");
    expect(translatedData["Menu.Save.ok_button"]).toBe("确认");
  });
});
