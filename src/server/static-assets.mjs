import { extname, join, normalize, relative, resolve } from "node:path";

const PUBLIC_ENTRY_FILE = "index.html";
const PUBLIC_ROOT_FILES = new Set([PUBLIC_ENTRY_FILE, "sw.js"]);
const PUBLIC_SOURCE_PREFIX = "src/";
const PUBLIC_SOURCE_EXTENSIONS = new Set([".css", ".js"]);

function normalizeRequestPath(pathname) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(String(pathname || ""));
  } catch {
    return null;
  }

  const normalized = normalize(decoded).replace(/^[\\/]+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes(".." + "\\") || normalized.includes("../")) {
    return null;
  }

  return normalized.replaceAll("\\", "/");
}

export function resolvePublicStaticFile(rootDirectory, pathname) {
  const requestPath = normalizeRequestPath(pathname);
  if (!requestPath) {
    return null;
  }

  const isEntryFile = PUBLIC_ROOT_FILES.has(requestPath);
  const isPublicSourceFile =
    requestPath.startsWith(PUBLIC_SOURCE_PREFIX) &&
    !requestPath.startsWith("src/server/") &&
    PUBLIC_SOURCE_EXTENSIONS.has(extname(requestPath));

  if (!isEntryFile && !isPublicSourceFile) {
    return null;
  }

  const root = resolve(rootDirectory);
  const filePath = resolve(join(root, requestPath));
  const relativePath = relative(root, filePath);
  if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(".." + "\\")) {
    return null;
  }

  return filePath;
}

export function isAssetPath(pathname) {
  return Boolean(extname(String(pathname || "")));
}
