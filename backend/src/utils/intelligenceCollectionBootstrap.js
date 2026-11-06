/*
 * Tenant-scoped manual Intelligence Collection Fabric runner.
 * Recurring platform-wide collection is owned by the application scheduler.
 * Public/authorized collection only; provider failures are isolated.
 */
require('dotenv').config();
const logger = require('./logger');
const { runCollectionFabric } = require('./collectionFabric');

async function runCollection(orgId) {
  if (typeof orgId !== 'string' || !orgId.trim()) return { error: 'tenant_scope_required' };
  try {
    return await runCollectionFabric({ orgIds: [orgId.trim()] });
  } catch (err) {
    logger.warn(`Intelligence Collection Fabric runner failed for tenant: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { runCollection };
