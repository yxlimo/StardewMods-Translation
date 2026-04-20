import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "../src/fileHandler";
import { computeJsonDiff, getTranslatedKeysFromManifest, getNewTranslationKeys } from "../src/diff";
import { getFileType, loadConfig } from "../src/config";
import { translateFile, translateI18nFile, translateJsonFile } from "../src/translator";
import { query, updateAtPath } from "../src/query";
import type { TranslationManifest, TranslationResult } from "../src/types";
import { FileType } from "../src/types";
import {
  setMockMode,
  setMockTranslation,
  clearMockTranslations,
  translateWithLLM,
  translateBatch,
} from "../src/llm";
import { existsSync, unlinkSync } from "node:fs";

const RESOURCES = resolve("tests/resources");
const ORIGIN_DIR = resolve(RESOURCES, "origin");
const ZH_DIR = resolve(RESOURCES, "zh");
const CONFIG_DIR = resolve(RESOURCES, "config");

describe("fileHandler", () => {
  test("readJsonFile reads valid JSON", () => {
    const testData = { key: "value", nested: { key: 123 } };
    const path = "/tmp/test_translator.json";
    writeJsonFile(path, testData);

    const result = readJsonFile<typeof testData>(path);
    expect(result).toEqual(testData);
  });

  test("readJsonFile returns null for non-existent file", () => {
    const result = readJsonFile("/tmp/nonexistent_file.json");
    expect(result).toBeNull();
  });

  test("writeJsonFile creates directory if not exists", () => {
    const testData = { key: "value" };
    const path = "/tmp/nested/test/dir.json";
    writeJsonFile(path, testData);

    const result = readJsonFile<typeof testData>(path);
    expect(result).toEqual(testData);
  });
});

describe("query", () => {
  test("query handles top-level keys with dots using backticks", () => {
    // i18n 文件中的 key 如 "Strings.SirensLog" 包含点但不是嵌套结构
    // 用反引号包裹表示这是一个完整的 key
    const data = {
      "Strings.SirensLog": "Captain Siren's Log",
      "Guild.CapeDinos.Name": "Dino Encounter",
    };

    const results = query(data, "`Strings.SirensLog`");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("Strings.SirensLog");
    expect(results[0].value).toBe("Captain Siren's Log");
  });

  test("query handles top-level keys without dots", () => {
    const data = {
      "key1": "value1",
      "key2": "value2",
    };

    const results = query(data, "key1");
    expect(results.length).toBe(1);
    expect(results[0].value).toBe("value1");
  });

  test("updateAtPath handles top-level keys with dots", () => {
    const data = {
      "Strings.SirensLog": "Captain Siren's Log",
    };

    const updated = updateAtPath(data, "Strings.SirensLog", "塞壬船长的日志");
    expect(updated["Strings.SirensLog"]).toBe("塞壬船长的日志");
  });

  test("query handles nested paths", () => {
    const data = {
      Changes: [
        {
          Entries: {
            CapeBusStop: {
              ChooseDestinationMessage: "返回农场？",
            },
          },
        },
      ],
    };

    const results = query(data, "Changes(*).Entries.CapeBusStop.ChooseDestinationMessage");
    expect(results.length).toBe(1);
  });

  test("query handles ConfigSchema-style nested paths", () => {
    // ConfigSchema.AnnettaPortraitStyle.Description 是嵌套结构
    // 不带反引号应该按嵌套路径处理
    const data = {
      ConfigSchema: {
        AnnettaPortraitStyle: {
          Description: "Switch the default portrait for Annetta",
        },
      },
    };

    const results = query(data, "ConfigSchema.AnnettaPortraitStyle.Description");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("ConfigSchema.AnnettaPortraitStyle.Description");
    expect(results[0].value).toBe("Switch the default portrait for Annetta");
  });

  test("query without backticks splits by dots (nested path), with backticks treats as single key", () => {
    // 不带反引号：按嵌套路径拆分
    // 带反引号：作为完整 key 处理
    const data = {
      "ConfigSchema.Ann": "value1", // 顶级 key，包含点
      ConfigSchema: {
        Ann: "value2", // 嵌套路径
      },
    };

    // 带反引号：作为完整 key "ConfigSchema.Ann"
    const backtickResults = query(data, "`ConfigSchema.Ann`");
    expect(backtickResults.length).toBe(1);
    expect(backtickResults[0].value).toBe("value1");

    // 不带反引号：作为嵌套路径 ConfigSchema.Ann
    const nestedResults = query(data, "ConfigSchema.Ann");
    expect(nestedResults.length).toBe(1);
    expect(nestedResults[0].value).toBe("value2");
  });

  test("query handles deep nested paths with array wildcards", () => {
    const data = {
      Changes: [
        {
          Entries: {
            CapeBusStop: {
              ChooseDestinationMessage: "返回农场？",
              LockedMessage: "暂停服务",
            },
          },
        },
        {
          Entries: {
            "dreamy.kickitspot_shop": {
              ChooseDestinationMessage: "选择目的地：",
            },
          },
        },
      ],
    };

    const results = query(data, "Changes(*).Entries.CapeBusStop.ChooseDestinationMessage");
    expect(results.length).toBe(1);
    expect(results[0].value).toBe("返回农场？");
  });

  test("updateAtPath with backticks for key containing dots", () => {
    const data = {
      "ConfigSchema.Option.Description": "Original description",
    };

    const updated = updateAtPath(data, "`ConfigSchema.Option.Description`", "新描述");
    expect(updated["ConfigSchema.Option.Description"]).toBe("新描述");
  });

  test("query returns empty for non-existent key", () => {
    const data = {
      key1: "value1",
    };

    const results = query(data, "nonexistent");
    expect(results.length).toBe(0);
  });

  test("query with quoted key syntax for keys with special characters", () => {
    const data = {
      Changes: [
        {
          Entries: {
            "dreamy.kickitspot_shop": {
              Name: "Shop Name",
            },
          },
        },
      ],
    };

    const results = query(data, 'Changes(*).Entries["dreamy.kickitspot_shop"].Name');
    expect(results.length).toBe(1);
    expect(results[0].value).toBe("Shop Name");
  });

  test("simulates CapeStardew content.json ConfigSchema query scenario", () => {
    // 模拟 [CP]Annetta/content.json 的 ConfigSchema 结构
    const originData = {
      ConfigSchema: {
        AnnettaPortraitStyle: {
          AllowValues: "Front, AlternativeFront, 3/4(original), None(other)",
          Default: "Front",
          Description: "Switch the default portrait for Annetta",
        },
      },
    };

    const zhData = {
      ConfigSchema: {
        AnnettaPortraitStyle: {
          AllowValues: "Front, AlternativeFront, 3/4(original), None(other)",
          Default: "Front",
          Description: "切换 Annetta 的默认肖像",
        },
      },
    };

    // 查询 origin 中的 Description
    const originResults = query(originData, "ConfigSchema.AnnettaPortraitStyle.Description");
    expect(originResults.length).toBe(1);
    expect(originResults[0].value).toBe("Switch the default portrait for Annetta");

    // 查询 zh 中的 Description
    const zhResults = query(zhData, "ConfigSchema.AnnettaPortraitStyle.Description");
    expect(zhResults.length).toBe(1);
    expect(zhResults[0].value).toBe("切换 Annetta 的默认肖像");

    // 两者不同，说明已有翻译
    expect(zhResults[0].value).not.toBe(originResults[0].value);
  });

  test("query handles multiple top-level keys with dots using backticks", () => {
    const data = {
      "Strings.SirensLog": "Log entry",
      "Strings.OtherLog": "Other entry",
      "Strings": {
        NestedLog: "nested entry",
      },
    };

    // 带反引号查顶级 key
    const results1 = query(data, "`Strings.SirensLog`");
    expect(results1.length).toBe(1);
    expect(results1[0].value).toBe("Log entry");

    // 不带反引号查嵌套
    const results2 = query(data, "Strings.NestedLog");
    expect(results2.length).toBe(1);
    expect(results2[0].value).toBe("nested entry");
  });
});

describe("config", () => {
  test("getFileType identifies i18n/default.json", () => {
    expect(getFileType("Cape Stardew/i18n/default.json")).toBe(FileType.I18nDefault);
  });

  test("getFileType identifies JSON files", () => {
    expect(getFileType("content.json")).toBe(FileType.Json);
    expect(getFileType("Data/CapeShops.json")).toBe(FileType.Json);
  });

  test("loadConfig loads test config", () => {
    const config = loadConfig(resolve(CONFIG_DIR, "TestMod.json"));
    expect(config.baseDir).toBe("TestMod");
    expect(config.files.length).toBe(3);
  });
});

describe("diff", () => {
  test("computeJsonDiff finds new keys", () => {
    const oldData = { a: 1, b: 2 };
    const newData = { a: 1, b: 2, c: 3 };

    const diff = computeJsonDiff(newData, oldData);
    expect(diff.has("c")).toBe(true);
    expect(diff.has("a")).toBe(false);
    expect(diff.has("b")).toBe(false);
  });

  test("computeJsonDiff handles null oldData", () => {
    const newData = { a: 1, b: 2 };
    const diff = computeJsonDiff(newData, null);

    expect(diff.has("a")).toBe(true);
    expect(diff.has("b")).toBe(true);
  });

  test("computeJsonDiff finds nested keys", () => {
    const oldData = { nested: { a: 1 } };
    const newData = { nested: { a: 1, b: 2 }, other: "value" };

    const diff = computeJsonDiff(newData, oldData);
    expect(diff.has("nested.b")).toBe(true);
    expect(diff.has("other")).toBe(true);
  });

  test("getTranslatedKeysFromManifest returns empty set for null manifest", () => {
    const result = getTranslatedKeysFromManifest(null, "anyfile.json");
    expect(result.size).toBe(0);
  });

  test("getTranslatedKeysFromManifest finds keys for file", () => {
    const manifest: TranslationManifest = {
      version: "1.0",
      files: [
        {
          file: "test.json",
          keys: ["key1", "key2", "key3"],
        },
      ],
    };

    const result = getTranslatedKeysFromManifest(manifest, "test.json");
    expect(result.size).toBe(3);
    expect(result.has("key1")).toBe(true);
    expect(result.has("key2")).toBe(true);
    expect(result.has("key3")).toBe(true);
  });

  test("getTranslatedKeysFromManifest returns empty for unknown file", () => {
    const manifest: TranslationManifest = {
      version: "1.0",
      files: [
        {
          file: "test.json",
          keys: ["key1"],
        },
      ],
    };

    const result = getTranslatedKeysFromManifest(manifest, "unknown.json");
    expect(result.size).toBe(0);
  });

  test("getNewTranslationKeys filters already translated keys", () => {
    const manifest: TranslationManifest = {
      version: "1.0",
      files: [
        {
          file: "test.json",
          keys: ["key1"],
        },
      ],
    };

    const allKeys = ["key1", "key2", "key3"];
    const newKeys = getNewTranslationKeys("test.json", allKeys, manifest);
    expect(newKeys).toEqual(["key2", "key3"]);
  });
});

describe("llm", () => {
  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
  });

  test("translateWithLLM returns mock translation in mock mode", async () => {
    const result = await translateWithLLM("Hello", "English", "Chinese");
    expect(result).toBe("[MOCK] Hello -> 中文翻译");
  });

  test("translateBatch returns mock translations in mock mode", async () => {
    const texts = ["Hello", "World", "Test"];
    const results = await translateBatch(texts, "English", "Chinese");
    expect(results).toEqual([
      "[MOCK] Hello -> 中文",
      "[MOCK] World -> 中文",
      "[MOCK] Test -> 中文",
    ]);
  });

  test("translateBatch with custom mock translations", async () => {
    setMockTranslation("Hello", "你好");
    setMockTranslation("World", "世界");
    setMockTranslation("Test", "测试");

    const texts = ["Hello", "World", "Test"];
    const results = await translateBatch(texts, "English", "Chinese");
    expect(results).toEqual(["你好", "世界", "测试"]);
  });

  test("translateBatch returns empty array for empty input", async () => {
    const results = await translateBatch([], "English", "Chinese");
    expect(results).toEqual([]);
  });

  test("translateBatch uses fallback when no custom mock translation", async () => {
    clearMockTranslations();
    // mockTranslations is now empty, so it uses the default fallback
    const texts = ["Hello", "Unknown"];
    const results = await translateBatch(texts, "English", "Chinese");
    expect(results).toEqual(["[MOCK] Hello -> 中文", "[MOCK] Unknown -> 中文"]);
  });
});

describe("integration", () => {
  test("i18n translation adds new keys from origin", () => {
    const originPath = resolve(ORIGIN_DIR, "TestMod/i18n/default.json");
    const zhPath = resolve(ZH_DIR, "TestMod/i18n/zh.json");

    const originData = readJsonFile<Record<string, unknown>>(originPath);
    const zhData = readJsonFile<Record<string, unknown> | null>(zhPath);

    expect(originData).not.toBeNull();
    expect(zhData).not.toBeNull();

    // key4 存在于 origin 但不存在于 zh（新增）
    expect(Object.prototype.hasOwnProperty.call(originData, "key4")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(zhData, "key4")).toBe(false);
  });
});

describe("translator with LLM", () => {
  const TEST_ORIGIN = "/tmp/translator_llm_origin.json";
  const TEST_ZH = "/tmp/translator_llm_zh.json";

  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("New key in updated version", "新项目");
    setMockTranslation("Test string", "测试字符串");
    setMockTranslation("Hello", "你好");
    // 删除可能存在的目标文件，确保测试干净
    if (existsSync(TEST_ZH)) {
      unlinkSync(TEST_ZH);
    }
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
  });

  test("translateI18nFile translates new keys with mock LLM", async () => {
    const originData = {
      "key1": "Value 1",
      "key2": "Value 2",
      "key3": "Value 3",
      "key4": "New key in updated version",
    };

    // 不创建 zh 文件，模拟全新翻译场景 - 所有 key 都被视为新 key
    writeJsonFile(TEST_ORIGIN, originData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    // 所有 4 个 key 都是新的（没有现有翻译文件）
    expect(result.translatedCount).toBe(4);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData).not.toBeNull();
    // key4 有特定翻译映射
    expect(translatedData!["key4"]).toBe("新项目");
    // 其他 key 使用 fallback 翻译
    expect(translatedData!["key1"]).toBe("[MOCK] Value 1 -> 中文");
  });

  test("translateI18nFile updates existing file with new keys", async () => {
    const originData = {
      "key1": "Value 1",
      "key2": "Value 2",
      "key3": "Value 3",
      "key4": "New key in updated version",
    };
    const existingZhData = {
      "key1": "值 1",
      "key2": "值 2",
    };

    writeJsonFile(TEST_ORIGIN, originData);
    writeJsonFile(TEST_ZH, existingZhData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    // key3 和 key4 是新 key
    expect(result.translatedCount).toBe(2);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData).not.toBeNull();
    // 保留已有翻译
    expect(translatedData!["key1"]).toBe("值 1");
    expect(translatedData!["key2"]).toBe("值 2");
  });

  test("translateI18nFile preserves Chinese values when all keys match (diffKeys empty)", async () => {
    // 当 origin 和 target 拥有相同 key（值也相同）时，diffKeys 为空
    // 此时应保留 target 中的中文翻译，而非使用 origin 的英文值
    const originData = {
      "key1": "Hello",
      "key2": "World",
    };
    const existingZhData = {
      "key1": "你好",
      "key2": "世界",
    };

    writeJsonFile(TEST_ORIGIN, originData);
    writeJsonFile(TEST_ZH, existingZhData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    // 没有新 key 需要翻译
    expect(result.translatedCount).toBe(0);
    // 两个 key 都是已有翻译
    expect(result.skippedCount).toBe(2);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData).not.toBeNull();
    // 必须保留中文翻译，不能是英文
    expect(translatedData!["key1"]).toBe("你好");
    expect(translatedData!["key2"]).toBe("世界");
  });

  test("translateI18nFile translates keys with dots in top-level key", async () => {
    // 当 origin 有带点的顶级 key（如 "Guild.CapeDinos.Name"），zh 中没有时能正确翻译
    const originData = {
      "Guild.CapeDinos.Name": "Dino Encounter",
      "Guild.CapeDinos.Dialogue": "A dinosaur dialogue",
    };

    writeJsonFile(TEST_ORIGIN, originData);

    const result: TranslationResult = {
      success: true,
      file: "test",
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateI18nFile(TEST_ORIGIN, TEST_ZH, result);

    expect(result.success).toBe(true);
    // 两个带点的 key 都应该被翻译
    expect(result.translatedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const translatedData = readJsonFile<Record<string, string>>(TEST_ZH);
    expect(translatedData).not.toBeNull();
    // 应该保留原有的 key 格式（带点）
    expect(translatedData!["Guild.CapeDinos.Name"]).toBeDefined();
    expect(translatedData!["Guild.CapeDinos.Dialogue"]).toBeDefined();
    // 值应该是中文翻译，不是英文
    expect(translatedData!["Guild.CapeDinos.Name"]).not.toBe("Dino Encounter");
    expect(translatedData!["Guild.CapeDinos.Dialogue"]).not.toBe("A dinosaur dialogue");
  });

  test("translateI18nFile handles non-string values", async () => {
    const originData = {
      "greeting": "Hello",
      "count": 42,
      "enabled": true,
    };

    writeJsonFile(TEST_ORIGIN, originData);

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
    expect(translatedData).not.toBeNull();
expect(translatedData!["greeting"]).toBe("你好");
    expect(translatedData!["count"]).toBe(42);
    expect(translatedData!["enabled"]).toBe(true);
  });
});

describe("dataWithArray translation with location keys", () => {
  const TEST_ORIGIN = resolve(ORIGIN_DIR, "TestMod/Data/dataWithArray.json");
  const TEST_ZH = "/tmp/translator_dataWithArray_zh.json";
  const TEST_CONFIG = resolve(CONFIG_DIR, "TestMod.json");

  beforeEach(() => {
    setMockMode(true);
    clearMockTranslations();
    setMockTranslation("EnglishMessageToTranslate", "已翻译消息");
    if (existsSync(TEST_ZH)) {
      unlinkSync(TEST_ZH);
    }
  });

  afterEach(() => {
    setMockMode(false);
    clearMockTranslations();
  });

  test("translateJsonFile with location keys translates only target values", async () => {
    const config = loadConfig(TEST_CONFIG);
    const dataWithArrayEntry = config.files.find(
      (f) => f.file === "Data/dataWithArray.json"
    )!;

    const result: TranslationResult = {
      success: true,
      file: dataWithArrayEntry.file,
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    await translateJsonFile(
      "TestMod",
      TEST_ORIGIN,
      TEST_ZH,
      dataWithArrayEntry,
      result
    );

    expect(result.success).toBe(true);

    const translatedData = readJsonFile<Record<string, unknown>>(TEST_ZH);
    expect(translatedData).not.toBeNull();

    // Changes is an array - verify structure is preserved
    expect(Array.isArray(translatedData!.Changes)).toBe(true);

    // CapeBusStop.ChooseDestinationMessage should be translated
    const capeEntry = translatedData!.Changes[0].Entries.CapeBusStop;
    expect(capeEntry.ChooseDestinationMessage).toBe("已翻译消息");

    // dreamy.kickitspot_CapeSeaCavern entries should be translated
    const seaCavernEntry = translatedData!.Changes[1].Entries["dreamy.kickitspot_CapeSeaCavern"];
    expect(seaCavernEntry.LockedMessage).toBe("已翻译消息");
    expect(seaCavernEntry.ChooseDestinationMessage).toBe("已翻译消息");

    // jellishop Dialogue should be translated (value matches EnglishMessageToTranslate)
    const jelliShopEntry = translatedData!.Changes[2].Entries["dreamy.kickitspot_jellishop"];
    expect(jelliShopEntry.Owners[0].Dialogues[0].Dialogue).toBe("已翻译消息");

    // jellishop2 should also have translated Dialogue
    const jelliShop2Entry = translatedData!.Changes[2].Entries["dreamy.kickitspot_jellishop2"];
    expect(jelliShop2Entry.Owners[0].Dialogues[0].Dialogue).toBe("已翻译消息");
  });
});
