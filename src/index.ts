import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import archiver from "archiver";
import { loadConfig } from "./config";
import { translateI18nFile, setVerbose } from "./translator";
import { readJsonFile } from "./fileHandler";
import { discoverMods, generateDefaultConfig } from "./modDiscovery";
import { needsTranslation, getModVersion, updateZhManifestVersion, ensureZhManifest, compareVersions } from "./versionManager";
import type { TranslationResult } from "./types";

const DEFAULT_ORIGIN_DIR = path.resolve("mods", "default");
const DEFAULT_ZH_DIR = path.resolve("mods", "zh");

/**
 * 获取 origin 目录路径
 * 优先级: CLI选项 > 环境变量 > 默认值
 */
function getOriginDir(options: { originDir?: string }): string {
  return options.originDir ||
    process.env.STARDEWMOD_TRANSLATION_ORIGIN_DIR ||
    DEFAULT_ORIGIN_DIR;
}

/**
 * 获取 zh 目录路径
 * 优先级: CLI选项 > 环境变量 > 默认值
 */
function getZhDir(options: { zhDir?: string }): string {
  return options.zhDir ||
    process.env.STARDEWMOD_TRANSLATION_ZH_DIR ||
    DEFAULT_ZH_DIR;
}

/**
 * Translate command - translate mod files
 */
async function translate(
  modName: string | undefined,
  options: {
    config?: string;
    verbose?: boolean;
    originDir?: string;
    zhDir?: string;
  }
): Promise<void> {
  if (options.verbose) {
    setVerbose(true);
  }

  if (!modName) {
    console.error("Error: <mod-name> is required");
    return;
  }

  const originDir = getOriginDir(options);
  const zhDir = getZhDir(options);

  // 尝试加载 config
  const configPath = options.config || path.resolve("mods", "config", `${modName}.json`);
  let config;

  if (fs.existsSync(configPath)) {
    console.log(`Loading config: ${configPath}`);
    config = loadConfig(configPath);
  } else {
    // 无 config 时，自动发现 i18n 目录
    console.log(`No config found, using auto-discovery for: ${modName}`);
    const mods = discoverMods(originDir, zhDir);
    const modInfo = mods.find((m) => m.name === modName);

    if (!modInfo) {
      console.error(`Error: Mod '${modName}' not found`);
      return;
    }

    if (modInfo.i18nFiles.length === 0) {
      console.error(`Error: Mod '${modName}' has no i18n directory`);
      return;
    }

    config = generateDefaultConfig(modInfo);
    console.log(`Auto-discovered i18n translation for: ${modName}`);
  }

  console.log(`Processing mod: ${modName}`);

  // 版本检查
  const defaultVersion = getModVersion(modName, false, originDir, zhDir);
  const zhVersion = getModVersion(modName, true, originDir, zhDir);

  if (defaultVersion && !needsTranslation(defaultVersion, zhVersion)) {
    console.log(`Skipping ${modName}: no version change (default: ${defaultVersion}, zh: ${zhVersion})`);
    return;
  }

  if (defaultVersion) {
    console.log(`Version change detected: default ${defaultVersion} vs zh ${zhVersion || "none"}`);
  }

  console.log(`Files to translate: ${config.files.length}`);
  console.log("");

  // 确保 zh manifest 存在
  ensureZhManifest(modName, originDir, zhDir);

  const results: TranslationResult[] = [];

  for (const entry of config.files) {
    const originPath = path.resolve(originDir, modName, entry.file);
    const targetPath = path.resolve(zhDir, modName, entry.target);

    const result: TranslationResult = {
      success: false,
      file: entry.file,
      target: entry.target,
      translatedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      await translateI18nFile(originPath, targetPath, result);
      result.success = true;
    } catch (e) {
      result.errors = [String(e)];
      console.error(`Error translating ${entry.file}: ${e}`);
    }

    results.push(result);

    const status = result.success ? "✓" : "✗";
    console.log(
      `${status} ${result.file}: ${result.translatedCount} translated, ${result.skippedCount} skipped`
    );

    if (result.errors && result.errors.length > 0) {
      for (const error of result.errors) {
        console.log(`  Error: ${error}`);
      }
    }
  }

  // 更新 zh manifest 版本
  if (defaultVersion) {
    updateZhManifestVersion(modName, defaultVersion, zhDir);
  }

  console.log("");
  console.log("Summary:");
  const totalTranslated = results.reduce((sum, r) => sum + r.translatedCount, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skippedCount, 0);
  const totalErrors = results.reduce(
    (sum, r) => sum + (r.errors?.length || 0),
    0
  );
  console.log(`  Total translated: ${totalTranslated}`);
  console.log(`  Total skipped: ${totalSkipped}`);
  console.log(`  Total errors: ${totalErrors}`);
}

/**
 * List command - show all discoverable mods
 */
function listMods(options: { originDir?: string; zhDir?: string }): void {
  const originDir = getOriginDir(options);
  const zhDir = getZhDir(options);
  const mods = discoverMods(originDir, zhDir);

  console.log("Discoverable mods:\n");

  for (const mod of mods) {
    const zhVersion = getModVersion(mod.name, true, originDir, zhDir);
    const needsUpdate = !zhVersion || compareVersions(mod.version, zhVersion) > 0;

    console.log(`  ${mod.name}`);
    console.log(`    Version: ${mod.version}`);
    console.log(`    UniqueID: ${mod.uniqueId}`);
    console.log(`    i18n files (${mod.i18nFiles.length}):`);
    for (const i18n of mod.i18nFiles) {
      console.log(`      - ${i18n.relativePath}/default.json`);
    }
    console.log(`    zh version: ${zhVersion || "none"}`);
    console.log(`    Needs translation: ${needsUpdate ? "yes" : "no (up to date)"}`);
    console.log("");
  }
}

/**
 * Check command - list all keys that would be translated
 */
function check(
  modName: string | undefined,
  options: {
    config?: string;
    originDir?: string;
    zhDir?: string;
  }
): void {
  const originDir = getOriginDir(options);
  const zhDir = getZhDir(options);

  if (!modName) {
    console.error("Error: <mod-name> is required");
    return;
  }

  const configPath = options.config || path.resolve("mods", "config", `${modName}.json`);
  let config;

  if (fs.existsSync(configPath)) {
    console.log(`Loading config: ${configPath}\n`);
    config = loadConfig(configPath);
  } else {
    console.log(`No config found, using auto-discovery for: ${modName}`);
    const mods = discoverMods(originDir, zhDir);
    const modInfo = mods.find((m) => m.name === modName);

    if (!modInfo) {
      console.error(`Error: Mod '${modName}' not found`);
      return;
    }

    if (modInfo.i18nFiles.length === 0) {
      console.error(`Error: Mod '${modName}' has no i18n directory`);
      return;
    }

    config = generateDefaultConfig(modInfo);
    console.log(`Auto-discovered i18n check for: ${modName}\n`);
  }

  let totalKeys = 0;

  for (const entry of config.files) {
    if (!entry.translateKeys || entry.translateKeys.length === 0) {
      continue;
    }

    const fileType = entry.file;
    const originPath = path.resolve(originDir, modName, entry.file);

    if (!entry.file.endsWith(".json")) {
      console.log(`[${entry.file}]`);
      console.log(`  (TMX files not supported for check)\n`);
      continue;
    }

    const originData = readJsonFile(originPath);

    if (!originData) {
      console.log(`[${entry.file}]`);
      console.log(`  Warning: Cannot read origin file: ${originPath}\n`);
      continue;
    }

    console.log(`[${entry.file}]`);

    for (const keyPattern of entry.translateKeys) {
      if (_.has(originData, keyPattern)) {
        const value = _.get(originData, keyPattern);
        const displayValue = typeof value === "string" && value.length > 50
          ? value.slice(0, 50) + "..."
          : value;
        console.log(`  ${keyPattern}`);
        console.log(`    = ${displayValue}`);
        totalKeys++;
      } else {
        console.log(`  ${keyPattern} (no matches)`);
      }
    }
    console.log("");
  }

  console.log(`Total keys: ${totalKeys}`);
}

/**
 * Pack command - create zip archive of translated mod files
 */
async function pack(modName: string | undefined, options: { zhDir?: string }): Promise<void> {
  const zhDir = getZhDir(options);

  if (!modName) {
    console.error("Error: <mod-name> is required");
    return;
  }

  const zhSource = path.resolve(zhDir, modName);

  if (!fs.existsSync(zhSource)) {
    console.error(`Error: Source directory '${zhSource}' not found`);
    return;
  }

  const distDir = path.resolve("mods", "release");
  const outputZip = path.resolve(distDir, `${modName}.zip`);

  fs.mkdirSync(distDir, { recursive: true });

  console.log(`Packing ${modName}...`);

  const output = fs.createWriteStream(outputZip);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.pipe(output);

  function addDirToArchive(dirPath: string, arcPath: string): void {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (entry === "README.md" || entry === "manifest.json") continue;

      const fullPath = path.join(dirPath, entry);
      const entryArcPath = arcPath ? `${arcPath}/${entry}` : entry;
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        addDirToArchive(fullPath, entryArcPath);
      } else {
        archive.file(fullPath, { name: entryArcPath });
      }
    }
  }

  addDirToArchive(zhSource, "");

  await archive.finalize();
  console.log(`Created: ${outputZip}`);
}

/**
 * CLI 入口
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name("translator")
    .description("Auto translate Stardew Valley mods based on config files");

  program
    .command("translate [mod-name]")
    .description("Translate mod files (auto-discovers i18n if no config)")
    .option("-c, --config <path>", "Specify config file path")
    .option("--origin-dir <path>", "Specify origin (default) directory")
    .option("--zh-dir <path>", "Specify zh translation directory")
    .option("-v, --verbose", "Enable verbose logging")
    .action(translate);

  program
    .command("list")
    .description("List all discoverable mods")
    .option("--origin-dir <path>", "Specify origin (default) directory")
    .option("--zh-dir <path>", "Specify zh translation directory")
    .action(listMods);

  program
    .command("check [mod-name]")
    .description("List all keys that would be translated")
    .option("-c, --config <path>", "Specify config file path")
    .option("--origin-dir <path>", "Specify origin (default) directory")
    .option("--zh-dir <path>", "Specify zh translation directory")
    .action(check);

  program
    .command("pack <mod-name>")
    .description("Pack translated mod files into zip archive (ignores manifest.json)")
    .option("--zh-dir <path>", "Specify zh translation directory")
    .action(pack);

  if (process.argv.length <= 2) {
    program.parse(["node", "translator", ...process.argv.slice(2)]);
  } else {
    program.parse(process.argv);
  }
}

main().catch(console.error);
