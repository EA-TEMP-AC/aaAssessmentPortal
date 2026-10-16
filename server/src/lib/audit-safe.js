const EXACT_KEYS = ["latitude", "longitude", "lat", "lng", "deviceId"];

/**
 * Audit rows never carry an exact position or a device id. The API response keeps them;
 * the audit row says only whether a position was captured.
 */
export function withoutExactLocation(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const key of EXACT_KEYS) delete out[key];
  if (out.device && typeof out.device === "object") {
    out.device = { ...out.device };
    delete out.device.deviceId;
  }
  return out;
}
