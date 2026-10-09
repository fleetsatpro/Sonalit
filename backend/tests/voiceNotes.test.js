const request = require('supertest');

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_KEY = 'voice-notes/' + ORG_ID + '/incident/' + PARENT_ID + '/' + NOTE_ID + '.webm';

describe('voice-note storage readiness and commit integrity', () => {
  let app;
  let mockDb;
  let mockS3Send;
  let mockGetSignedUrl;
  let dbMode;
  let existingRow;
  let previousEnv;

  beforeEach(() => {
    jest.resetModules();
    previousEnv = {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
      R2_SECRET_KEY: process.env.R2_SECRET_KEY,
      R2_BUCKET: process.env.R2_BUCKET,
    };
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY = 'test-access-key';
    process.env.R2_SECRET_KEY = 'test-secret-key';
    process.env.R2_BUCKET = 'sonalit-test-bucket';

    dbMode = 'insert';
    existingRow = {
      id: NOTE_ID,
      org_id: ORG_ID,
      parent_type: 'incident',
      parent_id: PARENT_ID,
      uploaded_by: USER_ID,
      storage_key: STORAGE_KEY,
      file_size_bytes: 512,
      mime_type: 'audio/webm',
    };
    mockDb = jest.fn(async (sql, params = []) => {
      if (/INSERT INTO voice_notes/i.test(sql)) {
        if (dbMode === 'insert') return { rows: [existingRow] };
        return { rows: [] };
      }
      if (/SELECT id, org_id, parent_type, parent_id, uploaded_by, storage_key, file_size_bytes, mime_type/i.test(sql)) {
        return { rows: dbMode === 'duplicate-match' ? [existingRow] : [] };
      }
      throw new Error('Unexpected SQL in voice-note test: ' + sql);
    });
    mockS3Send = jest.fn(async () => ({ ContentLength: 512, ContentType: 'audio/webm' }));
    mockGetSignedUrl = jest.fn(async () => 'https://test-bucket.example.invalid/presigned-upload');

    jest.doMock('../src/middleware/auth', () => ({
      authenticate: (req, _res, next) => {
        req.user = { id: USER_ID, org_id: ORG_ID, role: 'operator' };
        next();
      },
    }));
    jest.doMock('../src/utils/orgScopedDb', () => ({
      attachOrgDb: (req, _res, next) => { req.db = mockDb; next(); },
    }));
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: class {
        constructor(options) { this.options = options; }
        send(command) { return mockS3Send(command); }
      },
      PutObjectCommand: class { constructor(input) { this.input = input; } },
      GetObjectCommand: class { constructor(input) { this.input = input; } },
      HeadObjectCommand: class { constructor(input) { this.input = input; } },
    }));
    jest.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: (...args) => mockGetSignedUrl(...args),
    }));

    const express = require('express');
    const router = require('../src/routes/voiceNotes');
    app = express();
    app.use(express.json());
    app.use('/voice-notes', router);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
    jest.clearAllMocks();
  });

  const uploadRequest = (overrides = {}) => request(app)
    .post('/voice-notes/upload-url')
    .send({
      note_id: NOTE_ID,
      parent_type: 'incident',
      parent_id: PARENT_ID,
      mime_type: 'audio/webm',
      duration_sec: 10,
      file_size_bytes: 512,
      ...overrides,
    });

  const commitRequest = (overrides = {}) => request(app)
    .post('/voice-notes/commit')
    .send({
      note_id: NOTE_ID,
      parent_type: 'incident',
      parent_id: PARENT_ID,
      storage_key: STORAGE_KEY,
      duration_sec: 10,
      file_size_bytes: 512,
      mime_type: 'audio/webm',
      ...overrides,
    });

  test('returns an explicit service error instead of HTTP 200 with a null upload URL', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY;
    delete process.env.R2_SECRET_KEY;
    delete process.env.R2_BUCKET;

    const response = await uploadRequest();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'storage_not_configured' });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('uses Sonalit R2 and keeps the upload key stable across client retries', async () => {
    const response = await uploadRequest();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      note_id: NOTE_ID,
      storage_key: STORAGE_KEY,
      upload_url: 'https://test-bucket.example.invalid/presigned-upload',
      expires_in: 300,
    });
    const [client, command, options] = mockGetSignedUrl.mock.calls[0];
    expect(client.options).toMatchObject({
      region: 'auto',
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
      credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
    });
    expect(command.input).toMatchObject({
      Bucket: 'sonalit-test-bucket',
      Key: STORAGE_KEY,
      ContentType: 'audio/webm',
    });
    expect(options).toEqual({ expiresIn: 300 });
  });

  test('refuses to commit metadata until the object is confirmed to exist', async () => {
    mockS3Send.mockRejectedValueOnce(Object.assign(new Error('not found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    }));

    const response = await commitRequest();

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'uploaded_object_not_found' });
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('rejects object size mismatch before writing the voice-note row', async () => {
    mockS3Send.mockResolvedValueOnce({ ContentLength: 511, ContentType: 'audio/webm' });

    const response = await commitRequest();

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('uploaded_object_size_mismatch');
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('rejects an object without authoritative content-type metadata', async () => {
    mockS3Send.mockResolvedValueOnce({ ContentLength: 512 });

    const response = await commitRequest();

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('uploaded_object_type_mismatch');
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('commits only the exact tenant/parent/note key after a successful object HEAD', async () => {
    const response = await commitRequest();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ data: { id: NOTE_ID }, duplicate: false });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockS3Send.mock.calls[0][0].input).toEqual({
      Bucket: 'sonalit-test-bucket',
      Key: STORAGE_KEY,
    });
    expect(mockDb).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO voice_notes/i), [
      NOTE_ID, 'incident', PARENT_ID, USER_ID, STORAGE_KEY, 10, 512, 'audio/webm',
    ]);
  });

  test('rejects a forged same-tenant storage key that belongs to another parent or note', async () => {
    const response = await commitRequest({ storage_key: 'voice-notes/' + ORG_ID + '/incident/' + PARENT_ID + '/other-note.webm' });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('storage_key_not_in_tenant_namespace');
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });

  test('repairs a lost commit acknowledgement idempotently only when every owner field matches', async () => {
    dbMode = 'duplicate-match';

    const response = await commitRequest();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { id: NOTE_ID }, duplicate: true });
    expect(mockDb).toHaveBeenCalledTimes(2);
  });

  test('does not call a conflicting note ID a successful duplicate', async () => {
    dbMode = 'duplicate-mismatch';

    const response = await commitRequest();

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'voice_note_id_conflict' });
  });

  test('validates signed upload failures and never swallows them into a successful null URL', async () => {
    mockGetSignedUrl.mockRejectedValueOnce(new Error('private provider detail'));

    const response = await uploadRequest();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'storage_signing_failed' });
    expect(JSON.stringify(response.body)).not.toContain('private provider detail');
  });
});
