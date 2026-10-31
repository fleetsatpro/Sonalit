'use strict';

const { createHash } = require('crypto');
const {
  S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 120;

class SjmEvidenceStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SjmEvidenceStorageError';
    this.code = code;
  }
}

function createSjmEvidenceStorage({
  env = process.env,
  Client = S3Client,
  PutCommand = PutObjectCommand,
  HeadCommand = HeadObjectCommand,
  GetCommand = GetObjectCommand,
  signUrl = getSignedUrl,
} = {}) {
  let client = null;

  function configuration() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET } = env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
      throw new SjmEvidenceStorageError(
        'storage_not_configured',
        'Private SJM evidence storage is not configured on this server.',
      );
    }
    if (!client) {
      client = new Client({
        region: 'auto',
        endpoint: 'https://' + R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
        credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
      });
    }
    return { client, bucket: R2_BUCKET };
  }

  async function createUploadUrl({ key, mimeType, evidenceId, journeyId, now = Date.now() }) {
    const { client: s3, bucket } = configuration();
    const metadata = {
      'evidence-id': String(evidenceId),
      'journey-id': String(journeyId),
    };
    const command = new PutCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
      Metadata: metadata,
    });
    let upload_url;
    try {
      upload_url = await signUrl(s3, command, { expiresIn: UPLOAD_TTL_SECONDS });
    } catch {
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage could not create an upload capability.');
    }
    return {
      upload_url,
      expires_at: new Date(now + UPLOAD_TTL_SECONDS * 1000).toISOString(),
      required_headers: {
        'Content-Type': mimeType,
        'x-amz-meta-evidence-id': String(evidenceId),
        'x-amz-meta-journey-id': String(journeyId),
      },
    };
  }

  async function verifyUploadedObject({
    key, mimeType, sizeBytes, evidenceId, journeyId,
  }) {
    const { client: s3, bucket } = configuration();
    let head;
    try {
      head = await s3.send(new HeadCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || 0);
      if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
        throw new SjmEvidenceStorageError('object_not_found', 'The uploaded evidence object was not found in private storage.');
      }
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage could not verify the uploaded object.');
    }

    if (Number(head.ContentLength) !== Number(sizeBytes)) {
      throw new SjmEvidenceStorageError('size_mismatch', 'The stored object size does not match the registered evidence size.');
    }
    if (String(head.ContentType || '').toLowerCase() !== String(mimeType).toLowerCase()) {
      throw new SjmEvidenceStorageError('mime_mismatch', 'The stored object content type does not match the registered evidence type.');
    }
    const metadata = head.Metadata || {};
    if (metadata['evidence-id'] !== String(evidenceId) || metadata['journey-id'] !== String(journeyId)) {
      throw new SjmEvidenceStorageError('metadata_mismatch', 'The stored object does not match the registered evidence identity.');
    }

    let object;
    try {
      object = await s3.send(new GetCommand({ Bucket: bucket, Key: key }));
    } catch {
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage could not read the uploaded object for integrity verification.');
    }
    if (!object?.Body || typeof object.Body[Symbol.asyncIterator] !== 'function') {
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage returned an unreadable object body.');
    }

    const hash = createHash('sha256');
    const prefixChunks = [];
    let prefixLength = 0;
    let bytesRead = 0;
    try {
      for await (const chunk of object.Body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesRead += buffer.length;
        if (bytesRead > Number(sizeBytes)) {
          throw new SjmEvidenceStorageError('size_mismatch', 'The stored evidence exceeded its registered size.');
        }
        if (prefixLength < 16) {
          const part = buffer.subarray(0, Math.min(buffer.length, 16 - prefixLength));
          prefixChunks.push(part);
          prefixLength += part.length;
        }
        hash.update(buffer);
      }
    } catch (error) {
      if (error instanceof SjmEvidenceStorageError) throw error;
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage failed during integrity verification.');
    }

    if (bytesRead !== Number(sizeBytes)) {
      throw new SjmEvidenceStorageError('size_mismatch', 'The stored object size does not match its registered size.');
    }
    const prefix = Buffer.concat(prefixChunks);
    const signatures = {
      'image/jpeg': prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff,
      'image/png': prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'application/pdf': prefix.length >= 5 && prefix.subarray(0, 5).toString('ascii') === '%PDF-',
      'video/mp4': prefix.length >= 8 && prefix.subarray(4, 8).toString('ascii') === 'ftyp',
    };
    if (!signatures[mimeType]) {
      throw new SjmEvidenceStorageError('content_signature_mismatch', 'The stored file signature does not match its registered MIME type.');
    }
    return { sha256: hash.digest('hex'), size_bytes: bytesRead, content_type: head.ContentType };
  }

  async function createDownloadUrl({ key, mimeType, fileName }) {
    const { client: s3, bucket } = configuration();
    const safeName = String(fileName || 'evidence')
      .replace(/[\r\n"\\/\x00-\x1f\x7f]/g, '_')
      .slice(0, 160) || 'evidence';
    const command = new GetCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: mimeType,
      ResponseContentDisposition: 'attachment; filename="' + safeName + '"',
    });
    let download_url;
    try {
      download_url = await signUrl(s3, command, { expiresIn: DOWNLOAD_TTL_SECONDS });
    } catch {
      throw new SjmEvidenceStorageError('storage_unavailable', 'Private evidence storage could not create a download capability.');
    }
    return {
      download_url,
      expires_at: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  return { createUploadUrl, verifyUploadedObject, createDownloadUrl };
}

const defaultStorage = createSjmEvidenceStorage();

module.exports = {
  createSjmEvidenceStorage,
  SjmEvidenceStorageError,
  UPLOAD_TTL_SECONDS,
  DOWNLOAD_TTL_SECONDS,
  ...defaultStorage,
};
