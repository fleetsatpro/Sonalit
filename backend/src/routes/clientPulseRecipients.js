const router = require('express').Router();
const { withOrg } = require('../utils/orgScopedDb');
const { authorize } = require('../middleware/auth');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
router.use(authorize('admin', 'super_admin'));
function uuid(value, name) { if (value == null || UUID_RE.test(String(value))) return null; return `"${name}" must be a valid UUID`; }
async function disableCdsPulseForOtherCustomers(c, orgId, recipientId, keepCustomerId) {
  await c.query(`UPDATE communication_subscriptions s SET enabled=FALSE,updated_at=NOW() FROM communication_enrollments e WHERE e.id=s.enrollment_id AND e.org_id=$1 AND e.recipient_id=$2 AND e.domain='cds' AND ($3::uuid IS NULL OR e.cds_customer_id<>$3::uuid) AND s.event_type='cds.client_pulse' AND s.channel='email'`, [orgId, recipientId, keepCustomerId || null]);
  await c.query(`UPDATE communication_enrollments e SET status='revoked',revoked_at=NOW(),updated_at=NOW() WHERE e.org_id=$1 AND e.recipient_id=$2 AND e.domain='cds' AND ($3::uuid IS NULL OR e.cds_customer_id<>$3::uuid) AND e.status IN ('draft','pending_verification','active','verified')`, [orgId, recipientId, keepCustomerId || null]);
}
async function bindCdsRecipient(c, orgId, recipientId, cdsCustomerId) {
  if (!cdsCustomerId) return null;
  const customer = await c.query(`SELECT id,company_name FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1`, [cdsCustomerId, orgId]);
  if (!customer.rows.length) { const e = new Error('cds_customer_not_found'); e.status = 404; throw e; }
  await disableCdsPulseForOtherCustomers(c, orgId, recipientId, cdsCustomerId);
  const existing = await c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 AND recipient_id=$2 AND domain='cds' AND cds_customer_id=$3 LIMIT 1`, [orgId, recipientId, cdsCustomerId]);
  let enrollment;
  if (existing.rows.length) enrollment = (await c.query(`UPDATE communication_enrollments SET status='active',contact_role='client_pulse',revoked_at=NULL,suspended_at=NULL,verified_at=COALESCE(verified_at,NOW()),updated_at=NOW() WHERE id=$1 RETURNING *`, [existing.rows[0].id])).rows[0];
  else enrollment = (await c.query(`INSERT INTO communication_enrollments (org_id,recipient_id,domain,cds_customer_id,contact_role,status) VALUES($1,$2,'cds',$3,'client_pulse','active') RETURNING *`, [orgId, recipientId, cdsCustomerId])).rows[0];
  await c.query(`INSERT INTO communication_subscriptions (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override) VALUES($1,$2,'cds.client_pulse','email','immediate',TRUE,TRUE) ON CONFLICT(enrollment_id,event_type,channel) DO UPDATE SET enabled=TRUE,delivery_mode='immediate',critical_override=TRUE,updated_at=NOW()`, [orgId, enrollment.id]);
  return { id: customer.rows[0].id, company_name: customer.rows[0].company_name, enrollment_id: enrollment.id };
}
async function resolveCustomer(c, orgId, cdsCustomerId, company) {
  if (cdsCustomerId) { const e = uuid(cdsCustomerId, 'cds_customer_id'); if (e) { const err = new Error(e); err.status = 400; throw err; } return cdsCustomerId; }
  if (!company || !String(company).trim()) return null;
  const q = await c.query(`SELECT id FROM cds_customers WHERE org_id=$1 AND deleted_at IS NULL AND lower(trim(company_name))=lower(trim($2)) ORDER BY created_at ASC`, [orgId, String(company).trim()]);
  return q.rows.length === 1 ? q.rows[0].id : null;
}
async function readRecipients(orgId) {
  return withOrg(orgId, c => c.query(`SELECT r.id,r.org_id,r.email,r.name,r.company,r.enabled,r.authority_role,r.client_id,r.cds_customer_id,r.sonalit_operational,r.sonalit_security,r.cds_client_pulse,cu.company_name AS cds_customer_name,COALESCE(json_agg(json_build_object('id',e.id,'domain',e.domain,'client_id',e.client_id,'cds_customer_id',e.cds_customer_id,'contact_role',e.contact_role,'locale',e.locale,'timezone',e.timezone,'status',e.status,'subscriptions',COALESCE((SELECT json_agg(json_build_object('id',s.id,'event_type',s.event_type,'channel',s.channel,'enabled',s.enabled,'delivery_mode',s.delivery_mode,'critical_override',s.critical_override) ORDER BY s.event_type,s.channel) FROM communication_subscriptions s WHERE s.enrollment_id=e.id),'[]'::json))) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL),'[]'::json) AS enrollments FROM client_email_recipients r LEFT JOIN cds_customers cu ON cu.id=r.cds_customer_id AND cu.org_id=r.org_id AND cu.deleted_at IS NULL LEFT JOIN communication_enrollments e ON e.org_id=r.org_id AND e.recipient_id=r.id WHERE r.org_id=$1 AND r.deleted_at IS NULL GROUP BY r.id,cu.company_name ORDER BY lower(COALESCE(r.name,r.email)),lower(r.email)`, [orgId]));
}
router.get('/email-recipients', async (req,res,next) => { try { res.json({data:(await readRecipients(req.user.org_id)).rows}); } catch(e) { next(e); } });
async function save(req,res,next) {
  try {
    const allowed=new Set(['email','name','company','enabled','cds_customer_id','cds_client_pulse','sonalit_operational','sonalit_security']); const unknown=Object.keys(req.body||{}).filter(k=>!allowed.has(k)); if(unknown.length)return res.status(400).json({error:`"${unknown[0]}" is not allowed`});
    const out=await withOrg(req.user.org_id,async c=>{
      const b=await c.query(`SELECT * FROM client_email_recipients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,[req.params.id,req.user.org_id]); if(!b.rows.length){const e=new Error('recipient_not_found');e.status=404;throw e;} const current=b.rows[0];
      const requestedCustomer=Object.prototype.hasOwnProperty.call(req.body,'cds_customer_id')?req.body.cds_customer_id:current.cds_customer_id; const customerId=await resolveCustomer(c,req.user.org_id,requestedCustomer,req.body.company??current.company);
      const pulse=Object.prototype.hasOwnProperty.call(req.body,'cds_client_pulse') ? req.body.cds_client_pulse!==false : current.cds_client_pulse;
      const enabled=Object.prototype.hasOwnProperty.call(req.body,'enabled') ? req.body.enabled!==false : current.enabled;
      const u=await c.query(`UPDATE client_email_recipients SET email=COALESCE($2,email),name=COALESCE($3,name),company=COALESCE($4,company),enabled=$5,cds_customer_id=$6,cds_client_pulse=$7,sonalit_operational=COALESCE($8,sonalit_operational),sonalit_security=COALESCE($9,sonalit_security),updated_at=NOW() WHERE id=$1 AND org_id=$10 RETURNING id,org_id,email,name,company,enabled,authority_role,client_id,cds_customer_id,sonalit_operational,sonalit_security,cds_client_pulse`,[req.params.id,req.body.email==null?null:String(req.body.email).trim().toLowerCase(),req.body.name??null,req.body.company??null,enabled,customerId,pulse,req.body.sonalit_operational==null?null:req.body.sonalit_operational!==false,req.body.sonalit_security==null?null:req.body.sonalit_security===true,req.user.org_id]); const row=u.rows[0];
      if(row.authority_role!=='super_admin') {
        if(row.cds_customer_id&&row.cds_client_pulse&&row.enabled) await bindCdsRecipient(c,req.user.org_id,row.id,row.cds_customer_id);
        else await disableCdsPulseForOtherCustomers(c,req.user.org_id,row.id,null);
      }
      return row;
    }); const rows=(await readRecipients(req.user.org_id)).rows; res.json({data:rows.find(r=>r.id===out.id)||out});
  } catch(e){next(e);}
}
router.patch('/email-recipients/:id',save); router.put('/email-recipients/:id',save);
router.post('/email-recipients',async(req,res,next)=>{try{const{email,name=null,company=null,enabled=true,cds_customer_id=null,cds_client_pulse=true,sonalit_operational=true,sonalit_security=false}=req.body||{};if(!email||!String(email).trim())return res.status(400).json({error:'email is required'});const e=uuid(cds_customer_id,'cds_customer_id');if(e)return res.status(400).json({error:e});const result=await withOrg(req.user.org_id,async c=>{const customerId=await resolveCustomer(c,req.user.org_id,cds_customer_id,company);const q=await c.query(`INSERT INTO client_email_recipients(org_id,email,name,company,enabled,cds_customer_id,cds_client_pulse,sonalit_operational,sonalit_security) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(org_id,email) DO UPDATE SET name=EXCLUDED.name,company=EXCLUDED.company,enabled=EXCLUDED.enabled,cds_customer_id=COALESCE(EXCLUDED.cds_customer_id,client_email_recipients.cds_customer_id),cds_client_pulse=EXCLUDED.cds_client_pulse,sonalit_operational=EXCLUDED.sonalit_operational,sonalit_security=EXCLUDED.sonalit_security,updated_at=NOW(),deleted_at=NULL RETURNING id,org_id,email,name,company,enabled,authority_role,client_id,cds_customer_id,sonalit_operational,sonalit_security,cds_client_pulse`,[req.user.org_id,String(email).trim().toLowerCase(),name,company,enabled!==false,customerId,cds_client_pulse!==false,sonalit_operational!==false,sonalit_security===true]);const row=q.rows[0];if(row.authority_role!=='super_admin'){if(row.cds_customer_id&&row.cds_client_pulse&&row.enabled)await bindCdsRecipient(c,req.user.org_id,row.id,row.cds_customer_id);else await disableCdsPulseForOtherCustomers(c,req.user.org_id,row.id,null);}return row;});const rows=(await readRecipients(req.user.org_id)).rows;res.status(201).json({data:rows.find(r=>r.id===result.id)||result});}catch(e){next(e);}});
module.exports=router;
