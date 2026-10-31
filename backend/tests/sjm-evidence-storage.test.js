'use strict';

const { createHash } = require('crypto');
const {
  createSjmEvidenceStorage,
  SjmEvidenceStorageError,
} = require('../src/services/sjmEvidenceStorage');

const env = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY: 'test-access',
  R2_SECRET_KEY: 'test-secret',
  R2_BUCKET: 'private-evidence',
};

class Command {
  constructor(input) { this.input = input; }
}

function fakeBody(bytes) {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(bytes.slice(0, 3));
      yield Buffer.from(bytes.slice(3));
    },
  };
}

describe('SJM private evidence storage', () => {
  test('fails closed when R2 credentials are not configured', async () => {
    const storage = createSjmEvidenceStorage({ env: {} });
    await expect(storage.createUploadUrl({
      key: 'orgs/org/sjm/journey/evidence/id',
      mimeType: 'image/jpeg',
      evidenceId: 'evidence-id',
      journeyId: 'journey-id',
    })).rejects.toMatchObject({ code: 'storage_not_configured' });
  });

  test('creates a short-lived private upload URL with tenant-bound object metadata', async () => {
    const client = { send: jest.fn() };
    const signer = jest.fn(async (_client, command, options) => {
      expect(command.input.Bucket).toBe('private-evidence');
      expect(command.input.Key).toBe('orgs/org/sjm/journey/evidence/id');
      expect(command.input.ContentType).toBe('image/jpeg');
      expect(command.input.Metadata).toEqual({ 'evidence-id': 'evidence-id', 'journey-id': 'journey-id' });
      expect(options.expiresIn).toBe(300);
      return 'https://private-storage.example/signed-put';
    });
    const storage = createSjmEvidenceStorage({
      env,
      Client: jest.fn(() => client),
      PutCommand: Command,
      signUrl: signer,
    });
    const result = await storage.createUploadUrl({
      key: 'orgs/org/sjm/journey/evidence/id',
      mimeType: 'image/jpeg',
      evidenceId: 'evidence-id',
      journeyId: 'journey-id',
      now: 1000,
    });
    expect(result.upload_url).toBe('https://private-storage.example/signed-put');
    expect(result.expires_at).toBe(new Date(301000).toISOString());
    expect(result.required_headers).toEqual({
      'Content-Type': 'image/jpeg',
      'x-amz-meta-evidence-id': 'evidence-id',
      'x-amz-meta-journey-id': 'journey-id',
    });
  });

  test('verifies exact object metadata and computes SHA-256 from the stored bytes', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.from('verified evidence bytes')]);
    const client = {
      send: jest.fn()
        .mockResolvedValueOnce({
          ContentLength: bytes.length,
          ContentType: 'image/jpeg',
          Metadata: { 'evidence-id': 'evidence-id', 'journey-id': 'journey-id' },
        })
        .mockResolvedValueOnce({ Body: fakeBody(bytes) }),
    };
    const storage = createSjmEvidenceStorage({
      env,
      Client: jest.fn(() => client),
      HeadCommand: Command,
      GetCommand: Command,
    });
    const result = await storage.verifyUploadedObject({
      key: 'private-key',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      evidenceId: 'evidence-id',
      journeyId: 'journey-id',
    });
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.size_bytes).toBe(bytes.length);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  test('rejects an object with wrong content type before hashing it', async () => {
    const client = { send: jest.fn().mockResolvedValue({ ContentLength: 10, ContentType: 'text/plain', Metadata: {} }) };
    const storage = createSjmEvidenceStorage({
      env,
      Client: jest.fn(() => client),
      HeadCommand: Command,
      GetCommand: Command,
    });
    await expect(storage.verifyUploadedObject({
      key: 'private-key',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      evidenceId: 'evidence-id',
      journeyId: 'journey-id',
    })).rejects.toMatchObject({ code: 'mime_mismatch' });
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  test('rejects a byte signature that does not match the declared MIME type', async () => {
    const bytes = Buffer.from('not actually a JPEG file');
    const client = {
      send: jest.fn()
        .mockResolvedValueOnce({
          ContentLength: bytes.length,
          ContentType: 'image/jpeg',
          Metadata: { 'evidence-id': 'evidence-id', 'journey-id': 'journey-id' },
        })
        .mockResolvedValueOnce({ Body: fakeBody(bytes) }),
    };
    const storage = createSjmEvidenceStorage({
      env,
      Client: jest.fn(() => client),
      HeadCommand: Command,
      GetCommand: Command,
    });
    await expect(storage.verifyUploadedObject({
      key: 'private-key', mimeType: 'image/jpeg', sizeBytes: bytes.length,
      evidenceId: 'evidence-id', journeyId: 'journey-id',
    })).rejects.toMatchObject({ code: 'content_signature_mismatch' });
  });

  test('issues a private, time-limited download rather than returning a public object URL', async () => {
    const client = { send: jest.fn() };
    const signer = jest.fn(async (_client, command, options) => {
      expect(command.input.Bucket).toBe('private-evidence');
      expect(command.input.Key).toBe('private-key');
      expect(command.input.ResponseContentType).toBe('application/pdf');
      expect(command.input.ResponseContentDisposition).toContain('secure-brief.pdf');
      expect(options.expiresIn).toBe(120);
      return 'https://private-storage.example/signed-get';
    });
    const storage = createSjmEvidenceStorage({
      env,
      Client: jest.fn(() => client),
      GetCommand: Command,
      signUrl: signer,
    });
    const result = await storage.createDownloadUrl({
      key: 'private-key',
      mimeType: 'application/pdf',
      fileName: 'secure-brief.pdf',
    });
    expect(result.download_url).toBe('https://private-storage.example/signed-get');
  });
});
