import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_ALARM_DELIVERY_FILE = join(process.cwd(), "data", "alarm-delivery.json");

function validateDeliveryState(deliveryState) {
  if (!deliveryState || typeof deliveryState !== "object" || Array.isArray(deliveryState)) {
    throw new Error("Alarm delivery state must be a JSON object.");
  }

  return deliveryState;
}

export async function readAlarmDeliveryState(filePath = DEFAULT_ALARM_DELIVERY_FILE) {
  try {
    const raw = await readFile(filePath, "utf8");
    return validateDeliveryState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeAlarmDeliveryState(deliveryState, filePath = DEFAULT_ALARM_DELIVERY_FILE) {
  const safeDeliveryState = validateDeliveryState(deliveryState);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeDeliveryState, null, 2)}\n`, "utf8");
  return safeDeliveryState;
}
