const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { verifySecurityMapToken, renderSecurityMap } = require('../services/securityIncidentMap');

router.get('/security-map/:panicId', async (req, res) => {
  const panicId = String(req.params.panicId || '');
  const token = String(req.query.token || '');
  if (!verifySecurityMapToken(token, panicId)) return res.status(403).send('Invalid or expired map token');

  try {
    const image = await renderSecurityMap(panicId);
    if (!image) return res.status(404).send('Incident location unavailable');
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': String(image.length),
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline; filename="sonalit-security-incident.png"',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(image);
  } catch (error) {
    logger.error(`Security incident map render failed: event=${panicId} error=${error.message}`);
    return res.status(502).send('Incident map temporarily unavailable');
  }
});

module.exports = router;
