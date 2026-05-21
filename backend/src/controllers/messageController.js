const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS channels (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      sender_id  UUID NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id)`);
  // Seed default channels
  await query(`
    INSERT INTO channels (name, description) VALUES
      ('general',    'General fleet communications'),
      ('dispatch',   'Dispatch and routing updates'),
      ('emergency',  'Emergency and incident alerts'),
      ('logistics',  'Logistics and delivery coordination')
    ON CONFLICT (name) DO NOTHING
  `);
}

ensureTables().catch((err) => console.error('[messages] Schema setup error:', err.message));

const getChannels = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM channels ORDER BY name ASC');
  res.json({ data: result.rows });
});

const getChannelMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const channel = await query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
  if (!channel.rows.length) return res.status(404).json({ error: 'Channel not found' });

  const countResult = await query('SELECT COUNT(*) FROM messages WHERE channel_id = $1', [req.params.id]);
  const result = await query(
    `SELECT m.*, u.name AS sender_name, u.role AS sender_role
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.channel_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, limit, offset]
  );

  const total = parseInt(countResult.rows[0].count);
  res.json({
    data: result.rows.reverse(),
    channel: channel.rows[0],
    pagination: { page, limit, totalCount: total, totalPages: Math.ceil(total / limit) },
  });
});

const sendMessage = asyncHandler(async (req, res) => {
  const schema = Joi.object({ content: Joi.string().min(1).max(2000).required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const channel = await query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
  if (!channel.rows.length) return res.status(404).json({ error: 'Channel not found' });

  const result = await query(
    `INSERT INTO messages (channel_id, sender_id, content, created_at)
     VALUES ($1, $2, $3, NOW()) RETURNING *`,
    [req.params.id, req.user.id, value.content]
  );

  const message = { ...result.rows[0], sender_name: req.user.name, sender_role: req.user.role };

  publish('message:new', { channelId: req.params.id, content: value.content, senderId: req.user.id, senderName: req.user.name });

  res.status(201).json({ data: message });
});

const broadcast = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    content: Joi.string().min(1).max(2000).required(),
    severity: Joi.string().valid('info', 'warning', 'critical').default('info'),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  // Single atomic multi-row insert — one row per channel, all-or-nothing.
  const result = await query(
    `INSERT INTO messages (channel_id, sender_id, content, created_at)
     SELECT id, $1, $2, NOW() FROM channels
     RETURNING id`,
    [req.user.id, `[BROADCAST] ${value.content}`]
  );
  const inserted = result.rows.map((r) => r.id);

  publish('message:new', {
    channelId: 'broadcast',
    content: value.content,
    severity: value.severity,
    senderId: req.user.id,
    senderName: req.user.name,
    isBroadcast: true,
  });

  res.json({ message: `Broadcast sent to ${inserted.length} channel(s)`, messageIds: inserted });
});

module.exports = { getChannels, getChannelMessages, sendMessage, broadcast };
