const router = require('express').Router();
const aiClient = require('../utils/aiClient');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { runDecisionFabric } = require('../services/aiSwarm');
const { TOOL_DEFINITION: WORLD_CONTEXT_TOOL, toolGetWorldContext } = require('../services/spatial/copilotWorldContextTool');

// RESTORED_STUB — full file restore in progress
module.exports = router;
