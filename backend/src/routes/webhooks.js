const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', (req, res) => res.json({ data: [] }));
module.exports = router;
