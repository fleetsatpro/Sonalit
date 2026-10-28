'use strict';

const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');
const { reportSnapshot, dateInTimezone } = require('../routes/secureJourneyManagement').__scheduler;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configuredOrgIds(value=process.env.SJM_REPORT_SCHEDULER_ORG_IDS||'') {
  const raw=String(value).split(',').map(x=>x.trim()).filter(Boolean);
  if(!raw.length)return [];
  if(raw.some(x=>!UUID.test(x)))throw new Error('SJM_REPORT_SCHEDULER_ORG_IDS contains an invalid UUID; scheduler remains disabled.');
  return [...new Set(raw.map(x=>x.toLowerCase()))];
}
function localClock(now,timezone) {
  const date=dateInTimezone(now,timezone);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const value=type=>parts.find(p=>p.type===type)?.value||'00';
  return {date,minute:Number(value('hour'))*60+Number(value('minute'))};
}
function shouldGenerateForToday(now,time,timezone) {
  try {
    const local=localClock(now,timezone);
    const parts=String(time||'18:00').slice(0,5).split(':').map(Number);
    if(parts.length!==2||!Number.isInteger(parts[0])||!Number.isInteger(parts[1])||parts[0]>23||parts[1]>59)return false;
    return local.minute>=parts[0]*60+parts[1];
  } catch (_) { return false; }
}
async function runForOrganisation(orgId,now) {
  return withOrg(orgId,async client=>{
    const db=(sql,params)=>client.query(sql,params);
    const profiles=await db(
      'SELECT client_id,report_timezone,daily_report_local_time FROM sjm_client_profiles WHERE org_id=$1 AND daily_reports_enabled=true ORDER BY client_id',
      [orgId],
    );
    let generated=0,skipped=0;
    for(const profile of profiles.rows) {
      const timezone=profile.report_timezone||'Africa/Nairobi';
      if(!shouldGenerateForToday(now,profile.daily_report_local_time,timezone)){skipped++;continue;}
      let reportDate;
      try { reportDate=dateInTimezone(now,timezone); }
      catch (error) { logger.warn({org_id:orgId,client_id:profile.client_id,error:error.message},'SJM daily report skipped: invalid client timezone');continue; }
      const journeys=await db(
        'SELECT j.*,c.name AS client_name,c.company AS client_company,v.name AS convoy_name '+
        'FROM sjm_journeys j '+
        'LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL '+
        'LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL '+
        'WHERE j.org_id=$1 AND j.client_id=$2 AND j.deleted_at IS NULL '+
        'AND (j.status IN (\'approved\',\'ready_to_depart\',\'in_progress\',\'paused\',\'exception\',\'arrival_pending_verification\') '+
        'OR (j.status=\'closed\' AND j.closed_at IS NOT NULL AND (j.closed_at AT TIME ZONE $3)::date=$4::date)) '+
        'AND (j.started_at IS NOT NULL OR j.planned_departure_at IS NULL OR (j.planned_departure_at AT TIME ZONE $3)::date <= $4::date) '+
        'ORDER BY j.planned_departure_at ASC NULLS LAST,j.created_at ASC',
        [orgId,profile.client_id,timezone,reportDate],
      );
      for(const journey of journeys.rows) {
        const snapshot=await reportSnapshot(db,orgId,journey,'daily',reportDate);
        const inserted=await db(
          'INSERT INTO sjm_reports (org_id,journey_id,report_type,report_date,schema_version,data,generated_by,generation_source) '+
          'VALUES ($1,$2,\'daily\',$3,$4,$5,NULL,\'scheduled\') '+
          'ON CONFLICT (org_id,journey_id,report_type,report_date) '+
          'WHERE generation_source=\'scheduled\' AND report_type=\'daily\' DO NOTHING RETURNING id',
          [orgId,journey.id,reportDate,snapshot.schema_version,JSON.stringify(snapshot)],
        );
        if(!inserted.rows.length){skipped++;continue;}
        await db(
          'INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) '+
          'VALUES ($1,$2,NULL,\'daily_report_generated\',$3,$4,\'system\')',
          [orgId,journey.id,'Scheduled daily journey report generated',JSON.stringify({report_id:inserted.rows[0].id,report_date:reportDate,timezone,generation_source:'scheduled'})],
        );
        generated++;
      }
    }
    return {generated,skipped};
  });
}
async function runScheduledDailyReports({orgIds=configuredOrgIds(),now=new Date()}={}) {
  const result={organisations:0,generated:0,skipped:0,errors:0};
  for(const orgId of orgIds) {
    try {
      const one=await runForOrganisation(orgId,now);
      result.organisations++;result.generated+=one.generated;result.skipped+=one.skipped;
    } catch(error) {
      result.errors++;
      logger.error({org_id:orgId,error:error.message},'SJM scheduled report generation failed');
    }
  }
  return result;
}
function startSjmDailyReportScheduler({isActive=()=>true}={}) {
  const orgIds=configuredOrgIds();
  if(!orgIds.length) {
    logger.info('SJM scheduled report generation disabled: set SJM_REPORT_SCHEDULER_ORG_IDS to an explicit UUID allowlist; external delivery is not part of this scheduler.');
    return null;
  }
  const cron=require('node-cron');
  const task=cron.schedule('*/15 * * * *',async()=>{
    if(!isActive())return;
    const result=await runScheduledDailyReports({orgIds,now:new Date()});
    if(result.generated||result.errors)logger.info({ ...result },'SJM scheduled daily report run finished');
  });
  logger.info({organisations:orgIds.length},'SJM scheduled daily report generation registered (15-minute due scan, client-local schedule)');
  return task;
}
module.exports={configuredOrgIds,localClock,shouldGenerateForToday,runScheduledDailyReports,startSjmDailyReportScheduler};
