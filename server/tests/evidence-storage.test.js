import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createLocalStorage } from "../src/modules/evidence/storage/local.driver.js";
import {
  createS3Storage,
  createS3StorageFromConfig,
} from "../src/modules/evidence/storage/s3.driver.js";
import {
  StorageKeyExistsError,
  StorageNotFoundError,
} from "../src/modules/evidence/storage/storage-errors.js";
import { evidenceStorageConfigProblem } from "../src/modules/evidence/storage/storage.js";
import { sniffContentType } from "../src/modules/evidence/file-type.js";

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("S3 driver (mocked client)", () => {
  function setup(sendImpl) {
    const send = vi.fn(sendImpl ?? (async () => ({})));
    const presign = vi.fn(
      async () => "https://bucket.example.in/evidence/k.jpg?X-Amz-Signature=abc",
    );
    const storage = createS3Storage({ bucket: "aa-evidence", client: { send }, presign });
    return { storage, send, presign };
  }

  it("puts an object with bucket, key, length and type", async () => {
    const { storage, send } = setup();
    const body = Readable.from([Buffer.from("abc")]);
    const result = await storage.put({
      key: "evidence/k.jpg",
      body,
      size: 3,
      contentType: "image/jpeg",
    });
    expect(result).toEqual({ key: "evidence/k.jpg" });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "aa-evidence",
      Key: "evidence/k.jpg",
      ContentLength: 3,
      ContentType: "image/jpeg",
    });
    expect(command.input.Body).toBe(body);
  });

  it("gets an object as a stream", async () => {
    const { storage, send } = setup(async () => ({
      Body: Readable.from([Buffer.from("hello")]),
      ContentLength: 5,
    }));
    const out = await storage.get("evidence/k.jpg");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "aa-evidence",
      Key: "evidence/k.jpg",
    });
    expect(out.size).toBe(5);
    expect((await read(out.stream)).toString()).toBe("hello");
  });

  it("maps a missing key to StorageNotFoundError and passes other errors on", async () => {
    const missing = setup(async () => {
      throw Object.assign(new Error("nope"), { name: "NoSuchKey" });
    });
    await expect(missing.storage.get("evidence/k.jpg")).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    const broken = setup(async () => {
      throw Object.assign(new Error("boom"), {
        name: "InternalError",
        $metadata: { httpStatusCode: 500 },
      });
    });
    await expect(broken.storage.get("evidence/k.jpg")).rejects.toThrow("boom");
  });

  it("asks the presigner for a short-lived download link", async () => {
    const { storage, presign } = setup();
    const url = await storage.signedUrl("evidence/k.jpg", {
      expiresInSeconds: 90,
      contentType: "image/jpeg",
      filename: "evidence-1.jpg",
    });
    expect(url).toContain("X-Amz-Signature");
    const [, command, options] = presign.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "aa-evidence",
      Key: "evidence/k.jpg",
      ResponseContentType: "image/jpeg",
      ResponseContentDisposition: 'attachment; filename="evidence-1.jpg"',
    });
    expect(options).toEqual({ expiresIn: 90 });
  });

  it("has no delete or update", () => {
    const { storage } = setup();
    expect(Object.keys(storage).sort()).toEqual(["get", "name", "put", "signedUrl"]);
  });

  it("builds a client from settings: endpoint, region, path style and credentials", async () => {
    const storage = createS3StorageFromConfig({
      EVIDENCE_S3_BUCKET: "b",
      EVIDENCE_S3_REGION: "ap-south-1",
      EVIDENCE_S3_ENDPOINT: "https://s3.example.in",
      EVIDENCE_S3_FORCE_PATH_STYLE: true,
      EVIDENCE_S3_ACCESS_KEY_ID: "AKIDTEST",
      EVIDENCE_S3_SECRET_ACCESS_KEY: "secret-test",
    });
    expect(storage.name).toBe("s3");
    const url = await storage.signedUrl("evidence/k.jpg", { expiresInSeconds: 60 });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://s3.example.in");
    expect(parsed.pathname).toBe("/b/evidence/k.jpg");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(parsed.searchParams.get("X-Amz-Credential")).toContain("AKIDTEST/");
    expect(parsed.searchParams.get("X-Amz-Credential")).toContain("/ap-south-1/s3/");
    expect(url).not.toContain("secret-test");
  });
});

describe("local driver", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "aa-local-driver-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips bytes and never overwrites a key", async () => {
    const storage = createLocalStorage({ dir });
    await storage.put({ key: "evidence/a1.jpg", body: Readable.from([Buffer.from("one")]) });
    const out = await storage.get("evidence/a1.jpg");
    expect(out.size).toBe(3);
    expect((await read(out.stream)).toString()).toBe("one");
    await expect(
      storage.put({ key: "evidence/a1.jpg", body: Readable.from([Buffer.from("two")]) }),
    ).rejects.toBeInstanceOf(StorageKeyExistsError);
    expect((await read((await storage.get("evidence/a1.jpg")).stream)).toString()).toBe("one");
  });

  it("reports a missing key, has no url and refuses keys that escape the folder", async () => {
    const storage = createLocalStorage({ dir });
    await expect(storage.get("evidence/none.jpg")).rejects.toBeInstanceOf(StorageNotFoundError);
    expect(await storage.signedUrl("evidence/a1.jpg")).toBeNull();
    for (const key of [
      "../x",
      "evidence/../../x",
      "/etc/passwd",
      "evidence//x",
      "C:\\x",
      "evidence/A.JPG",
    ]) {
      await expect(storage.get(key)).rejects.toThrow("Invalid storage key");
    }
    expect(Object.keys(storage).sort()).toEqual(["get", "name", "put", "signedUrl"]);
  });
});

describe("storage configuration", () => {
  it("defaults to local outside production and demands a real driver in production", () => {
    expect(evidenceStorageConfigProblem("development", {})).toBeNull();
    expect(evidenceStorageConfigProblem("production", {})).toMatch(/must be set/);
    expect(
      evidenceStorageConfigProblem("production", { EVIDENCE_STORAGE_DRIVER: "local" }),
    ).toMatch(/not allowed/);
  });

  it("needs a bucket and region for s3, and credentials in pairs", () => {
    expect(evidenceStorageConfigProblem("production", { EVIDENCE_STORAGE_DRIVER: "s3" })).toMatch(
      /EVIDENCE_S3_BUCKET/,
    );
    const base = {
      EVIDENCE_STORAGE_DRIVER: "s3",
      EVIDENCE_S3_BUCKET: "b",
      EVIDENCE_S3_REGION: "r",
    };
    expect(evidenceStorageConfigProblem("production", base)).toBeNull();
    expect(
      evidenceStorageConfigProblem("production", { ...base, EVIDENCE_S3_ACCESS_KEY_ID: "k" }),
    ).toMatch(/together/);
  });
});

describe("file type sniffing", () => {
  it("recognises the four types by their bytes and nothing else", () => {
    expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0]))).toBe("image/jpeg");
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffContentType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(
      sniffContentType(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypmp42")])),
    ).toBe("video/mp4");
    expect(sniffContentType(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffContentType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffContentType(Buffer.from("PK\u0003\u0004"))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
    expect(
      sniffContentType(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypheic")])),
    ).toBeNull();
  });
});
