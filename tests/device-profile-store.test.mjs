import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDeviceProfile, writeDeviceProfile } from "../src/server/device-profile-store.mjs";

test("readDeviceProfile returns null when no profile file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-device-"));
  const filePath = join(root, "device-profile.json");

  try {
    const value = await readDeviceProfile(filePath);
    assert.equal(value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeDeviceProfile persists a sanitized device profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "buswakeup-device-"));
  const filePath = join(root, "nested", "device-profile.json");

  try {
    const saved = await writeDeviceProfile(
      {
        deviceName: "Office Android",
        platform: "android",
        pushEnabled: true,
        pushToken: "abc-token",
      },
      filePath,
    );
    const loaded = await readDeviceProfile(filePath);

    assert.equal(saved.deviceName, "Office Android");
    assert.equal(loaded.pushToken, "abc-token");
    assert.equal(loaded.localBackupEnabled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
