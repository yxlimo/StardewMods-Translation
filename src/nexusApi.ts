import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://api.nexusmods.com/v3";
const NEXUS_CACHE_FILE = ".nexus.json";

export interface NexusCacheEntry {
  nexusId: string;
  modInternalId?: string;
  updateGroupId?: string;
}

export interface NexusCache {
  [modName: string]: NexusCacheEntry;
}

export interface NexusModResponse {
  data: {
    id: string;
    game_scoped_id: string;
    game_id: string;
    name: string | null;
  };
}

export interface NexusFileUpdateGroupsResponse {
  data: {
    groups: Array<{
      id: string;
      name: string;
      is_active: boolean;
      last_file_uploaded_at: string;
      versions_count: number;
      archived_count: number;
      removed_count: number;
    }>;
  };
}

export interface NexusFileUpdateGroupVersionsResponse {
  data: {
    versions: Array<{
      id: string;
      position: string;
      file: {
        id: string;
        game_scoped_id: string;
        name: string;
        version: string;
        category: string;
        uploaded_at: string;
      };
    }>;
  };
}

function getApiKey(): string | undefined {
  return process.env.STARDEW_TRANSLATION_NEXUSMODS_API_KEY;
}

function readCache(): NexusCache {
  if (!fs.existsSync(NEXUS_CACHE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(NEXUS_CACHE_FILE, "utf-8")) as NexusCache;
  } catch {
    return {};
  }
}

function writeCache(cache: NexusCache): void {
  fs.writeFileSync(NEXUS_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

export function getNexusCacheEntry(modName: string): NexusCacheEntry | undefined {
  const cache = readCache();
  return cache[modName];
}

export function setNexusCacheEntry(modName: string, entry: NexusCacheEntry): void {
  const cache = readCache();
  cache[modName] = entry;
  writeCache(cache);
}

async function nexusFetch<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`NexusMods API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function getModInternalId(
  gameDomain: string,
  nexusId: string,
  apiKey: string
): Promise<string> {
  const url = `${API_BASE}/games/${gameDomain}/mods/${nexusId}`;
  const data = await nexusFetch<NexusModResponse>(url, apiKey);
  return data.data.id;
}

export async function getUpdateGroupId(
  modInternalId: string,
  apiKey: string
): Promise<string> {
  const url = `${API_BASE}/mods/${modInternalId}/file-update-groups`;
  const data = await nexusFetch<NexusFileUpdateGroupsResponse>(url, apiKey);

  if (!data.data.groups || data.data.groups.length === 0) {
    throw new Error("No file update groups found");
  }

  // Prefer active group with most recent upload
  const activeGroups = data.data.groups.filter((g) => g.is_active);
  const targetGroup = activeGroups.length > 0 ? activeGroups[0] : data.data.groups[0];
  return targetGroup.id;
}

export async function getLatestVersion(
  updateGroupId: string,
  apiKey: string
): Promise<string> {
  const url = `${API_BASE}/file-update-groups/${updateGroupId}/versions`;
  const data = await nexusFetch<NexusFileUpdateGroupVersionsResponse>(url, apiKey);

  if (!data.data.versions || data.data.versions.length === 0) {
    throw new Error("No versions found");
  }

  // Find version with highest position
  const sorted = [...data.data.versions].sort(
    (a, b) => parseFloat(b.position) - parseFloat(a.position)
  );

  return sorted[0].file.version;
}

export function parseNexusId(updateKeys: string[] | undefined): string | null {
  if (!updateKeys) return null;
  for (const key of updateKeys) {
    const match = key.match(/^Nexus:(\d+)$/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}
