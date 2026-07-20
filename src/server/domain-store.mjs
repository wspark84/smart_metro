import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_DOMAIN_FILE = join(process.cwd(), "data", "domain-store.json");

function validateDomainSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Domain snapshot must be a JSON object.");
  }

  return snapshot;
}

export async function readDomainSnapshot(filePath = DEFAULT_DOMAIN_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateDomainSnapshot(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeDomainSnapshot(snapshot, filePath = DEFAULT_DOMAIN_FILE) {
  const safeSnapshot = validateDomainSnapshot(snapshot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeSnapshot, null, 2)}\n`, "utf8");
  return safeSnapshot;
}
