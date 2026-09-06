/**
 * Ops Comms router (mounted at /api/v1/messages by app.js).
 *
 * All endpoints require authenticate(). Membership + role checks live in
 * the controller because they need per-request DB lookups.
 */
const router = require('express').Router();
const c = require('../controllers/messageController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ─── Org directory (mention picker + add-people pickers) ────────────────────
router.get('/org-users',            c.listOrgUsers);

// ─── Channels ────────────────────────────────────────────────────────────────
router.get('/channels',             c.listChannels);
router.post('/channels',            c.createChannel);
router.delete('/channels/:id',      c.deleteChannel);

// ─── Membership + per-user channel state ─────────────────────────────────────
router.get('/channels/:id/members',                    c.listMembers);
router.post('/channels/:id/members',                   c.addMembers);
router.patch('/channels/:id/members/:userId',          c.updateMember);
router.delete('/channels/:id/members/:userId',         c.removeMember);
router.patch('/channels/:id/mute',                     c.toggleMute);
router.patch('/channels/:id/read',                     c.markRead);

// ─── Messages ────────────────────────────────────────────────────────────────
router.get('/channels/:id/messages',                        c.listMessages);
router.post('/channels/:id/messages',                       c.sendMessage);
router.delete('/channels/:id/messages/:msgId',              c.deleteMessage);
router.get('/channels/:id/messages/:msgId/thread',          c.getThread);
router.post('/channels/:id/messages/:msgId/reactions',      c.addReaction);
router.delete('/channels/:id/messages/:msgId/reactions/:emoji', c.removeReaction);

// ─── Pinned ──────────────────────────────────────────────────────────────────
router.get('/channels/:id/pinned',                     c.listPinned);
router.post('/channels/:id/pinned',                    c.addPin);
router.delete('/channels/:id/pinned/:messageId',       c.removePin);

// ─── Search (per-channel, real DB fallback for scrolled-off history) ─────────
router.get('/channels/:id/search',                     c.searchMessages);

// ─── Typing indicator (transient, no persistence) ────────────────────────────
router.post('/channels/:id/typing',                    c.publishTyping);

// ─── Attachments ─────────────────────────────────────────────────────────────
router.post('/attachments/presign',                    c.presignAttachment);
router.post('/attachments/:id/finalize',               c.finalizeAttachment);
router.get('/attachments/:id/url',                     c.getAttachmentUrl);

module.exports = router;
