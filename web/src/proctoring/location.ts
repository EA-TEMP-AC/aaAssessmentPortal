/**
 * Where the candidate's browser is, for flag photos (X-07). Used only when the batch has location
 * capture on. The position is asked for once when a photo needs it, kept for `ttlMs` (60 seconds),
 * and never tracked: this module never calls watchPosition. A refusal, a timeout or a missing
 * browser feature all give null, and nothing else depends on it.
 */

export type PhotoLocation = { latitude: number; longitude: number; accuracy: number | null };

export type LocationProvider = { get: () => Promise<PhotoLocation | null> };

export const LOCATION_CACHE_MS = 60_000;
export const LOCATION_TIMEOUT_MS = 5_000;

type GeoLike = Pick<Geolocation, "getCurrentPosition">;

export type LocationOptions = {
  geolocation?: GeoLike | null;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
};

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function browserGeolocation(): GeoLike | null {
  return typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null;
}

export function createLocationProvider(options: LocationOptions = {}): LocationProvider {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? LOCATION_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? LOCATION_TIMEOUT_MS;

  let cached: { at: number; value: PhotoLocation | null } | null = null;
  let inFlight: Promise<PhotoLocation | null> | null = null;

  function ask(): Promise<PhotoLocation | null> {
    const geo = options.geolocation === undefined ? browserGeolocation() : options.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (value: PhotoLocation | null) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(value);
      };
      // Some browsers never call back when the prompt is ignored; do not hold the flag for it.
      timer = setTimeout(() => done(null), timeoutMs + 1000);
      try {
        geo.getCurrentPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return done(null);
            done({
              latitude: round(latitude, 6),
              longitude: round(longitude, 6),
              accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
            });
          },
          () => done(null),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: ttlMs },
        );
      } catch {
        done(null);
      }
    });
  }

  return {
    get() {
      if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.value);
      if (inFlight) return inFlight;
      inFlight = ask().then((value) => {
        // A refusal is remembered for the same time, so the browser is not asked again at once.
        cached = { at: now(), value };
        inFlight = null;
        return value;
      });
      return inFlight;
    },
  };
}
