import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageNotFoundError } from "./storage-errors.js";

function isNotFound(err) {
  return err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
}

/**
 * S3-compatible driver (AWS SDK v3). The client and the presign function are injectable so tests
 * can mock them. There is no delete call: the interface does not offer one.
 * @param {{ bucket: string, client: { send: Function }, presign?: Function }} options
 */
export function createS3Storage({ bucket, client, presign = getSignedUrl }) {
  return {
    name: "s3",

    async put({ key, body, size, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: contentType,
        }),
      );
      return { key };
    },

    async get(key) {
      let out;
      try {
        out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        if (isNotFound(err)) throw new StorageNotFoundError(key);
        throw err;
      }
      return { stream: out.Body, size: out.ContentLength };
    },

    async signedUrl(key, { expiresInSeconds, contentType, filename } = {}) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(contentType ? { ResponseContentType: contentType } : {}),
        ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      });
      return presign(client, command, { expiresIn: expiresInSeconds ?? 120 });
    },
  };
}

/** Builds the client from EVIDENCE_S3_* settings. Credentials never appear in code. */
export function createS3StorageFromConfig(config) {
  const client = new S3Client({
    region: config.EVIDENCE_S3_REGION,
    ...(config.EVIDENCE_S3_ENDPOINT ? { endpoint: config.EVIDENCE_S3_ENDPOINT } : {}),
    forcePathStyle: Boolean(config.EVIDENCE_S3_FORCE_PATH_STYLE),
    ...(config.EVIDENCE_S3_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: config.EVIDENCE_S3_ACCESS_KEY_ID,
            secretAccessKey: config.EVIDENCE_S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return createS3Storage({ bucket: config.EVIDENCE_S3_BUCKET, client });
}
