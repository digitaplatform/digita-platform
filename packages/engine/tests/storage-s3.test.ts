import { describe, it, expect, beforeEach } from "vitest";
import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3StoragePort } from "../src/core/storage/s3-storage.js";
import { FileNotFoundInStorageError } from "../src/core/storage/storage-port.js";

const s3Mock = mockClient(S3Client);

const config = {
  bucket: "documents",
  region: "garage",
  endpoint: "http://garage-s3.objectstore.svc.cluster.local:3900",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
};

function makePort(): S3StoragePort {
  return new S3StoragePort(config);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Resolved client config values may be plain or provider functions depending on SDK version. */
async function resolveConfigValue<T>(value: T | (() => Promise<T>)): Promise<T> {
  return typeof value === "function" ? await (value as () => Promise<T>)() : value;
}

beforeEach(() => {
  s3Mock.reset();
});

describe("S3StoragePort", () => {
  it("reports backend 's3'", () => {
    expect(makePort().backend).toBe("s3");
  });

  it("configures the client for Garage: path-style addressing + literal region", async () => {
    const port = makePort();
    // Garage REQUIRES path-style — virtual-host bucket DNS does not exist there.
    await expect(resolveConfigValue(port.client.config.forcePathStyle)).resolves.toBe(true);
    await expect(resolveConfigValue(port.client.config.region)).resolves.toBe("garage");
    const endpoint = await resolveConfigValue(port.client.config.endpoint!);
    expect(endpoint).toMatchObject({ hostname: "garage-s3.objectstore.svc.cluster.local", port: 3900 });
  });

  it("disables SDK default integrity checksums (Garage multipart-CRC32 compat)", async () => {
    // Regression net for the >5 MiB unreadable-object bug: with the SDK
    // defaults (WHEN_SUPPORTED), multipart uploads store a composite CRC32
    // that Garage returns on GetObject and the SDK fails to validate —
    // every download of a large object aborts with "Checksum mismatch".
    const port = makePort();
    await expect(
      resolveConfigValue(port.client.config.requestChecksumCalculation),
    ).resolves.toBe("WHEN_REQUIRED");
    await expect(
      resolveConfigValue(port.client.config.responseChecksumValidation),
    ).resolves.toBe("WHEN_REQUIRED");
  });

  it("put sends PutObject with the right Bucket/Key/ContentType (buffer body)", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const port = makePort();

    await port.put("abc-123.pdf", Buffer.from("pdf bytes"), "application/pdf");

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]!.input).toMatchObject({
      Bucket: "documents",
      Key: "abc-123.pdf",
      ContentType: "application/pdf",
    });
  });

  it("put streams a Readable body through lib-storage Upload", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const port = makePort();

    await port.put("stream.txt", Readable.from(Buffer.from("streamed")), "text/plain");

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]!.input).toMatchObject({
      Bucket: "documents",
      Key: "stream.txt",
      ContentType: "text/plain",
    });
  });

  it("getStream maps GetObject to { stream, contentType, contentLength }", async () => {
    const body = Readable.from(Buffer.from("object content"));
    s3Mock.on(GetObjectCommand).resolves({
      // The SDK types Body as a smithy streaming payload; at runtime in Node it is a Readable.
      Body: body as never,
      ContentType: "text/plain",
      ContentLength: 14,
    });
    const port = makePort();

    const result = await port.getStream("some-key.txt");

    expect(s3Mock.commandCalls(GetObjectCommand)[0]!.args[0]!.input).toEqual({
      Bucket: "documents",
      Key: "some-key.txt",
    });
    expect(result.contentType).toBe("text/plain");
    expect(result.contentLength).toBe(14);
    expect((await streamToBuffer(result.stream)).toString()).toBe("object content");
  });

  it("getStream maps NoSuchKey to FileNotFoundInStorageError", async () => {
    s3Mock.on(GetObjectCommand).rejects(
      new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: "The specified key does not exist." }),
    );
    await expect(makePort().getStream("missing")).rejects.toBeInstanceOf(FileNotFoundInStorageError);
  });

  it("getStream propagates non-404 errors untouched", async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error("connection refused"));
    await expect(makePort().getStream("any")).rejects.toThrow("connection refused");
  });

  it("delete sends DeleteObject with the right Bucket/Key", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    await makePort().delete("old-key.png");

    expect(s3Mock.commandCalls(DeleteObjectCommand)[0]!.args[0]!.input).toEqual({
      Bucket: "documents",
      Key: "old-key.png",
    });
  });

  it("delete tolerates NoSuchKey (idempotent)", async () => {
    s3Mock.on(DeleteObjectCommand).rejects(
      new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: "The specified key does not exist." }),
    );
    await expect(makePort().delete("already-gone")).resolves.toBeUndefined();
  });

  it("delete propagates real backend failures", async () => {
    s3Mock.on(DeleteObjectCommand).rejects(new Error("access denied"));
    await expect(makePort().delete("k")).rejects.toThrow("access denied");
  });
});
