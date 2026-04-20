import { resolve } from "node:path";

export const TEST_MODS_DIR = resolve("tests", "resources", "mods");
export const DEFAULT_DIR = resolve(TEST_MODS_DIR, "default");
export const ZH_DIR = resolve(TEST_MODS_DIR, "zh");
export const TEST_MOD = "TestMod";