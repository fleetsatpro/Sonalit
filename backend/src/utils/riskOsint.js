let sweeping = false;
const isSweeping = () => sweeping;

async function runOsintSweep() {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    const { rows: orgRows } = await globalQuery(
      `SELECT DISTINCT org_id FROM risk_zones WHERE is_active = true AND org_id IS NOT NULL`
    );
    if (!orgRows.length) return { zonesChecked: 0 };

    // Enumerate tenant ids globally, but fetch tenant data only inside that
    // tenant's RLS context. Never batch multiple customers' zone metadata into
    // one external AI request.
    const zonesByOrg = new Map();
    for (const { org_id: orgId } of orgRows) {
      await withOrg(orgId, async () => {
        const { rows } = await query(
          `SELECT id, org_id, name, region, continent, level, confidence, velocity, level_source, lat, lng
             FROM risk_zones
            WHERE is_active = true AND org_id = $1`,
          [orgId]
        );
        zonesByOrg.set(orgId, rows);
      });
    }
    const tenantZones = [...zonesByOrg.values()].flat();

    const claudeEnabled = process.env.RISK_INTEL_ENABLE_CLAUDE === 'true';
    const claudeByZone = {};
    if (claudeEnabled && aiClient.hasAnthropic()) {
      for (const [orgId, orgZones] of zonesByOrg) {
        try {
          const scoped = await fetchClaudeForZones(orgZones);
          Object.assign(claudeByZone, scoped);
        } catch (e) {
          logger.warn(`Risk Intel OSINT: Claude web search sweep failed for org=${orgId}: ${e.message}`);
        }
      }
    }

    let acledToken = null;
    try { acledToken = await getAcledToken(); }
    catch (e) { logger.warn(`Risk Intel OSINT: ACLED auth failed: ${e.message}`); }
