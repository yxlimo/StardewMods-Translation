import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "../src/fileHandler";
import { translateI18nFile } from "../src/translator";
import type { TranslationResult } from "../src/types";
import { setMockMode, setMockTranslation, clearMockTranslations } from "../src/llm";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { DEFAULT_DIR, ZH_DIR } from "./shared";

const TEST_MOD = "TestModFlatKey";

describe("translateI18nFile with flat keys containing dots", () => {
  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
    mkdirSync(resolve(ZH_DIR, TEST_MOD, "i18n"), { recursive: true });
    mkdirSync(resolve(DEFAULT_DIR, TEST_MOD, "i18n"), { recursive: true });

    const files = [
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"),
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"),
      resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"),
    ];
    for (const f of files) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
    const files = [
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"),
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"),
      resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"),
    ];
    for (const f of files) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  test("translateI18nFile handles changed keys from zh.default", async () => {
    // default.json has updated/changed keys
    const originData = {
      "config.key-1.word": "English",
      "config.key-2.word": "English Changed",
      "config.key-3.word": "New English Key",
      "config.key-5.word": "New English Key",
    };
    // zh.json.default is the old version of default.json
    const zhDefaultData = {
      "config.key-1.word": "English",
      "config.key-2.word": "English",
      "config.key-3.word": "English",
    };
    // zh.json has existing translations
    const existingZhData = {
      "config.key-1.word": "翻译1",
      "config.key-2.word": "翻译2旧",
      "config.key-3.word": "翻译3旧",
    };

    writeJsonFile(resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"), originData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"), zhDefaultData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"), existingZhData);

    setMockTranslation("English Changed", "英文已更改");
    setMockTranslation("New English Key", "新的英文键");

    const originPath = resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json");

    const result: TranslationResult = {
      success: false,
      file: "i18n/default.json",
      target: "i18n/zh.json",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.success).toBe(true);
    // key-1 unchanged (沿用), key-2 changed (重新翻译), key-3 new (翻译), key-5 new (翻译)
    expect(result.translatedCount).toBe(3);
    expect(result.skippedCount).toBe(1);

    const translatedData = readJsonFile<Record<string, string>>(targetPath);

    // key-1 unchanged, keep existing translation
    expect(translatedData["config.key-1.word"]).toBe("翻译1");
    // key-2 changed, re-translated
    expect(translatedData["config.key-2.word"]).toBe("英文已更改");
    // key-3 new, translated
    expect(translatedData["config.key-3.word"]).toBe("新的英文键");
    // key-5 new, translated
    expect(translatedData["config.key-5.word"]).toBe("新的英文键");
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

    writeJsonFile(resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"), originData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"), existingZhData);
    writeJsonFile(resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"), originData);

    const originPath = resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json");

    const result: TranslationResult = {
      success: false,
      file: "i18n/default.json",
      target: "i18n/zh.json",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.success).toBe(true);
    expect(result.translatedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    const translatedData = readJsonFile<Record<string, string>>(targetPath);
    expect(translatedData["key1"]).toBe("你好");
    expect(translatedData["key2"]).toBe("测试字符串");
  });
});

describe("backupI18nDefault after translation", () => {
  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
    mkdirSync(resolve(ZH_DIR, TEST_MOD, "i18n"), { recursive: true });
    mkdirSync(resolve(DEFAULT_DIR, TEST_MOD, "i18n"), { recursive: true });

    const files = [
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"),
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"),
      resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"),
    ];
    for (const f of files) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
    const files = [
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json"),
      resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default"),
      resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"),
    ];
    for (const f of files) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  test("creates .default backup file after translation", async () => {
    const originData = {
      "key1": "Hello",
      "key2": "World",
    };

    writeJsonFile(resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json"), originData);

    const originPath = resolve(DEFAULT_DIR, TEST_MOD, "i18n", "default.json");
    const targetPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json");

    const result: TranslationResult = {
      success: false,
      file: "i18n/default.json",
      target: "i18n/zh.json",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(originPath, targetPath, result);

    expect(result.success).toBe(true);

    // Verify backup file exists
    const zhDefaultPath = resolve(ZH_DIR, TEST_MOD, "i18n", "zh.json.default");
    expect(existsSync(zhDefaultPath)).toBe(true);

    // Verify backup content matches origin
    const backupData = readJsonFile<Record<string, string>>(zhDefaultPath);
    expect(backupData).toEqual(originData);
  });
});