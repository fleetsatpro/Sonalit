const router = require('express').Router();
const { login, getCurrentUser, logout, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.post('/login', login);
router.get('/me', authenticate, getCurrentUser);
router.post('/logout', authenticate, logout);
router.put('/change-password', authenticate, auditLog('users'), changePassword);

module.exports = router;
