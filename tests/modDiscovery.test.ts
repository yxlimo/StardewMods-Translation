import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { discoverMods, getModInfo, generateDefaultConfig } from "../src/modDiscovery";
import { loadConfig } from "../src/config";
import { DEFAULT_DIR, ZH_DIR, TEST_MOD } from "./shared";

describe("modDiscovery", () => {
  test("discoverMods finds TestMod and lists all i18n files", () => {
    const mods = discoverMods(DEFAULT_DIR, ZH_DIR);

    expect(mods.length).toBeGreaterThan(0);
    const testMod = mods.find((m) => m.name === TEST_MOD);
    expect(testMod).toBeDefined();
    expect(testMod?.uniqueId).toBe("TestMod.1.2.0");
    expect(testMod?.version).toBe("1.2.0");
    expect(testMod?.i18nFiles.length).toBe(1);
    expect(testMod?.i18nFiles[0].relativePath).toBe("i18n");
  });

  test("getModInfo extracts correct info", () => {
    const modPath = resolve(DEFAULT_DIR, TEST_MOD);
    const modInfo = getModInfo(modPath, TEST_MOD, ZH_DIR);

    expect(modInfo).not.toBeNull();
    expect(modInfo?.name).toBe(TEST_MOD);
    expect(modInfo?.uniqueId).toBe("TestMod.1.2.0");
    expect(modInfo?.version).toBe("1.2.0");
    expect(modInfo?.i18nFiles.length).toBeGreaterThan(0);
    expect(modInfo?.i18nFiles[0].relativePath).toBe("i18n");
  });

  test("generateDefaultConfig creates i18n-only config", () => {
    const modPath = resolve(DEFAULT_DIR, TEST_MOD);
    const modInfo = getModInfo(modPath, TEST_MOD, ZH_DIR)!;
    const config = generateDefaultConfig(modInfo);

    expect(config.baseDir).toBe(TEST_MOD);
    expect(config.files.length).toBe(modInfo.i18nFiles.length);
    expect(config.files[0].file).toBe("i18n/default.json");
    expect(config.files[0].target).toBe("i18n/zh.json");
  });

  test("getModInfo returns null for non-mod directory", () => {
    const modInfo = getModInfo("/tmp", "NotAMod", ZH_DIR);
    expect(modInfo).toBeNull();
  });

  // TestCase1: 根目录有 manifest.json 和 i18n 文件夹
  test("TestCase1: 有 manifest.json 和 i18n 文件夹", () => {
    const modPath = resolve(DEFAULT_DIR, "TestCaseDiscovery1");
    const modInfo = getModInfo(modPath, "TestCaseDiscovery1", ZH_DIR);

    expect(modInfo).not.toBeNull();
    expect(modInfo?.i18nFiles.length).toBe(1);
    expect(modInfo?.i18nFiles[0].relativePath).toBe("i18n");
  });

  // TestCase2: 根目录有 manifest.json，没有 i18n 文件夹，没有 config.json
  test("TestCase2: 有 manifest，没有 i18n，没有 config，显示 mod 但无可翻译文件", () => {
    const modPath = resolve(DEFAULT_DIR, "TestCaseDiscovery2");
    const modInfo = getModInfo(modPath, "TestCaseDiscovery2", ZH_DIR);

    expect(modInfo).not.toBeNull();
    expect(modInfo?.i18nFiles.length).toBe(0);

    const config = generateDefaultConfig(modInfo!);
    expect(config.files).toHaveLength(0);
  });

  // TestCase3: 根目录有 manifest.json，没有 i18n 文件夹，有 config.json
  test("TestCase3: 有 manifest，没有 i18n，有 config，config 指定的文件可翻译", () => {
    const configPath = resolve("tests", "resources", "config", "TestCaseDiscovery3.json");
    const config = loadConfig(configPath);

    expect(config).not.toBeNull();
    expect(config?.files).toHaveLength(1);
    expect(config?.files[0].file).toBe("Data/content.json");
  });

  // TestCase4: 根目录没有 manifest.json，子目录也没有 manifest，忽略
  test("TestCase4: 没有 manifest.json 且子目录也没有，忽略", () => {
    const modPath = resolve(DEFAULT_DIR, "TestCaseDiscovery4");
    const modInfo = getModInfo(modPath, "TestCaseDiscovery4", ZH_DIR);

    expect(modInfo).toBeNull();
  });

  // TestCase5: 根目录没有 manifest，子目录有 manifest 和 i18n
  test("TestCase5: 根目录无 manifest，子目录有 manifest 和 i18n，列出所有 i18n", () => {
    const modPath = resolve(DEFAULT_DIR, "TestCaseDiscovery5");
    const modInfo = getModInfo(modPath, "TestCaseDiscovery5", ZH_DIR);

    expect(modInfo).not.toBeNull();
    expect(modInfo?.name).toBe("TestCaseDiscovery5");
    expect(modInfo?.uniqueId).toBe("SubMod1.1.0.0");
    expect(modInfo?.version).toBe("1.0.0");
    expect(modInfo?.i18nFiles.length).toBe(1);
    expect(modInfo?.i18nFiles[0].relativePath).toBe("SubMod1/i18n");
  });
});
