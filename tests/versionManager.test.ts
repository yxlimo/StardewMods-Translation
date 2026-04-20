import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import {
  compareVersions,
  needsTranslation,
  getModVersion,
  readManifest,
} from "../src/versionManager";

const TEST_RESOURCES = resolve("tests", "resources", "mods");
const TEST_DEFAULT = resolve(TEST_RESOURCES, "default");
const TEST_ZH = resolve(TEST_RESOURCES, "zh");

describe("versionManager", () => {
  describe("compareVersions", () => {
    test("1.2.0 > 1.1.0", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
    });

    test("1.1.0 < 1.2.0", () => {
      expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    });

    test("1.1.0 == 1.1.0", () => {
      expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    });

    test("1.10.0 > 1.9.0", () => {
      expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    });

    test("2.0.0 > 1.999.999", () => {
      expect(compareVersions("2.0.0", "1.999.999")).toBeGreaterThan(0);
    });
  });

  describe("needsTranslation", () => {
    test("returns true when zhVersion is null", () => {
      expect(needsTranslation("1.2.0", null)).toBe(true);
    });

    test("returns true when default > zh", () => {
      expect(needsTranslation("1.2.0", "1.1.0")).toBe(true);
    });

    test("returns false when default == zh", () => {
      expect(needsTranslation("1.2.0", "1.2.0")).toBe(false);
    });

    test("returns false when default < zh", () => {
      expect(needsTranslation("1.1.0", "1.2.0")).toBe(false);
    });
  });

  describe("getModVersion", () => {
    test("gets version from default manifest", () => {
      const version = getModVersion("TestMod", false, TEST_DEFAULT, TEST_ZH);
      expect(version).toBe("1.2.0");
    });

    test("gets version from zh manifest", () => {
      const version = getModVersion("TestMod", true, TEST_DEFAULT, TEST_ZH);
      expect(version).toBe("1.1.0");
    });

    test("returns null for non-existent mod", () => {
      const version = getModVersion("NonExistentMod", false, TEST_DEFAULT, TEST_ZH);
      expect(version).toBeNull();
    });
  });

  describe("readManifest", () => {
    test("reads manifest from path", () => {
      const manifest = readManifest(resolve(TEST_DEFAULT, "TestMod"));
      expect(manifest).not.toBeNull();
      expect(manifest?.Name).toBe("TestMod");
      expect(manifest?.Version).toBe("1.2.0");
      expect(manifest?.UniqueID).toBe("TestMod.1.2.0");
    });

    test("returns null for non-existent path", () => {
      const manifest = readManifest("/tmp/non-existent");
      expect(manifest).toBeNull();
    });
  });
});
