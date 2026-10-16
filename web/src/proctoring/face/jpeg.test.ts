import { describe, expect, it, vi } from "vitest";
import { faceConfig } from "./config";
import { evidenceJpegs, scaledSize } from "./jpeg";

describe("scaledSize", () => {
  it("keeps small images as they are", () => {
    expect(scaledSize(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });

  it("shrinks wide images to the max width, keeping the shape", () => {
    expect(scaledSize(1920, 1080, 1024)).toEqual({ width: 1024, height: 576 });
  });
});

describe("evidenceJpegs", () => {
  it("encodes both images as JPEG at the configured quality and size, uploading nothing", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, cb, type) {
        cb(new Blob(["x".repeat(this.width)], { type }));
      });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const idCard = { width: 2048, height: 1536 } as ImageBitmap;
    const selfie = document.createElement("canvas");
    selfie.width = 640;
    selfie.height = 480;
    const out = await evidenceJpegs({ idCard, selfie }, faceConfig());

    expect(out.idCard.type).toBe("image/jpeg");
    expect(out.idCard.size).toBe(1024);
    expect(out.selfie.size).toBe(640);
    expect(drawImage).toHaveBeenCalledWith(idCard, 0, 0, 1024, 768);
    expect(toBlob.mock.calls.every((c) => c[1] === "image/jpeg" && c[2] === 0.8)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when the image is empty", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    const empty = { width: 0, height: 0 } as ImageBitmap;
    await expect(evidenceJpegs({ idCard: empty, selfie: empty }, faceConfig())).rejects.toThrow();
  });
});
