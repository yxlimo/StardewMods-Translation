import { describe, test, expect, afterEach } from "bun:test";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "../src/fileHandler";
import { translateI18nFile } from "../src/translator";
import type { TranslationResult } from "../src/types";
import {
  setMockMode,
  setMockTranslation,
  clearMockTranslations,
} from "../src/llm";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { compareVersions, needsTranslation, getModVersion } from "../src/versionManager";
import { DEFAULT_DIR, ZH_DIR } from "./shared";

function cleanupTestCaseDir(testCase: string) {
  const zhDir = resolve(ZH_DIR, testCase);
  const zhJsonPath = resolve(zhDir, "i18n", "zh.json");
  const zhDefaultPath = resolve(zhDir, "i18n", "zh.json.default");

  if (existsSync(zhJsonPath)) unlinkSync(zhJsonPath);
  if (existsSync(zhDefaultPath)) unlinkSync(zhDefaultPath);
}

function setupTestCaseDir(testCase: string) {
  mkdirSync(resolve(ZH_DIR, testCase, "i18n"), { recursive: true });
}

describe("valueDiff - zh.json 不存在（全新翻译）", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCase1");
  });

  test("全新翻译成功，所有 key 都翻译", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCase1", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCase1", "i18n", "zh.json");

    setupTestCaseDir("TestCase1");
    cleanupTestCaseDir("TestCase1"); // 确保 zh.json 和 zh.json.default 都不存在

    writeJsonFile(originPath, { key1: "Hello", key2: "World" });

    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("Hello", "你好");
    setMockTranslation("World", "世界");

    const result: TranslationResult = {
      success: false,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const translatedData = readJsonFile<Record<string, string>>(targetPath);
    expect(translatedData["key1"]).toBe("你好");
    expect(translatedData["key2"]).toBe("世界");

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("valueDiff - zh.json 存在但 zh.json.default 不存在", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCaseError");
  });

  test("应该报错", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCaseError", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCaseError", "i18n", "zh.json");

    setupTestCaseDir("TestCaseError");
    cleanupTestCaseDir("TestCaseError");

    writeJsonFile(originPath, { key1: "Hello", key2: "World" });
    writeJsonFile(targetPath, { key1: "你好" }); // zh.json 存在

    setMockMode(true);
    clearMockTranslations();

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      await translateI18nFile(originPath, targetPath, result);
    } catch (err) {
      result.success = false;
      result.errors = [err instanceof Error ? err.message : String(err)];
    }

    expect(result.success).toBe(false);
    expect(result.errors && result.errors.length).toBeGreaterThan(0);

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("valueDiff - key 有变更但 value 没变", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCase2");
  });

  test("key 顺序改变但值相同，应该 skip", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCase2", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCase2", "i18n", "zh.json");

    setupTestCaseDir("TestCase2");
    cleanupTestCaseDir("TestCase2");

    writeJsonFile(targetPath, { key1: "你好", key2: "世界" });
    writeJsonFile(targetPath.replace(/\/zh\.json$/, "/zh.json.default"), { key1: "Hello", key2: "World" });

    setMockMode(true);
    clearMockTranslations();

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.translatedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    const translatedData = readJsonFile<Record<string, string>>(targetPath);
    expect(translatedData!["key1"]).toBe("你好");
    expect(translatedData!["key2"]).toBe("世界");

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("valueDiff - 新 key 需要翻译", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCase3");
  });

  test("default 有 key2 但 zh.default 没有，需要翻译", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCase3", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCase3", "i18n", "zh.json");

    setupTestCaseDir("TestCase3");
    cleanupTestCaseDir("TestCase3");

    writeJsonFile(targetPath, { key1: "你好" });
    writeJsonFile(targetPath.replace(/\/zh\.json$/, "/zh.json.default"), { key1: "Hello" });

    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("World", "世界");

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.translatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);

    const translatedData = readJsonFile<Record<string, string>>(targetPath);
    expect(translatedData!["key1"]).toBe("你好");
    expect(translatedData!["key2"]).toBe("世界");

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("valueDiff - key 顺序改变但值相同", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCase4");
  });

  test("沿用翻译", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCase4", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCase4", "i18n", "zh.json");

    setupTestCaseDir("TestCase4");
    cleanupTestCaseDir("TestCase4");

    writeJsonFile(targetPath, { key1: "你好", key2: "世界" });
    writeJsonFile(targetPath.replace(/\/zh\.json$/, "/zh.json.default"), { key2: "World", key1: "Hello" });

    setMockMode(true);
    clearMockTranslations();

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.translatedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("LLM mock 翻译流程", () => {
  afterEach(() => {
    cleanupTestCaseDir("TestCase5");
  });

  test("mock 翻译正常调用（值有变化）", async () => {
    const originPath = resolve(DEFAULT_DIR, "TestCase5", "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, "TestCase5", "i18n", "zh.json");

    setupTestCaseDir("TestCase5");
    cleanupTestCaseDir("TestCase5");

    writeJsonFile(targetPath, { key1: "你好", key2: "世界" });
    writeJsonFile(targetPath.replace(/\/zh\.json$/, "/zh.json.default"), { key1: "Hi", key2: "World" });

    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("Hello", "你好");

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.translatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);

    setMockMode(false);
    clearMockTranslations();
  });
});

describe("版本对比 - 无需翻译", () => {
  test("default 和 zh 版本一致，不需要翻译", () => {
    const defaultVersion = getModVersion("TestCase6", false, DEFAULT_DIR, ZH_DIR);
    const zhVersion = getModVersion("TestCase6", true, DEFAULT_DIR, ZH_DIR);

    expect(defaultVersion).toBe("1.0.0");
    expect(zhVersion).toBe("1.0.0");
    expect(needsTranslation(defaultVersion!, zhVersion)).toBe(false);
  });

  test("compareVersions 正常工作", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
  });
});
