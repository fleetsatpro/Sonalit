/**
 * Ops Comms controller — unit tests.
 *
 * These do NOT hit the real DB (integration tests live under tests/integration/).
 * They mock req.db/req.dbTx and prove the permission matrix from spec §6:
 *
 *   | action                        | member | ch admin | org admin |
 *   | send/read                     | ok     | ok       | ok        |
 *   | delete OWN message            | ok     | ok       | ok        |
 *   | delete OTHERS' message        | 403    | ok       | ok        |
 *   | add/remove members            | 403    | ok       | ok        |
 *   | remove LAST channel admin     | 409    | 409      | 409       |
 *   | delete channel                | 403    | ok       | ok        |
 *   | pin                           | 403    | ok       | ok        |
 */
'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';

// Silence logger and the audit-log writer (which touches a real pool otherwise).
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
}));
jest.mock('../src/config/database', () => ({
  pool: { connect: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }) },
  query: jest.fn().mockResolvedValue({ rows: [] }),
  healthCheck: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/realtime/centrifugo', () => ({ publish: jest.fn() }));

const controller = require('../src/controllers/messageController');

// ── Test harness ────────────────────────────────────────────────────────────

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const USER_MEMBER   = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_CHADMIN  = 'aaaaaaaa-0000-0000-0000-000000000002';
const USER_ORGADMIN = 'aaaaaaaa-0000-0000-0000-000000000003';
const USER_OTHER    = 'aaaaaaaa-0000-0000-0000-000000000004';
const CHAN          = 'cccccccc-0000-0000-0000-000000000001';
const MSG_BY_MEMBER = 'dddddddd-0000-0000-0000-000000000001';

function makeReq({ user, dbReturns }) {
  const req = { user, params: {}, body: {}, query: {} };
  req.db = jest.fn((sql /* , params */) => {
    for (const [pattern, rows] of dbReturns) {
      if (pattern.test(sql)) return Promise.resolve({ rows, rowCount: rows.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  req.dbTx = jest.fn(async (fn) => fn({ query: (sql, params) => req.db(sql, params) }));
  return req;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

// ── Regular member sending a message succeeds ───────────────────────────────

test('sendMessage: regular member of channel can send text', async () => {
  const req = makeReq({
    user: { id: USER_MEMBER, org_id: ORG_A, role: 'operator', name: 'Mem' },
    dbReturns: [
      [/^SELECT \* FROM channels/,       [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_MEMBER, is_channel_admin: false }]],
      [/^SELECT name, role FROM users/,   [{ name: 'Mem', role: 'operator' }]],
      [/message_attachments WHERE message_id/, []],
    ],
  });
  req.params.id = CHAN;
  req.body = { text: 'hello world' };
  const res = makeRes();
  // req.dbTx must return the newly inserted message row for the controller to read
  req.dbTx = jest.fn(async () => ({
    id: 'msg-new', channel_id: CHAN, author_id: USER_MEMBER, body: 'hello world',
    reply_to_id: null, created_at: new Date().toISOString(),
  }));

  await controller.sendMessage(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: 'hello world' }) }));
});

test('sendMessage: non-member of channel is 403', async () => {
  const req = makeReq({
    user: { id: USER_OTHER, org_id: ORG_A, role: 'operator', name: 'Nobody' },
    dbReturns: [
      [/^SELECT \* FROM channels/,       [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, []],
    ],
  });
  req.params.id = CHAN;
  req.body = { text: 'hi' };
  const res = makeRes();
  await controller.sendMessage(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

test('sendMessage: text and attachmentIds both empty → 400', async () => {
  const req = makeReq({
    user: { id: USER_MEMBER, org_id: ORG_A, role: 'operator', name: 'Mem' },
    dbReturns: [
      [/^SELECT \* FROM channels/,       [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_MEMBER, is_channel_admin: false }]],
    ],
  });
  req.params.id = CHAN;
  req.body = {};
  const res = makeRes();
  await controller.sendMessage(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(400);
});

// ── Delete-message permission matrix ────────────────────────────────────────

test('deleteMessage: author can delete own message', async () => {
  const req = makeReq({
    user: { id: USER_MEMBER, org_id: ORG_A, role: 'operator' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_MEMBER, is_channel_admin: false }]],
      [/^SELECT \* FROM messages/, [{
        id: MSG_BY_MEMBER, channel_id: CHAN, author_id: USER_MEMBER, deleted_at: null,
      }]],
    ],
  });
  req.params = { id: CHAN, msgId: MSG_BY_MEMBER };
  const res = makeRes();
  await controller.deleteMessage(req, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ ok: true });
});

test('deleteMessage: regular member cannot delete someone else\'s message', async () => {
  const req = makeReq({
    user: { id: USER_OTHER, org_id: ORG_A, role: 'operator' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_OTHER, is_channel_admin: false }]],
      [/^SELECT \* FROM messages/, [{
        id: MSG_BY_MEMBER, channel_id: CHAN, author_id: USER_MEMBER, deleted_at: null,
      }]],
    ],
  });
  req.params = { id: CHAN, msgId: MSG_BY_MEMBER };
  const res = makeRes();
  await controller.deleteMessage(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

test('deleteMessage: channel admin can delete someone else\'s message', async () => {
  const req = makeReq({
    user: { id: USER_CHADMIN, org_id: ORG_A, role: 'operator' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_CHADMIN, is_channel_admin: true }]],
      [/^SELECT \* FROM messages/, [{
        id: MSG_BY_MEMBER, channel_id: CHAN, author_id: USER_MEMBER, deleted_at: null,
      }]],
    ],
  });
  req.params = { id: CHAN, msgId: MSG_BY_MEMBER };
  const res = makeRes();
  await controller.deleteMessage(req, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ ok: true });
});

test('deleteMessage: org admin can delete regardless of membership', async () => {
  const req = makeReq({
    user: { id: USER_ORGADMIN, org_id: ORG_A, role: 'admin' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      [/^SELECT \* FROM channel_members/, []],  // org admin not a member — still allowed
      [/^SELECT \* FROM messages/, [{
        id: MSG_BY_MEMBER, channel_id: CHAN, author_id: USER_MEMBER, deleted_at: null,
      }]],
    ],
  });
  req.params = { id: CHAN, msgId: MSG_BY_MEMBER };
  const res = makeRes();
  await controller.deleteMessage(req, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ ok: true });
});

// ── Delete-channel permission matrix ────────────────────────────────────────

test('deleteChannel: regular member is 403', async () => {
  const req = makeReq({
    user: { id: USER_MEMBER, org_id: ORG_A, role: 'operator' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A, name: 'general' }]],
      [/^SELECT \* FROM channel_members/, [{ user_id: USER_MEMBER, is_channel_admin: false }]],
    ],
  });
  req.params.id = CHAN;
  const res = makeRes();
  await controller.deleteChannel(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

// ── Last-admin-guardrail on remove/demote ───────────────────────────────────

test('removeMember: cannot remove the last channel admin', async () => {
  const targetId = USER_CHADMIN;
  const req = makeReq({
    user: { id: USER_ORGADMIN, org_id: ORG_A, role: 'admin' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      // First member query is the actor (org admin, not a member)
      // Second is loadMember(target) which returns the admin
      [/channel_members WHERE channel_id = \$1 AND user_id = \$2/, [{ user_id: targetId, is_channel_admin: true }]],
      // COUNT admins → 1 (the target)
      [/COUNT\(\*\)::INT AS n FROM channel_members/, [{ n: 1 }]],
    ],
  });
  req.params = { id: CHAN, userId: targetId };
  const res = makeRes();
  await controller.removeMember(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(409);
});

test('updateMember: cannot demote the last channel admin', async () => {
  const req = makeReq({
    user: { id: USER_ORGADMIN, org_id: ORG_A, role: 'admin' },
    dbReturns: [
      [/^SELECT \* FROM channels/, [{ id: CHAN, org_id: ORG_A }]],
      [/channel_members WHERE channel_id = \$1 AND user_id = \$2/, [{ user_id: USER_CHADMIN, is_channel_admin: true }]],
      [/COUNT\(\*\)::INT AS n FROM channel_members/, [{ n: 1 }]],
    ],
  });
  req.params = { id: CHAN, userId: USER_CHADMIN };
  req.body = { isChannelAdmin: false };
  const res = makeRes();
  await controller.updateMember(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(409);
});
