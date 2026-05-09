const router = require('express').Router();
const c = require('../controllers/messageController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/channels', c.getChannels);
router.get('/channels/:id', c.getChannelMessages);
router.post('/channels/:id', c.sendMessage);
router.post('/broadcast', authorize('admin', 'dispatcher'), c.broadcast);

module.exports = router;
