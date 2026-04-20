import { resolve, join } from "node:path";
import { existsSync, mkdirSync, createWriteStream, readdirSync, statSync, rmSync, renameSync } from "node:fs";
import { Command } from "commander";
import archiver from "archiver";
import { loadConfig } from "./config";
import { translateAllToStaging, setVerbose } from "./translator";
import { getFileOperator } from "./fileOperator";
import { readJsonFile } from "./fileHandler";
import type { TranslationResult } from "./types";

const CONFIG_DIR = resolve("mods", "config");
const DEFAULT_ORIGIN_DIR = resolve("mods", "default");
const DEFAULT_ZH_DIR = resolve("mods", "zh");
const TMP_DIR = ".tmp";
const STAGING_DIR = resolve(TMP_DIR, "staging");

/**
 * Translate command - translate mod files
 * All files are translated to staging first, then moved to zh/ on success.
 * If any file fails, no target files are modified.
 */
async function translate(modName: string | undefined, options: { config?: string; verbose?: boolean }): Promise<void> {
  // Set verbose mode
  if (options.verbose) {
    setVerbose(true);
  }

  let configPath: string;

  if (options.config) {
    configPath = resolve(options.config);
  } else if (modName) {
    configPath = resolve(CONFIG_DIR, `${modName}.json`);
  } else {
    console.error("Error: either <mod-name> or -c <config-path> is required");
    return;
  }

  console.log(`Loading config: ${configPath}`);

  const config = loadConfig(configPath);
  console.log(`Processing mod: ${config.baseDir}`);
  console.log(`Files to translate: ${config.files.length}`);
  console.log("");

  // Create staging directory
  mkdirSync(STAGING_DIR, { recursive: true });

  try {
    // 一次性翻译所有文件到 staging（调用一次 LLM）
    const results = await translateAllToStaging(config.baseDir, config.files, STAGING_DIR);

    for (const result of results) {
      const status = result.success ? "✓" : "✗";
      console.log(
        `${status} ${result.file}: ${result.translatedCount} translated, ${result.skippedCount} skipped`
      );

      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          console.log(`  Error: ${error}`);
        }
      }

      // If any file fails, terminate without modifying target files
      if (!result.success) {
        console.log("\nTranslation failed, cleaning up staging directory...");
        rmSync(TMP_DIR, { recursive: true, force: true });
        throw new Error(`Translation failed for ${result.file}`);
      }
    }

    // All files translated successfully, move staging to zh/
    const zhDir = resolve(DEFAULT_ZH_DIR, config.baseDir);
    const stagingModDir = resolve(STAGING_DIR, config.baseDir);

    if (existsSync(zhDir)) {
      rmSync(zhDir, { recursive: true, force: true });
    }
    renameSync(stagingModDir, zhDir);

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
  } finally {
    // Always clean up staging directory
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  }
}

/**
 * Check command - list all keys that would be translated
 */
function check(modName: string | undefined, options: { config?: string }): void {
  let configPath: string;

  if (options.config) {
    configPath = resolve(options.config);
  } else if (modName) {
    configPath = resolve(CONFIG_DIR, `${modName}.json`);
  } else {
    console.error("Error: either <mod-name> or -c <config-path> is required");
    return;
  }

  console.log(`Loading config: ${configPath}\n`);

  const config = loadConfig(configPath);
  const baseOriginDir = DEFAULT_ORIGIN_DIR;

  let totalKeys = 0;

  for (const entry of config.files) {
    if (!entry.translateKeys || entry.translateKeys.length === 0) {
      continue;
    }

    const fileType = config.files[0] ? entry.file : entry.file;
    const originPath = resolve(baseOriginDir, config.baseDir, entry.file);

    // Skip non-JSON files for now
    if (!entry.file.endsWith(".json")) {
      console.log(`[${entry.file}]`);
      console.log(`  (TMX files not supported for check)\n`);
      continue;
    }

    const operator = getFileOperator("json");
    const originData = readJsonFile(originPath);

    if (!originData) {
      console.log(`[${entry.file}]`);
      console.log(`  Warning: Cannot read origin file: ${originPath}\n`);
      continue;
    }

    console.log(`[${entry.file}]`);

    for (const keyPattern of entry.translateKeys) {
      const results = operator.query(originData, keyPattern);
      totalKeys += results.length;

      for (const { path, value } of results) {
        const displayValue = typeof value === "string" && value.length > 50
          ? value.slice(0, 50) + "..."
          : value;
        console.log(`  ${path}`);
        console.log(`    = ${displayValue}`);
      }

      if (results.length === 0) {
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
async function pack(modName: string | undefined): Promise<void> {
  if (!modName) {
    console.error("Error: <mod-name> is required");
    return;
  }

  const configPath = resolve(CONFIG_DIR, `${modName}.json`);
  if (!existsSync(configPath)) {
    console.error(`Error: Config file '${configPath}' not found`);
    return;
  }

  const config = loadConfig(configPath);
  const zhSource = resolve("mods", "zh", config.baseDir);
  const distDir = resolve("mods", "release");
  const outputZip = resolve(distDir, `${modName}.zip`);

  if (!existsSync(zhSource)) {
    console.error(`Error: Source directory '${zhSource}' not found`);
    return;
  }

  mkdirSync(distDir, { recursive: true });

  console.log(`Packing ${modName}...`);

  // 使用 archiver 创建 zip
  const output = createWriteStream(outputZip);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.pipe(output);

  // 递归添加目录，排除 README.md
  function addDirToArchive(dirPath: string, arcPath: string): void {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (entry === "README.md") continue;

      const fullPath = join(dirPath, entry);
      const entryArcPath = arcPath ? `${arcPath}/${entry}` : entry;
      const stat = statSync(fullPath);

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
    .description("Translate mod files")
    .option("-c, --config <path>", "Specify config file path")
    .option("-v, --verbose", "Enable verbose logging")
    .action(translate);

  program
    .command("check [mod-name]")
    .description("List all keys that would be translated")
    .option("-c, --config <path>", "Specify config file path")
    .action(check);

  program
    .command("pack <mod-name>")
    .description("Pack translated mod files into zip archive")
    .action(pack);

  // Default command if no subcommand provided
  if (process.argv.length <= 2) {
    program.parse(["node", "translator", ...process.argv.slice(2)]);
  } else {
    program.parse(process.argv);
  }
}

main().catch(console.error);
