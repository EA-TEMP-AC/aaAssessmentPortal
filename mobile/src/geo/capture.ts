import type { GpsCapture, GpsUnavailableReason } from "../queue/types";

export type LocationFix = {
  timestamp: number;
  coords: { latitude: number; longitude: number };
};

export type LocationClient = {
  Accuracy: { High: number };
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (options?: { accuracy?: number }) => Promise<LocationFix>;
};

function unavailable(reason: GpsUnavailableReason, detail?: string): GpsCapture {
  return detail ? { status: "unavailable", reason, detail } : { status: "unavailable", reason };
}

/**
 * NCVET:TR s9, s26 — login/logout geo. Permission denial and a missing fix are recorded.
 * Coordinates are taken only from the location API.
 */
export function createGpsCapture(location: LocationClient): () => Promise<GpsCapture> {
  return async () => {
    const permission = await location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return unavailable("permission_denied");
    }
    try {
      const position = await location.getCurrentPositionAsync({
        accuracy: location.Accuracy.High,
      });
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return unavailable("position_unavailable", "non-finite coordinates");
      }
      return {
        status: "captured",
        lat,
        lng,
        capturedAt: new Date(position.timestamp).toISOString(),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Location request failed";
      const reason: GpsUnavailableReason = /timeout/i.test(detail) ? "timeout" : "position_unavailable";
      return unavailable(reason, detail);
    }
  };
}
