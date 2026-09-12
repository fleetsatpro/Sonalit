/*
 * Intelligence Collection Fabric runner.
 * Public/authorized collection only. Provider failures are isolated.
 * The application scheduler owns recurring execution; this module is the explicit/manual runner.
 */
require('dotenv').config();
const logger = require('./logger');
const { runCollectionFabric } = require('./collectionFabric');

async function runCollection() {
  try {
    return await runCollectionFabric();
  } catch (err) {
    logger.warn(`Intelligence Collection Fabric runner failed: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { runCollection };
