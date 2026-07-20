import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sanitizeDeviceProfile } from "../device-profile.js";

export const DEFAULT_DEVICE_PROFILE_FILE = join(process.cwd(), "data", "device-profile.json");

export async function readDeviceProfile(filePath = DEFAULT_DEVICE_PROFILE_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return sanitizeDeviceProfile(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeDeviceProfile(profile, filePath = DEFAULT_DEVICE_PROFILE_FILE) {
  const safeProfile = sanitizeDeviceProfile(profile);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeProfile, null, 2)}\n`, "utf8");
  return safeProfile;
}
