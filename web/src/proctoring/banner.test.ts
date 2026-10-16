import { describe, expect, it, vi } from "vitest";
import {
  attemptShortCode,
  bannerFor,
  bannerLayout,
  bannerLines,
  drawBanner,
  formatIst,
  locationText,
  renderFlagPhoto,
  type BannerContext,
  type BannerInput,
  type PhotoCanvas,
  type PhotoContext,
} from "./banner";
import { flagReason } from "./flagText";

const AT = Date.UTC(2026, 10, 20, 5, 0, 5); // 20 Nov 2026, 10:30:05 IST

const input: BannerInput = {
  type: "face_not_present",
  reason: "Face not visible for 2 seconds",
  severity: "medium",
  at: AT,
  attemptCode: "A1B2C3",
  location: { latitude: 19.076123, longitude: 72.877456, accuracy: 12 },
};

function recorder(widthPerChar = 6) {
  const calls: { fillRect: number[][]; fillText: { text: string; x: number; y: number }[]; fills: string[] } = {
    fillRect: [],
    fillText: [],
    fills: [],
  };
  let fill = "";
  const ctx: BannerContext & { drawImage: PhotoContext["drawImage"] } = {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value) {
      fill = String(value);
      calls.fills.push(fill);
    },
    font: "",
    textBaseline: "alphabetic",
    fillRect: (x, y, w, h) => calls.fillRect.push([x, y, w, h]),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
    measureText: (text) => ({ width: text.length * widthPerChar }),
    drawImage: vi.fn(),
  };
  return { ctx, calls };
}

describe("banner text", () => {
  it("writes the date and time in IST", () => {
    expect(formatIst(AT)).toBe("20 Nov 2026, 10:30:05 IST");
  });

  it("shortens the attempt id to six upper-case characters", () => {
    expect(attemptShortCode("65a1b2c3d4e5f60718293a4b")).toBe("293A4B");
  });

  it("has the flag name, severity, reason, time, attempt code and location", () => {
    expect(bannerLines(input)).toEqual([
      "No face in view | Medium severity",
      "Face not visible for 2 seconds",
      "20 Nov 2026, 10:30:05 IST | Attempt A1B2C3",
      "Location: 19.076123, 72.877456 (accuracy 12 m)",
    ]);
  });

  it("says Location not shared when there is no location", () => {
    expect(bannerLines({ ...input, location: null }).at(-1)).toBe("Location not shared");
    expect(locationText(null)).toBe("Location not shared");
  });

  it("says when the accuracy is not known", () => {
    expect(locationText({ latitude: 1, longitude: 2, accuracy: null })).toBe(
      "Location: 1.000000, 2.000000 (accuracy not known)",
    );
  });

  it("builds the banner from the config: configured hold time and severity", () => {
    const banner = bannerFor(
      { type: "face_not_present", at: AT },
      { sustainedSeconds: { face_not_present: 1 }, flagSeverity: { face_not_present: "high" } },
      "att-123456",
      null,
    );
    expect(banner.reason).toBe("Face not visible for 1 second");
    expect(banner.severity).toBe("high");
    expect(banner.attemptCode).toBe("123456");
  });

  it("falls back to the built-in severity and hold time", () => {
    const banner = bannerFor({ type: "phone_detected", at: AT }, { sustainedSeconds: {} }, "abcdef", null);
    expect(banner.severity).toBe("high");
    expect(flagReason("tab_hidden")).toBe("The exam tab was hidden");
  });
});

describe("drawBanner", () => {
  it("fills a black strip at the given top edge and writes every line in white", () => {
    const { ctx, calls } = recorder();
    const lines = bannerLines(input);
    const layout = drawBanner(ctx, 480, 640, lines);
    expect(calls.fillRect).toEqual([[0, 480, 640, layout.height]]);
    expect(calls.fills).toEqual(["#000000", "#ffffff"]);
    expect(calls.fillText.map((t) => t.text)).toEqual(lines);
    // Lines go top to bottom inside the strip.
    const ys = calls.fillText.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(ys[0]).toBeGreaterThanOrEqual(480);
    expect(ys.at(-1)).toBeLessThan(480 + layout.height);
  });

  it("cuts a line that is too wide and marks it with dots", () => {
    const { ctx, calls } = recorder(20);
    drawBanner(ctx, 0, 320, ["x".repeat(100)]);
    const text = calls.fillText[0].text;
    expect(text.endsWith("...")).toBe(true);
    expect(text.length).toBeLessThan(100);
  });

  it("grows the font with the picture width but never below 11 px", () => {
    expect(bannerLayout(200, 4).fontPx).toBe(11);
    expect(bannerLayout(640, 4).fontPx).toBe(16);
  });
});

/** A canvas whose JPEG size depends on its pixels and the quality asked for. */
function fakeCanvasFactory(sizeOf: (w: number, h: number, quality: number) => number | null) {
  const made: (PhotoCanvas & { ctx: ReturnType<typeof recorder> })[] = [];
  const make = () => {
    const rec = recorder();
    const canvas: PhotoCanvas & { ctx: ReturnType<typeof recorder> } = {
      width: 0,
      height: 0,
      ctx: rec,
      getContext: () => rec.ctx,
      toBlob: (cb, type, quality) => {
        const size = sizeOf(canvas.width, canvas.height, quality);
        cb(size === null ? null : new Blob([new Uint8Array(size)], { type }));
      },
    };
    made.push(canvas);
    return canvas;
  };
  return { make, made };
}

describe("renderFlagPhoto", () => {
  const source = { image: {}, width: 640, height: 480 };

  it("puts the banner strip under the picture and returns a JPEG", async () => {
    const { make, made } = fakeCanvasFactory(() => 40_000);
    const blob = await renderFlagPhoto(make, source, input);
    expect(blob?.type).toBe("image/jpeg");
    const out = made.at(-1)!;
    expect(out.width).toBe(640);
    expect(out.height).toBe(480 + bannerLayout(640, 4).height);
    expect(out.ctx.calls.fillRect[0][1]).toBe(480);
    expect(out.ctx.calls.fillText.map((t) => t.text)).toEqual(bannerLines(input));
  });

  it("lowers the quality until the file is at most 150 KB", async () => {
    const asked: number[] = [];
    const { make } = fakeCanvasFactory((_w, _h, quality) => {
      asked.push(quality);
      return quality > 0.5 ? 200_000 : 120_000;
    });
    const blob = await renderFlagPhoto(make, source, input, 150 * 1024);
    expect(blob?.size).toBe(120_000);
    expect(asked[0]).toBe(0.7);
    expect(asked.at(-1)).toBeLessThanOrEqual(0.5);
  });

  it("scales the picture down when quality alone is not enough", async () => {
    const { make, made } = fakeCanvasFactory((w, h) => w * h * 0.5);
    const blob = await renderFlagPhoto(make, source, input, 150 * 1024);
    expect(blob).not.toBeNull();
    expect(blob!.size).toBeLessThanOrEqual(150 * 1024);
    expect(made.at(-1)!.width).toBeLessThan(640);
  });

  it("gives null when it cannot fit, so the flag is saved without a photo", async () => {
    const { make } = fakeCanvasFactory(() => 10_000_000);
    expect(await renderFlagPhoto(make, source, input, 150 * 1024)).toBeNull();
  });

  it("gives null when the browser has no canvas or no JPEG", async () => {
    const none = () => ({ width: 0, height: 0, getContext: () => null, toBlob: () => {} }) as PhotoCanvas;
    expect(await renderFlagPhoto(none, source, input)).toBeNull();
    const { make } = fakeCanvasFactory(() => null);
    expect(await renderFlagPhoto(make, source, input)).toBeNull();
  });

  it("copies the camera frame before it waits for the banner (the location)", async () => {
    const { make, made } = fakeCanvasFactory(() => 1000);
    let resolveBanner: (b: BannerInput) => void = () => {};
    const pending = new Promise<BannerInput>((resolve) => {
      resolveBanner = resolve;
    });
    const done = renderFlagPhoto(make, source, pending);
    expect(made).toHaveLength(1);
    expect(made[0].ctx.ctx.drawImage).toHaveBeenCalledTimes(1);
    resolveBanner(input);
    expect(await done).not.toBeNull();
  });
});
