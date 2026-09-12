/**
 * Ops Comms — full replacement for the flat channels/messages controller.
 *
 * Endpoint groups:
 *   channels        — list/create/delete channels; membership; mute
 *   messages        — send/soft-delete/list/thread/pin/react/search
 *   attachments     — presigned R2 upload + finalize
 *
 * Auth model:
 *   - authenticate  ({ id, role, org_id }) is applied at the router level
 *   - Org admin     = req.user.role === 'admin'
 *   - Channel admin = row in channel_members with is_channel_admin=true
 *   - Every mutating endpoint re-checks membership + role from the DB
 *     on every request. The client is assumed to be hostile.
 *
 * RLS is enforced via req.db (withOrg wrapper) — no raw pool queries here.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');
const logger = require('../utils/logger');
const { pool } = require('../config/database');

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_MESSAGE_BODY = 4000;
const MAX_CHANNEL_NAME = 60;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;    // 25 MB
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/zip',
  'text/plain', 'text/csv', 'text/markdown',
]);

function slugify(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, MAX_CHANNEL_NAME);
}

function isOrgAdmin(user)   { return user && user.role === 'admin'; }
function badRequest(res, m) { return res.status(400).json({ error: m }); }
function forbidden(res, m)  { return res.status(403).json({ error: m || 'Forbidden' }); }
function notFound(res, m)   { return res.status(404).json({ error: m || 'Not found' }); }

// ─── Membership / permission helpers ────────────────────────────────────────
// Every helper uses req.db so RLS filters out cross-org rows automatically.

async function loadChannel(req, channelId) {
  const r = await req.db(`SELECT * FROM channels WHERE id = $1`, [channelId]);
  return r.rows[0] ?? null;
}

async function loadMember(req, channelId, userId) {
  const r = await req.db(
    `SELECT * FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, userId],
  );
  return r.rows[0] ?? null;
}

/**
 * Actor may read the channel if either:
 *   - they are a member of it, OR
 *   - they are org admin (implicit access everywhere in their org)
 * Returns { channel, member } or null if denied.
 */
async function requireChannelReader(req, res, channelId) {
  const channel = await loadChannel(req, channelId);
  if (!channel) { notFound(res, 'Channel not found'); return null; }
  const member = await loadMember(req, channelId, req.user.id);
  if (!member && !isOrgAdmin(req.user)) { forbidden(res, 'Not a member of this channel'); return null; }
  return { channel, member };
}

/**
 * Actor may manage the channel (add/remove members, pin, delete channel)
 * if either they are a channel admin OR the org admin.
 */
async function requireChannelManager(req, res, channelId) {
  const rd = await requireChannelReader(req, res, channelId);
  if (!rd) return null;
  const { channel, member } = rd;
  const canManage = isOrgAdmin(req.user) || (member && member.is_channel_admin);
  if (!canManage) { forbidden(res, 'Channel admin permission required'); return null; }
  return { channel, member };
}

// ─── Realtime publish helpers ───────────────────────────────────────────────
// Two channels per event:
//   org#<orgId>#comms#<channelId>  — subscribers viewing that channel see rich payload
//   org#<orgId>                    — badge/unread hint so clients not currently viewing
//                                    still tick their unread counter
function publishCommsEvent(orgId, channelId, type, payload) {
  publish(`org#${orgId}#comms#${channelId}`, { type, channel_id: channelId, ...payload });
  publish(`org#${orgId}`, { type: `comms.${type}`, channel_id: channelId });
}

// ─── Audit log helper (writes BEFORE cascade for hard-delete paths) ─────────
// Direct pool query — the audit_logs table has its own hash-chain rules and
// runs outside the request's withOrg transaction on purpose.
async function writeAuditRow(orgId, userId, action, targetId, before) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prev = await client.query(
      `SELECT hash FROM audit_logs WHERE org_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [orgId],
    );
    const prevHash = prev.rows[0]?.hash || null;
    const payload = JSON.stringify({ action, record_id: targetId, before, user_id: userId });
    const newHash = crypto.createHash('sha256').update((prevHash || '') + payload).digest('hex');
    await client.query(
      `INSERT INTO audit_logs
         (table_name, record_id, action, old_data, new_data, user_id, org_id, hash, prev_hash, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, NOW())`,
      ['channels', targetId, action, before ? JSON.stringify(before) : null,
       userId, orgId, newHash, prevHash],
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    // Audit write failure should abort the operation the caller was about to do —
    // let the exception surface.
    throw err;
  } finally {
    client.release();
  }
}

// ─── Org directory ───────────────────────────────────────────────────────────

/**
 * GET /org-users
 * Lightweight directory of every active user in the caller's org, for the
 * mention popover and the "add people" pickers (create-channel + members
 * panel). Any authenticated org member may call this — it's not an admin
 * endpoint, just names/roles, and every mutating comms endpoint re-checks
 * real permissions server-side regardless of what this list shows.
 */
const listOrgUsers = asyncHandler(async (req, res) => {
  const rows = await req.db(
    `SELECT id, name, role, email FROM users
      WHERE org_id = $1 AND deleted_at IS NULL AND status = 'active'
      ORDER BY name
      LIMIT 500`,
    [req.user.org_id],
  );
  res.json({ data: rows.rows });
});

// ─── Channels ────────────────────────────────────────────────────────────────

/**
 * GET /channels
 * Returns every channel this user can see (member of, or org admin sees all).
 * Includes unread counts and last message preview.
 */
const listChannels = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const rows = await req.db(
    `
    WITH visible AS (
      SELECT c.*
        FROM channels c
       WHERE ($2::boolean OR EXISTS (
              SELECT 1 FROM channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $1
            ))
    )
    SELECT
      v.id, v.name, v.slug, v.type, v.category, v.created_at, v.created_by,
      COALESCE(m.muted, false)             AS muted,
      COALESCE(m.is_channel_admin, false)  AS is_channel_admin,
      COALESCE(m.last_read_at, v.created_at) AS last_read_at,
      (SELECT COUNT(*)::INT
         FROM messages msg
        WHERE msg.channel_id = v.id
          AND msg.deleted_at IS NULL
          AND msg.author_id <> $1
          AND msg.created_at > COALESCE(m.last_read_at, v.created_at)
      ) AS unread_count,
      (SELECT COUNT(*)::INT FROM channel_members cm WHERE cm.channel_id = v.id) AS member_count,
      (SELECT jsonb_build_object(
                'id', lm.id,
                'body', CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE NULL END,
                'created_at', lm.created_at,
                'author_id', lm.author_id,
                'author_name', u.name
              )
         FROM messages lm
         LEFT JOIN users u ON u.id = lm.author_id
        WHERE lm.channel_id = v.id
        ORDER BY lm.created_at DESC LIMIT 1
      ) AS last_message
    FROM visible v
    LEFT JOIN channel_members m ON m.channel_id = v.id AND m.user_id = $1
    ORDER BY v.category NULLS LAST, v.name
    `,
    [userId, isOrgAdmin(req.user)],
  );
  res.json({ data: rows.rows });
});

/**
 * POST /channels
 * body: { name, type, category, memberIds? }
 * Any authenticated user can create. Creator becomes the sole channel admin.
 */
const createChannel = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    name:      Joi.string().trim().min(1).max(MAX_CHANNEL_NAME).required(),
    type:      Joi.string().valid('public', 'private').default('public'),
    category:  Joi.string().valid('priority', 'regional', 'operations').allow(null, ''),
    memberIds: Joi.array().items(Joi.string().uuid()).max(200).default([]),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  const slug = slugify(value.name);
  if (!slug) return badRequest(res, 'name must contain alphanumeric characters');

  try {
    const result = await req.dbTx(async (client) => {
      const chanRes = await client.query(
        `INSERT INTO channels (org_id, name, slug, type, category, created_by)
         VALUES ((current_setting('app.current_org_id', true))::uuid, $1, $2, $3, $4, $5)
         RETURNING *`,
        [value.name.trim(), slug, value.type, value.category || null, req.user.id],
      );
      const channel = chanRes.rows[0];

      // Creator + any invited members. Creator is the only channel admin at birth.
      const memberIds = new Set([req.user.id, ...value.memberIds]);
      const rows = [...memberIds].map((uid) =>
        client.query(
          `INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin)
             VALUES ($1, $2, (current_setting('app.current_org_id', true))::uuid, $3)
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [channel.id, uid, uid === req.user.id],
        ),
      );
      await Promise.all(rows);
      return channel;
    });

    publishCommsEvent(req.user.org_id, result.id, 'channel.created', {
      channel: { id: result.id, name: result.name, slug: result.slug, type: result.type, category: result.category },
    });
    res.status(201).json({ data: result });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A channel with that name already exists' });
    throw err;
  }
});

/**
 * DELETE /channels/:id
 * Hard-delete + cascade. Requires channel admin or org admin. Audit log is
 * written BEFORE the cascade (spec §1: "logged before the cascade runs").
 */
const deleteChannel = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;
  const { channel } = perm;

  // Snapshot member count + message count for the audit row.
  const stats = await req.db(
    `SELECT
       (SELECT COUNT(*)::INT FROM channel_members WHERE channel_id = $1) AS member_count,
       (SELECT COUNT(*)::INT FROM messages WHERE channel_id = $1)        AS message_count`,
    [channel.id],
  );
  const before = { ...channel, ...stats.rows[0] };

  // audit_logs.action is constrained to INSERT/UPDATE/DELETE; the table_name
  // ('channels') and the snapshot in before payload identify what got deleted.
  await writeAuditRow(req.user.org_id, req.user.id, 'DELETE', channel.id, before);

  await req.db(`DELETE FROM channels WHERE id = $1`, [channel.id]);
  publishCommsEvent(req.user.org_id, channel.id, 'channel.deleted', { channel_id: channel.id });
  res.json({ ok: true });
});

// ─── Membership ──────────────────────────────────────────────────────────────

const listMembers = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const rows = await req.db(
    `SELECT cm.user_id, cm.is_channel_admin, cm.muted, cm.joined_at,
            u.name, u.email, u.role, u.status
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = $1
      ORDER BY cm.is_channel_admin DESC, u.name`,
    [req.params.id],
  );
  res.json({ data: rows.rows });
});

const addMembers = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;

  const schema = Joi.object({
    userIds: Joi.array().items(Joi.string().uuid()).min(1).max(200).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  // Only add users that exist in this org (RLS on users would help, but users has no
  // FORCE RLS enforced yet — check explicitly).
  const users = await req.db(
    `SELECT id, name FROM users
      WHERE id = ANY($1) AND deleted_at IS NULL AND org_id = $2 AND status = 'active'`,
    [value.userIds, req.user.org_id],
  );
  if (users.rows.length === 0) return badRequest(res, 'No valid users to add');

  await req.dbTx(async (client) => {
    for (const u of users.rows) {
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin)
           VALUES ($1, $2, (current_setting('app.current_org_id', true))::uuid, false)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [req.params.id, u.id],
      );
    }
  });

  for (const u of users.rows) {
    publishCommsEvent(req.user.org_id, req.params.id, 'member.added', { user_id: u.id, user_name: u.name });
  }
  res.status(201).json({ ok: true, added: users.rows.length });
});

const removeMember = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;
  const { user_id: targetId } = { user_id: req.params.userId };

  const target = await loadMember(req, req.params.id, targetId);
  if (!target) return notFound(res, 'User is not a member of this channel');

  // Guardrail: a channel must always retain ≥ 1 channel admin. If removing this
  // user would zero out admins, reject with a clear error (spec §7 test 5).
  if (target.is_channel_admin) {
    const admins = await req.db(
      `SELECT COUNT(*)::INT AS n FROM channel_members
        WHERE channel_id = $1 AND is_channel_admin = true`,
      [req.params.id],
    );
    if (admins.rows[0].n <= 1) {
      return res.status(409).json({
        error: 'Promote another member to channel admin before removing the last admin',
      });
    }
  }

  await req.db(
    `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
    [req.params.id, targetId],
  );
  publishCommsEvent(req.user.org_id, req.params.id, 'member.removed', { user_id: targetId });
  res.json({ ok: true });
});

const updateMember = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;

  const schema = Joi.object({ isChannelAdmin: Joi.boolean().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  const target = await loadMember(req, req.params.id, req.params.userId);
  if (!target) return notFound(res, 'User is not a member of this channel');

  // Demotion guardrail: cannot demote the last remaining channel admin.
  if (target.is_channel_admin && value.isChannelAdmin === false) {
    const admins = await req.db(
      `SELECT COUNT(*)::INT AS n FROM channel_members
        WHERE channel_id = $1 AND is_channel_admin = true`,
      [req.params.id],
    );
    if (admins.rows[0].n <= 1) {
      return res.status(409).json({
        error: 'Promote another member to channel admin before demoting the last admin',
      });
    }
  }

  await req.db(
    `UPDATE channel_members SET is_channel_admin = $3
      WHERE channel_id = $1 AND user_id = $2`,
    [req.params.id, req.params.userId, value.isChannelAdmin],
  );
  publishCommsEvent(req.user.org_id, req.params.id, 'member.updated', {
    user_id: req.params.userId, is_channel_admin: value.isChannelAdmin,
  });
  res.json({ ok: true });
});

const toggleMute = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const schema = Joi.object({ muted: Joi.boolean().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  await req.db(
    `INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin, muted)
       VALUES ($1, $2, (current_setting('app.current_org_id', true))::uuid, false, $3)
     ON CONFLICT (channel_id, user_id) DO UPDATE SET muted = EXCLUDED.muted`,
    [req.params.id, req.user.id, value.muted],
  );
  res.json({ ok: true, muted: value.muted });
});

/**
 * PATCH /channels/:id/read — bump the last_read_at cursor so unread_count zeros.
 * Called by the client when the user opens the channel or scrolls to bottom.
 */
const markRead = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;
  await req.db(
    `UPDATE channel_members SET last_read_at = NOW()
      WHERE channel_id = $1 AND user_id = $2`,
    [req.params.id, req.user.id],
  );
  res.json({ ok: true });
});

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * GET /channels/:id/messages?before=<iso>&limit=<n>
 * Cursor pagination. Returns rows with attachments + reaction summaries.
 * Soft-deleted rows come back with deleted:true (body/attachments scrubbed)
 * so the client can render "Message deleted" without a 404.
 */
const listMessages = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const before = req.query.before || null;

  const rows = await req.db(
    `SELECT
       m.id, m.channel_id, m.author_id, m.body, m.reply_to_id,
       m.created_at, m.edited_at, m.deleted_at,
       u.name AS author_name, u.role AS author_role,
       (SELECT COALESCE(json_agg(jsonb_build_object(
                'id', a.id, 'kind', a.kind, 'file_name', a.file_name,
                'storage_key', a.storage_key, 'mime_type', a.mime_type,
                'size_bytes', a.size_bytes, 'width', a.width, 'height', a.height
              )), '[]'::json)
          FROM message_attachments a
         WHERE a.message_id = m.id AND a.finalized_at IS NOT NULL
       ) AS attachments,
       (SELECT COALESCE(json_agg(r), '[]'::json)
          FROM (
            SELECT emoji, COUNT(*)::INT AS count,
                   BOOL_OR(user_id = $2) AS mine
              FROM message_reactions
             WHERE message_id = m.id
             GROUP BY emoji
             ORDER BY MIN(created_at)
          ) r
       ) AS reactions,
       (SELECT COUNT(*)::INT FROM messages t WHERE t.reply_to_id = m.id AND t.deleted_at IS NULL) AS reply_count
     FROM messages m
     JOIN users u ON u.id = m.author_id
    WHERE m.channel_id = $1
      AND m.reply_to_id IS NULL
      AND ($3::timestamptz IS NULL OR m.created_at < $3)
    ORDER BY m.created_at DESC
    LIMIT $4`,
    [req.params.id, req.user.id, before, limit],
  );

  // Scrub deleted rows before returning to client.
  const data = rows.rows.map((r) => {
    if (r.deleted_at) {
      return {
        ...r,
        body: null,
        attachments: [],
        reactions: [],
        deleted: true,
      };
    }
    return { ...r, deleted: false };
  }).reverse();

  const nextCursor = rows.rows.length === limit ? rows.rows[rows.rows.length - 1].created_at : null;
  res.json({ data, next_cursor: nextCursor });
});

const sendMessage = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const schema = Joi.object({
    text:         Joi.string().trim().max(MAX_MESSAGE_BODY).allow(''),
    replyToId:    Joi.string().uuid().allow(null, ''),
    attachmentIds: Joi.array().items(Joi.string().uuid()).max(10).default([]),
  }).custom((v, h) => {
    if ((!v.text || v.text.length === 0) && (!v.attachmentIds || v.attachmentIds.length === 0)) {
      return h.error('any.custom', { message: 'Message must have text or at least one attachment' });
    }
    return v;
  });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  // If replying, verify the parent message exists in this same channel.
  if (value.replyToId) {
    const parent = await req.db(
      `SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
      [value.replyToId, req.params.id],
    );
    if (!parent.rows.length) return badRequest(res, 'reply_to message not found in this channel');
  }

  const message = await req.dbTx(async (client) => {
    const insert = await client.query(
      `INSERT INTO messages (org_id, channel_id, author_id, body, reply_to_id)
       VALUES ((current_setting('app.current_org_id', true))::uuid, $1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, req.user.id, value.text?.trim() || null, value.replyToId || null],
    );
    const msg = insert.rows[0];

    // Bind any pending attachments this user uploaded to this new message.
    if (value.attachmentIds.length > 0) {
      const upd = await client.query(
        `UPDATE message_attachments
            SET message_id = $1, finalized_at = COALESCE(finalized_at, NOW())
          WHERE id = ANY($2)
            AND uploader_id = $3
            AND message_id IS NULL`,
        [msg.id, value.attachmentIds, req.user.id],
      );
      if (upd.rowCount !== value.attachmentIds.length) {
        // At least one attachment did not belong to this user or was already used.
        throw Object.assign(new Error('One or more attachments could not be attached'), { status: 400 });
      }
    }
    return msg;
  });

  // Load author + attachments for the publish payload so subscribers can render
  // without an extra fetch.
  const authorRes = await req.db(`SELECT name, role FROM users WHERE id = $1`, [req.user.id]);
  const attachRes = await req.db(
    `SELECT id, kind, file_name, storage_key, mime_type, size_bytes, width, height
       FROM message_attachments WHERE message_id = $1 AND finalized_at IS NOT NULL`,
    [message.id],
  );
  const payload = {
    id: message.id,
    channel_id: message.channel_id,
    author_id: message.author_id,
    author_name: authorRes.rows[0]?.name,
    author_role: authorRes.rows[0]?.role,
    body: message.body,
    reply_to_id: message.reply_to_id,
    created_at: message.created_at,
    attachments: attachRes.rows,
    reactions: [],
    reply_count: 0,
    deleted: false,
  };

  publishCommsEvent(req.user.org_id, req.params.id, 'message.created', { message: payload });
  res.status(201).json({ data: payload });
});

/**
 * DELETE /channels/:id/messages/:msgId
 * Soft-delete. Author, channel admin, or org admin. Body is NULL'd; the row and
 * its ID remain so the client can render a "Message deleted" placeholder.
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;
  const { member } = rd;

  const msgRes = await req.db(
    `SELECT * FROM messages WHERE id = $1 AND channel_id = $2`,
    [req.params.msgId, req.params.id],
  );
  const msg = msgRes.rows[0];
  if (!msg) return notFound(res, 'Message not found');
  if (msg.deleted_at) return res.json({ ok: true, already: true });

  const isAuthor  = msg.author_id === req.user.id;
  const canDelete = isAuthor || isOrgAdmin(req.user) || (member && member.is_channel_admin);
  if (!canDelete) return forbidden(res, 'Cannot delete this message');

  await req.db(
    `UPDATE messages
        SET deleted_at = NOW(), deleted_by = $2, body = NULL, edited_at = NOW()
      WHERE id = $1`,
    [msg.id, req.user.id],
  );
  // Reactions and attachments follow the row: attachments stay (cascade only on
  // hard-delete), reactions are dropped since they no longer have meaning.
  await req.db(`DELETE FROM message_reactions WHERE message_id = $1`, [msg.id]);
  await req.db(`DELETE FROM pinned_messages   WHERE message_id = $1`, [msg.id]);

  publishCommsEvent(req.user.org_id, req.params.id, 'message.deleted', {
    message_id: msg.id, deleted_by: req.user.id,
  });
  res.json({ ok: true });
});

const getThread = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const rows = await req.db(
    `SELECT m.id, m.channel_id, m.author_id, m.body, m.reply_to_id,
            m.created_at, m.deleted_at,
            u.name AS author_name, u.role AS author_role
       FROM messages m
       JOIN users u ON u.id = m.author_id
      WHERE m.channel_id = $1
        AND (m.id = $2 OR m.reply_to_id = $2)
      ORDER BY m.created_at ASC`,
    [req.params.id, req.params.msgId],
  );
  if (rows.rows.length === 0) return notFound(res, 'Thread not found');

  const data = rows.rows.map((r) => (r.deleted_at ? { ...r, body: null, deleted: true } : { ...r, deleted: false }));
  res.json({ data });
});

const addReaction = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const schema = Joi.object({ emoji: Joi.string().min(1).max(16).required() });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  // Ensure message exists in this channel and isn't deleted.
  const msg = await req.db(
    `SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [req.params.msgId, req.params.id],
  );
  if (!msg.rows.length) return notFound(res, 'Message not found');

  await req.db(
    `INSERT INTO message_reactions (message_id, user_id, org_id, emoji)
       VALUES ($1, $2, (current_setting('app.current_org_id', true))::uuid, $3)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
    [req.params.msgId, req.user.id, value.emoji],
  );

  publishCommsEvent(req.user.org_id, req.params.id, 'reaction.added', {
    message_id: req.params.msgId, user_id: req.user.id, emoji: value.emoji,
  });
  res.status(201).json({ ok: true });
});

const removeReaction = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const emoji = decodeURIComponent(req.params.emoji || '');
  if (!emoji) return badRequest(res, 'emoji required');

  await req.db(
    `DELETE FROM message_reactions
      WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [req.params.msgId, req.user.id, emoji],
  );
  publishCommsEvent(req.user.org_id, req.params.id, 'reaction.removed', {
    message_id: req.params.msgId, user_id: req.user.id, emoji,
  });
  res.json({ ok: true });
});

// ─── Pinned messages ─────────────────────────────────────────────────────────

const listPinned = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const rows = await req.db(
    `SELECT p.message_id, p.pinned_at, p.pinned_by,
            m.body, m.created_at, m.deleted_at,
            u.name AS author_name, u.role AS author_role
       FROM pinned_messages p
       JOIN messages m ON m.id = p.message_id
       JOIN users u ON u.id = m.author_id
      WHERE p.channel_id = $1
      ORDER BY p.pinned_at DESC`,
    [req.params.id],
  );
  const data = rows.rows.filter((r) => !r.deleted_at);
  res.json({ data });
});

const addPin = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;

  const schema = Joi.object({ messageId: Joi.string().uuid().required() });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  const msg = await req.db(
    `SELECT id FROM messages
      WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [value.messageId, req.params.id],
  );
  if (!msg.rows.length) return notFound(res, 'Message not found');

  await req.db(
    `INSERT INTO pinned_messages (channel_id, message_id, org_id, pinned_by)
       VALUES ($1, $2, (current_setting('app.current_org_id', true))::uuid, $3)
     ON CONFLICT (channel_id, message_id) DO NOTHING`,
    [req.params.id, value.messageId, req.user.id],
  );
  publishCommsEvent(req.user.org_id, req.params.id, 'pin.added', { message_id: value.messageId });
  res.status(201).json({ ok: true });
});

const removePin = asyncHandler(async (req, res) => {
  const perm = await requireChannelManager(req, res, req.params.id);
  if (!perm) return;
  await req.db(
    `DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2`,
    [req.params.id, req.params.messageId],
  );
  publishCommsEvent(req.user.org_id, req.params.id, 'pin.removed', { message_id: req.params.messageId });
  res.json({ ok: true });
});

// ─── Search (server-side fallback the client uses once its window has scrolled) ─

const searchMessages = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;

  const q = String(req.query.q || '').trim();
  if (q.length < 2) return badRequest(res, 'q must be at least 2 characters');
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));

  // ILIKE is fine here: message counts stay bounded per channel and
  // (channel_id, created_at DESC) index narrows the scan window.
  const rows = await req.db(
    `SELECT m.id, m.channel_id, m.author_id, m.body, m.created_at,
            u.name AS author_name, u.role AS author_role
       FROM messages m
       JOIN users u ON u.id = m.author_id
      WHERE m.channel_id = $1
        AND m.deleted_at IS NULL
        AND m.body ILIKE '%' || $2 || '%'
      ORDER BY m.created_at DESC
      LIMIT $3`,
    [req.params.id, q, limit],
  );
  res.json({ data: rows.rows });
});

// ─── Attachments (presigned R2 uploads) ─────────────────────────────────────

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) return null;
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
}

const presignAttachment = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    fileName:  Joi.string().min(1).max(255).required(),
    mimeType:  Joi.string().min(1).max(120).required(),
    sizeBytes: Joi.number().integer().min(1).max(MAX_ATTACHMENT_BYTES).required(),
    kind:      Joi.string().valid('photo', 'file').required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return badRequest(res, error.message);

  if (!ALLOWED_MIME.has(value.mimeType) && !value.mimeType.startsWith('image/')) {
    return badRequest(res, 'mimeType not allowed');
  }
  if (value.kind === 'photo' && !value.mimeType.startsWith('image/')) {
    return badRequest(res, 'kind=photo requires image mimeType');
  }
  const { R2_BUCKET } = process.env;
  if (!R2_BUCKET) return res.status(501).json({ error: 'Attachment storage not configured on this server' });

  const s3 = getR2Client();
  if (!s3) return res.status(501).json({ error: 'Attachment storage not configured on this server' });

  let PutObjectCommand, getSignedUrl;
  try {
    ({ PutObjectCommand } = require('@aws-sdk/client-s3'));
    ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  } catch (_) {
    return res.status(501).json({ error: 'Attachment storage SDK not installed' });
  }

  // Namespaced key: comms/<orgId>/<userId>/<uuid>.<ext>
  const ext = (value.fileName.match(/\.([A-Za-z0-9]{1,8})$/) || [, ''])[1] || '';
  const attachmentId = uuidv4();
  const key = `comms/${req.user.org_id}/${req.user.id}/${attachmentId}${ext ? '.' + ext.toLowerCase() : ''}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: value.mimeType }),
    { expiresIn: 300 },
  );

  // Pre-insert the attachment row (finalized_at NULL) so we know who owns it
  // when the finalize call comes in. RLS + uploader_id keep this safe.
  const row = await req.db(
    `INSERT INTO message_attachments
       (id, org_id, uploader_id, kind, storage_key, file_name, size_bytes, mime_type)
     VALUES ($1, (current_setting('app.current_org_id', true))::uuid, $2, $3, $4, $5, $6, $7)
     RETURNING id, storage_key`,
    [attachmentId, req.user.id, value.kind, key, value.fileName, value.sizeBytes, value.mimeType],
  );

  res.json({
    upload_url:    uploadUrl,
    storage_key:   row.rows[0].storage_key,
    attachment_id: row.rows[0].id,
    expires_in:    300,
  });
});

const finalizeAttachment = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    width:  Joi.number().integer().min(1).max(20000).allow(null),
    height: Joi.number().integer().min(1).max(20000).allow(null),
  });
  const { error, value } = schema.validate(req.body || {});
  if (error) return badRequest(res, error.message);

  // The URL param is the attachment id (uuid); storage_key stays private to the DB.
  const attachmentId = req.params.id;
  const attach = await req.db(
    `SELECT * FROM message_attachments
      WHERE id = $1 AND uploader_id = $2`,
    [attachmentId, req.user.id],
  );
  if (!attach.rows.length) return notFound(res, 'Attachment not found');

  const row = attach.rows[0];
  if (row.finalized_at) return res.json({ data: row });   // idempotent

  // Verify the object actually landed. HEAD the key; if it's missing, the upload
  // never completed and we don't mark the row finalized.
  const s3 = getR2Client();
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: row.storage_key }));
    if (!head || head.ContentLength == null) throw new Error('empty');
    if (head.ContentLength > MAX_ATTACHMENT_BYTES) {
      return badRequest(res, 'Uploaded object exceeds max attachment size');
    }
  } catch (err) {
    logger.warn(`comms attachment finalize failed HEAD for ${row.storage_key}: ${err.message}`);
    return res.status(409).json({ error: 'Upload not found in storage — retry the upload' });
  }

  const updated = await req.db(
    `UPDATE message_attachments
        SET finalized_at = NOW(),
            width = COALESCE($2, width),
            height = COALESCE($3, height)
      WHERE id = $1
      RETURNING *`,
    [attachmentId, value.width ?? null, value.height ?? null],
  );
  res.json({ data: updated.rows[0] });
});

/**
 * GET /attachments/:id — issues a short-lived signed GET URL for viewing an
 * attachment. Enforces membership via the message → channel → member chain
 * so nobody can fetch attachments outside their channels.
 */
const getAttachmentUrl = asyncHandler(async (req, res) => {
  const row = await req.db(
    `SELECT a.*, m.channel_id
       FROM message_attachments a
       LEFT JOIN messages m ON m.id = a.message_id
      WHERE a.id = $1 AND a.finalized_at IS NOT NULL`,
    [req.params.id],
  );
  if (!row.rows.length) return notFound(res, 'Attachment not found');
  const att = row.rows[0];

  // Uploader can always fetch their own uploads (covers the pre-send preview
  // case where message_id is still NULL).
  const isUploader = att.uploader_id === req.user.id;
  if (!isUploader) {
    if (!att.channel_id) return forbidden(res);
    const member = await loadMember(req, att.channel_id, req.user.id);
    if (!member && !isOrgAdmin(req.user)) return forbidden(res);
  }

  const s3 = getR2Client();
  if (!s3) return res.status(501).json({ error: 'Attachment storage not configured on this server' });
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: att.storage_key }),
    { expiresIn: 300 },
  );
  res.json({ url, expires_in: 300, mime_type: att.mime_type, file_name: att.file_name, kind: att.kind });
});

// ─── Typing (transient, not persisted) ───────────────────────────────────────

const publishTyping = asyncHandler(async (req, res) => {
  const rd = await requireChannelReader(req, res, req.params.id);
  if (!rd) return;
  publish(`org#${req.user.org_id}#comms#${req.params.id}`, {
    type: 'typing',
    channel_id: req.params.id,
    user_id: req.user.id,
    user_name: req.user.name,
    at: Date.now(),
  });
  res.json({ ok: true });
});

module.exports = {
  listOrgUsers,
  listChannels, createChannel, deleteChannel,
  listMembers, addMembers, removeMember, updateMember, toggleMute, markRead,
  listMessages, sendMessage, deleteMessage, getThread,
  addReaction, removeReaction,
  listPinned, addPin, removePin,
  searchMessages,
  presignAttachment, finalizeAttachment, getAttachmentUrl,
  publishTyping,
};
