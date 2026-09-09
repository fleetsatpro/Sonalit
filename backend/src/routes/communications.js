const router = require('express').Router();
const { withOrg } = require('../utils/orgScopedDb');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['draft','pending_verification','verified','active','suspended','revoked']);
const CHANNELS = new Set(['email','sms','whatsapp','portal','web']);
const MODES = new Set(['immediate','digest','batched']);
const DOMAINS = new Set(['platform','fleet','cds']);

function actor(req) { return req.user?.id || req.user?.user_id || null; }
function assertUuid(value, name) {
  return value == null || UUID_RE.test(String(value)) ? null : `"${name}" must be a valid UUID`;
}

async function audit(c, req, { action, entityType, entityId = null, domain = null, clientId = null, cdsCustomerId = null, before = null, after = null, metadata = {} }) {
  await c.query(`INSERT INTO communication_authority_audit
    (org_id,actor_user_id,action,entity_type,entity_id,scope_domain,scope_client_id,scope_cds_customer_id,before_state,after_state,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)`, [
    req.user.org_id, actor(req), action, entityType, entityId, domain, clientId, cdsCustomerId,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), JSON.stringify(metadata),
  ]);
}

function validateEnrollment(body) {
  const allowed = new Set(['recipient_id','domain','client_id','cds_customer_id','contact_role','locale','timezone','status']);
  const unknown = Object.keys(body || {}).filter(k => !allowed.has(k));
  if (unknown.length) return { error: `"${unknown[0]}" is not allowed` };
  for (const key of ['recipient_id','client_id','cds_customer_id']) {
    const error = assertUuid(body[key], key);
    if (error) return { error };
  }
  if (!body.recipient_id) return { error: '"recipient_id" is required' };
  if (!body.domain) return { error: '"domain" is required' };
  if (!DOMAINS.has(body.domain)) return { error: '"domain" must be one of [platform, fleet, cds]' };
  if (body.status != null && !STATUSES.has(body.status)) return { error: 'invalid enrollment status' };
  if (body.domain === 'cds') {
    if (!body.cds_customer_id) return { error: '"cds_customer_id" is required for CDS enrollment' };
    if (body.client_id != null) return { error: '"client_id" is not allowed for CDS enrollment' };
  }
  if (body.domain === 'fleet' && body.cds_customer_id != null) return { error: '"cds_customer_id" is not allowed for Fleet enrollment' };
  if (body.domain === 'platform' && (body.client_id != null || body.cds_customer_id != null)) return { error: '"client_id" and "cds_customer_id" are not allowed for platform enrollment' };
  return null;
}

router.get('/recipients', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`
      SELECT r.id, r.email, r.name, r.company, r.enabled, r.authority_role, r.client_id,
             COALESCE(json_agg(json_build_object(
               'id', e.id, 'domain', e.domain, 'client_id', e.client_id,
               'cds_customer_id', e.cds_customer_id, 'contact_role', e.contact_role,
               'locale', e.locale, 'timezone', e.timezone, 'status', e.status,
               'subscriptions', COALESCE((SELECT json_agg(json_build_object(
                 'id', s.id, 'event_type', s.event_type, 'channel', s.channel,
                 'enabled', s.enabled, 'delivery_mode', s.delivery_mode,
                 'critical_override', s.critical_override
               ) ORDER BY s.event_type, s.channel) FROM communication_subscriptions s WHERE s.enrollment_id=e.id), '[]'::json)
             ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS enrollments
        FROM client_email_recipients r
        LEFT JOIN communication_enrollments e ON e.org_id=r.org_id AND e.recipient_id=r.id
       WHERE r.org_id=$1 AND r.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY lower(COALESCE(r.name, r.email)), lower(r.email)`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.patch('/recipients/:id', async (req, res, next) => {
  try {
    const allowed = new Set(['email','name','company','enabled']);
    const unknown = Object.keys(req.body || {}).filter(k => !allowed.has(k));
    if (unknown.length) return res.status(400).json({ error: `"${unknown[0]}" is not allowed` });
    if (req.body.email != null && !String(req.body.email).trim()) return res.status(400).json({ error: 'email cannot be empty' });
    const result = await withOrg(req.user.org_id, async c => {
      const before = await c.query(`SELECT id,email,name,company,enabled FROM client_email_recipients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
      if (!before.rows.length) { const e = new Error('recipient_not_found'); e.status = 404; throw e; }
      const current = before.rows[0];
      const updated = await c.query(`UPDATE client_email_recipients SET email=COALESCE($2,email), name=COALESCE($3,name), company=COALESCE($4,company), enabled=COALESCE($5,enabled), updated_at=NOW() WHERE id=$1 AND org_id=$6 RETURNING id,email,name,company,enabled,authority_role,client_id`, [
        req.params.id, req.body.email == null ? null : String(req.body.email).trim().toLowerCase(), req.body.name == null ? null : req.body.name, req.body.company == null ? null : req.body.company, req.body.enabled == null ? null : req.body.enabled !== false, req.user.org_id,
      ]);
      await audit(c, req, { action: 'recipient.updated', entityType: 'recipient', entityId: req.params.id, before: current, after: updated.rows[0] });
      return updated;
    });
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.post('/recipients', async (req, res, next) => {
  try {
    const { email, name = null, company = null, enabled = true } = req.body || {};
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email is required' });
    const result = await withOrg(req.user.org_id, async c => {
      const inserted = await c.query(`
        INSERT INTO client_email_recipients (org_id, email, name, company, enabled)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (org_id, email) DO UPDATE SET name=EXCLUDED.name, company=EXCLUDED.company, enabled=EXCLUDED.enabled, updated_at=NOW(), deleted_at=NULL
        RETURNING id, org_id, email, name, company, enabled, client_id, authority_role`,
        [req.user.org_id, String(email).trim().toLowerCase(), name, company, enabled !== false]);
      await audit(c, req, { action: 'recipient.created_or_restored', entityType: 'recipient', entityId: inserted.rows[0].id, after: inserted.rows[0] });
      return inserted;
    });
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.post('/enrollments', async (req, res, next) => {
  try {
    const error = validateEnrollment(req.body);
    if (error) return res.status(400).json({ error: error.error, details: error.error });
    const { recipient_id, domain, client_id = null, cds_customer_id = null, contact_role = null, locale = null, timezone = null, status = 'pending_verification' } = req.body;
    const result = await withOrg(req.user.org_id, async c => {
      const recipient = await c.query(`SELECT id FROM client_email_recipients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [recipient_id, req.user.org_id]);
      if (!recipient.rows.length) { const e = new Error('recipient_not_found'); e.status = 404; throw e; }
      if (client_id) {
        const client = await c.query(`SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [client_id, req.user.org_id]);
        if (!client.rows.length) { const e = new Error('client_not_found'); e.status = 404; throw e; }
      }
      if (cds_customer_id) {
        const customer = await c.query(`SELECT id FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [cds_customer_id, req.user.org_id]);
        if (!customer.rows.length) { const e = new Error('cds_customer_not_found'); e.status = 404; throw e; }
      }
      const existing = await c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 AND recipient_id=$2 AND domain=$3 AND COALESCE(cds_customer_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`, [req.user.org_id, recipient_id, domain, cds_customer_id]);
      if (existing.rows.length) {
        const updated = await c.query(`UPDATE communication_enrollments SET client_id=$2, contact_role=$3, locale=$4, timezone=$5, status=$6, updated_at=NOW() WHERE id=$1 RETURNING *`, [existing.rows[0].id, client_id, contact_role, locale, timezone, status]);
        await audit(c, req, { action: 'enrollment.updated', entityType: 'enrollment', entityId: existing.rows[0].id, domain, clientId, cdsCustomerId: cds_customer_id, before: existing.rows[0], after: updated.rows[0] });
        return updated;
      }
      const inserted = await c.query(`INSERT INTO communication_enrollments (org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.user.org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status]);
      if (client_id) await c.query(`UPDATE client_email_recipients SET client_id=$2, updated_at=NOW() WHERE id=$1 AND org_id=$3`, [recipient_id, client_id, req.user.org_id]);
      await audit(c, req, { action: 'enrollment.created', entityType: 'enrollment', entityId: inserted.rows[0].id, domain, clientId: client_id, cdsCustomerId: cds_customer_id, after: inserted.rows[0] });
      return inserted;
    });
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/enrollments', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 ORDER BY created_at DESC`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.patch('/enrollments/:id', async (req, res, next) => {
  try {
    const allowed = new Set(['status','contact_role','locale','timezone']);
    const unknown = Object.keys(req.body || {}).filter(k => !allowed.has(k));
    if (unknown.length) return res.status(400).json({ error: `"${unknown[0]}" is not allowed` });
    if (req.body.status != null && !STATUSES.has(req.body.status)) return res.status(400).json({ error: 'invalid enrollment status' });
    const result = await withOrg(req.user.org_id, async c => {
      const before = await c.query(`SELECT * FROM communication_enrollments WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id]);
      if (!before.rows.length) return null;
      const updated = await c.query(`UPDATE communication_enrollments SET status=COALESCE($2,status), contact_role=COALESCE($3,contact_role), locale=COALESCE($4,locale), timezone=COALESCE($5,timezone), revoked_at=CASE WHEN $2='revoked' THEN COALESCE(revoked_at,NOW()) ELSE revoked_at END, suspended_at=CASE WHEN $2='suspended' THEN COALESCE(suspended_at,NOW()) ELSE suspended_at END, updated_at=NOW() WHERE id=$1 AND org_id=$6 RETURNING *`, [req.params.id, req.body.status ?? null, req.body.contact_role ?? null, req.body.locale ?? null, req.body.timezone ?? null, req.user.org_id]);
      await audit(c, req, { action: `enrollment.${req.body.status || 'updated'}`, entityType: 'enrollment', entityId: req.params.id, domain: before.rows[0].domain, clientId: before.rows[0].client_id, cdsCustomerId: before.rows[0].cds_customer_id, before: before.rows[0], after: updated.rows[0] });
      return updated;
    });
    if (!result) return res.status(404).json({ error: 'enrollment_not_found' });
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.put('/enrollments/:id/subscriptions', async (req, res, next) => {
  try {
    const subscriptions = Array.isArray(req.body?.subscriptions) ? req.body.subscriptions : [];
    if (!subscriptions.length) return res.status(400).json({ error: 'subscriptions must contain at least one item' });
    const result = await withOrg(req.user.org_id, async c => {
      const enrollment = await c.query(`SELECT * FROM communication_enrollments WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id]);
      if (!enrollment.rows.length) { const e = new Error('enrollment_not_found'); e.status = 404; throw e; }
      for (const sub of subscriptions) {
        if (!sub?.event_type || !CHANNELS.has(sub.channel || 'email') || !MODES.has(sub.delivery_mode || 'immediate')) {
          const e = new Error('invalid subscription payload'); e.status = 400; throw e;
        }
        await c.query(`INSERT INTO communication_subscriptions (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (enrollment_id,event_type,channel) DO UPDATE SET delivery_mode=EXCLUDED.delivery_mode,enabled=EXCLUDED.enabled,critical_override=EXCLUDED.critical_override,updated_at=NOW()`, [req.user.org_id, req.params.id, String(sub.event_type), sub.channel || 'email', sub.delivery_mode || 'immediate', sub.enabled !== false, sub.critical_override !== false]);
      }
      const rows = await c.query(`SELECT * FROM communication_subscriptions WHERE enrollment_id=$1 ORDER BY event_type,channel`, [req.params.id]);
      await audit(c, req, { action: 'subscription.updated', entityType: 'enrollment', entityId: req.params.id, domain: enrollment.rows[0].domain, clientId: enrollment.rows[0].client_id, cdsCustomerId: enrollment.rows[0].cds_customer_id, metadata: { subscriptions: subscriptions.map(s => ({ event_type: s.event_type, channel: s.channel || 'email', enabled: s.enabled !== false })) }, after: rows.rows });
      return rows;
    });
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.get('/distribution-lists', async (req, res, next) => {
  try {
    const params = [req.user.org_id];
    let scope = '';
    if (req.query.cds_customer_id) { const e = assertUuid(req.query.cds_customer_id, 'cds_customer_id'); if (e) return res.status(400).json({ error: e }); params.push(req.query.cds_customer_id); scope = ' AND l.cds_customer_id=$2'; }
    const result = await withOrg(req.user.org_id, c => c.query(`
      SELECT l.id,l.name,l.description,l.domain,l.client_id,l.cds_customer_id,l.status,l.created_at,l.updated_at,
        COALESCE(json_agg(json_build_object('id',m.id,'enrollment_id',m.enrollment_id,'recipient_id',e.recipient_id,'name',r.name,'email',r.email,'contact_role',e.contact_role,'status',e.status)) FILTER (WHERE m.id IS NOT NULL),'[]'::json) members
      FROM communication_distribution_lists l
      LEFT JOIN communication_distribution_list_members m ON m.distribution_list_id=l.id AND m.org_id=l.org_id
      LEFT JOIN communication_enrollments e ON e.id=m.enrollment_id AND e.org_id=l.org_id
      LEFT JOIN client_email_recipients r ON r.id=e.recipient_id AND r.org_id=l.org_id AND r.deleted_at IS NULL
      WHERE l.org_id=$1${scope}
      GROUP BY l.id ORDER BY lower(l.name)`, params));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post('/distribution-lists', async (req, res, next) => {
  try {
    const { name, description = null, domain = 'cds', client_id = null, cds_customer_id = null } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!DOMAINS.has(domain)) return res.status(400).json({ error: 'invalid domain' });
    for (const [key, value] of [['client_id',client_id],['cds_customer_id',cds_customer_id]]) { const e = assertUuid(value,key); if(e) return res.status(400).json({error:e}); }
    if (domain === 'cds' && (!cds_customer_id || client_id != null)) return res.status(400).json({ error: 'CDS lists require cds_customer_id and no client_id' });
    if (domain === 'fleet' && (!client_id || cds_customer_id != null)) return res.status(400).json({ error: 'Fleet lists require client_id and no cds_customer_id' });
    if (domain === 'platform' && (client_id != null || cds_customer_id != null)) return res.status(400).json({ error: 'Platform lists cannot be customer scoped' });
    const result = await withOrg(req.user.org_id, async c => {
      if (client_id) { const q=await c.query(`SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,[client_id,req.user.org_id]); if(!q.rows.length){const e=new Error('client_not_found');e.status=404;throw e;} }
      if (cds_customer_id) { const q=await c.query(`SELECT id FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,[cds_customer_id,req.user.org_id]); if(!q.rows.length){const e=new Error('cds_customer_not_found');e.status=404;throw e;} }
      const inserted=await c.query(`INSERT INTO communication_distribution_lists (org_id,name,description,domain,client_id,cds_customer_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.user.org_id,String(name).trim(),description,domain,client_id,cds_customer_id,actor(req)]);
      await audit(c,req,{action:'distribution_list.created',entityType:'distribution_list',entityId:inserted.rows[0].id,domain,clientId:client_id,cdsCustomerId:cds_customer_id,after:inserted.rows[0]});
      return inserted;
    });
    res.status(201).json({ data: result.rows[0] });
  } catch(err){ next(err); }
});

router.patch('/distribution-lists/:id', async (req,res,next)=>{
  try {
    const allowed=new Set(['name','description','status']); const unknown=Object.keys(req.body||{}).filter(k=>!allowed.has(k));
    if(unknown.length) return res.status(400).json({error:`"${unknown[0]}" is not allowed`});
    if(req.body.status && !new Set(['active','suspended','archived']).has(req.body.status)) return res.status(400).json({error:'invalid distribution list status'});
    const result=await withOrg(req.user.org_id,async c=>{
      const before=await c.query(`SELECT * FROM communication_distribution_lists WHERE id=$1 AND org_id=$2`,[req.params.id,req.user.org_id]);
      if(!before.rows.length)return null;
      const updated=await c.query(`UPDATE communication_distribution_lists SET name=COALESCE($2,name),description=COALESCE($3,description),status=COALESCE($4,status),updated_at=NOW() WHERE id=$1 AND org_id=$5 RETURNING *`,[req.params.id,req.body.name??null,req.body.description??null,req.body.status??null,req.user.org_id]);
      await audit(c,req,{action:'distribution_list.updated',entityType:'distribution_list',entityId:req.params.id,domain:before.rows[0].domain,clientId:before.rows[0].client_id,cdsCustomerId:before.rows[0].cds_customer_id,before:before.rows[0],after:updated.rows[0]});
      return updated;
    });
    if(!result)return res.status(404).json({error:'distribution_list_not_found'}); res.json({data:result.rows[0]});
  }catch(err){next(err);}
});

router.post('/distribution-lists/:id/members', async(req,res,next)=>{
  try{
    const enrollment_id=req.body?.enrollment_id; const e=assertUuid(enrollment_id,'enrollment_id'); if(e)return res.status(400).json({error:e}); if(!enrollment_id)return res.status(400).json({error:'enrollment_id is required'});
    const result=await withOrg(req.user.org_id,async c=>{
      const list=await c.query(`SELECT * FROM communication_distribution_lists WHERE id=$1 AND org_id=$2`,[req.params.id,req.user.org_id]); if(!list.rows.length){const x=new Error('distribution_list_not_found');x.status=404;throw x;}
      const enrollment=await c.query(`SELECT * FROM communication_enrollments WHERE id=$1 AND org_id=$2`,[enrollment_id,req.user.org_id]); if(!enrollment.rows.length){const x=new Error('enrollment_not_found');x.status=404;throw x;}
      const l=list.rows[0], en=enrollment.rows[0];
      if(l.status==='archived'||en.domain!==l.domain||(l.domain==='cds'&&en.cds_customer_id!==l.cds_customer_id)||(l.domain==='fleet'&&en.client_id!==l.client_id)) return res.status(409).json({error:'distribution_list_scope_mismatch'});
      const inserted=await c.query(`INSERT INTO communication_distribution_list_members (org_id,distribution_list_id,enrollment_id,added_by) VALUES ($1,$2,$3,$4) ON CONFLICT(distribution_list_id,enrollment_id) DO UPDATE SET added_by=EXCLUDED.added_by RETURNING *`,[req.user.org_id,req.params.id,enrollment_id,actor(req)]);
      await audit(c,req,{action:'distribution_list.member_added',entityType:'distribution_list_member',entityId:inserted.rows[0].id,domain:l.domain,clientId:l.client_id,cdsCustomerId:l.cds_customer_id,after:inserted.rows[0]});
      return inserted;
    });
    res.status(201).json({data:result.rows[0]});
  }catch(err){next(err);}
});

router.delete('/distribution-lists/:id/members/:memberId', async(req,res,next)=>{
  try{
    const result=await withOrg(req.user.org_id,async c=>{
      const before=await c.query(`SELECT m.*,l.domain,l.client_id,l.cds_customer_id FROM communication_distribution_list_members m JOIN communication_distribution_lists l ON l.id=m.distribution_list_id WHERE m.id=$1 AND m.distribution_list_id=$2 AND m.org_id=$3`,[req.params.memberId,req.params.id,req.user.org_id]); if(!before.rows.length)return null;
      await c.query(`DELETE FROM communication_distribution_list_members WHERE id=$1 AND org_id=$2`,[req.params.memberId,req.user.org_id]);
      await audit(c,req,{action:'distribution_list.member_removed',entityType:'distribution_list_member',entityId:req.params.memberId,domain:before.rows[0].domain,clientId:before.rows[0].client_id,cdsCustomerId:before.rows[0].cds_customer_id,before:before.rows[0]});
      return before.rows[0];
    });
    if(!result)return res.status(404).json({error:'distribution_list_member_not_found'}); res.status(204).end();
  }catch(err){next(err);}
});

router.post('/distribution-lists/:id/apply-subscriptions', async(req,res,next)=>{
  try{
    const subscriptions=Array.isArray(req.body?.subscriptions)?req.body.subscriptions:[]; if(!subscriptions.length)return res.status(400).json({error:'subscriptions must contain at least one item'});
    for(const sub of subscriptions){if(!sub?.event_type||!CHANNELS.has(sub.channel||'email')||!MODES.has(sub.delivery_mode||'immediate'))return res.status(400).json({error:'invalid subscription payload'});}
    const result=await withOrg(req.user.org_id,async c=>{
      const list=await c.query(`SELECT * FROM communication_distribution_lists WHERE id=$1 AND org_id=$2 AND status='active'`,[req.params.id,req.user.org_id]); if(!list.rows.length){const x=new Error('distribution_list_not_found_or_inactive');x.status=404;throw x;}
      const members=await c.query(`SELECT enrollment_id FROM communication_distribution_list_members WHERE distribution_list_id=$1 AND org_id=$2`,[req.params.id,req.user.org_id]);
      for(const member of members.rows){for(const sub of subscriptions){await c.query(`INSERT INTO communication_subscriptions (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(enrollment_id,event_type,channel) DO UPDATE SET delivery_mode=EXCLUDED.delivery_mode,enabled=EXCLUDED.enabled,critical_override=EXCLUDED.critical_override,updated_at=NOW()`,[req.user.org_id,member.enrollment_id,String(sub.event_type),sub.channel||'email',sub.delivery_mode||'immediate',sub.enabled!==false,sub.critical_override!==false]);}}
      await audit(c,req,{action:'distribution_list.subscriptions_applied',entityType:'distribution_list',entityId:req.params.id,domain:list.rows[0].domain,clientId:list.rows[0].client_id,cdsCustomerId:list.rows[0].cds_customer_id,metadata:{member_count:members.rows.length,subscriptions}});
      return {member_count:members.rows.length};
    });
    res.json({data:result});
  }catch(err){next(err);}
});

router.post('/authority/customers/:id/revoke', async(req,res,next)=>{
  try{
    const result=await withOrg(req.user.org_id,async c=>{
      const customer=await c.query(`SELECT id,company_name FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,[req.params.id,req.user.org_id]); if(!customer.rows.length)return null;
      const before=await c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 AND domain='cds' AND cds_customer_id=$2 AND status NOT IN ('revoked','suspended')`,[req.user.org_id,req.params.id]);
      const updated=await c.query(`UPDATE communication_enrollments SET status='suspended',suspended_at=COALESCE(suspended_at,NOW()),updated_at=NOW() WHERE org_id=$1 AND domain='cds' AND cds_customer_id=$2 AND status NOT IN ('revoked','suspended') RETURNING id`,[req.user.org_id,req.params.id]);
      await audit(c,req,{action:'customer_authority.revoked',entityType:'cds_customer',entityId:req.params.id,domain:'cds',cdsCustomerId:req.params.id,before:before.rows,after:updated.rows,metadata:{reason:req.body?.reason||'operator_revoke'}});
      return {customer:customer.rows[0],suspended:updated.rows.length};
    });
    if(!result)return res.status(404).json({error:'cds_customer_not_found'}); res.json({data:result});
  }catch(err){next(err);}
});

router.post('/authority/customers/:id/restore', async(req,res,next)=>{
  try{
    const result=await withOrg(req.user.org_id,async c=>{
      const customer=await c.query(`SELECT id,company_name FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,[req.params.id,req.user.org_id]); if(!customer.rows.length)return null;
      const before=await c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 AND domain='cds' AND cds_customer_id=$2 AND status='suspended'`,[req.user.org_id,req.params.id]);
      const updated=await c.query(`UPDATE communication_enrollments SET status='active',updated_at=NOW() WHERE org_id=$1 AND domain='cds' AND cds_customer_id=$2 AND status='suspended' RETURNING id`,[req.user.org_id,req.params.id]);
      await audit(c,req,{action:'customer_authority.restored',entityType:'cds_customer',entityId:req.params.id,domain:'cds',cdsCustomerId:req.params.id,before:before.rows,after:updated.rows});
      return {customer:customer.rows[0],restored:updated.rows.length};
    });
    if(!result)return res.status(404).json({error:'cds_customer_not_found'}); res.json({data:result});
  }catch(err){next(err);}
});

router.get('/authority/audit', async(req,res,next)=>{
  try{
    const params=[req.user.org_id]; let filters='';
    if(req.query.cds_customer_id){const e=assertUuid(req.query.cds_customer_id,'cds_customer_id');if(e)return res.status(400).json({error:e});params.push(req.query.cds_customer_id);filters+=' AND (scope_cds_customer_id=$2 OR entity_id=$2)';}
    const result=await withOrg(req.user.org_id,c=>c.query(`SELECT id,actor_user_id,action,entity_type,entity_id,scope_domain,scope_client_id,scope_cds_customer_id,before_state,after_state,metadata,created_at FROM communication_authority_audit WHERE org_id=$1${filters} ORDER BY created_at DESC LIMIT 200`,params));
    res.json({data:result.rows});
  }catch(err){next(err);}
});

router.get('/customers', async (req,res,next)=>{
  try{
    const result=await withOrg(req.user.org_id,c=>c.query(`SELECT id,code,company_name,contact_person,contact_person AS contact_name,email,phone,status FROM cds_customers WHERE org_id=$1 AND deleted_at IS NULL ORDER BY lower(company_name),lower(COALESCE(contact_person,''))`,[req.user.org_id]));
    res.json({data:result.rows});
  }catch(err){next(err);}
});

module.exports = router;
