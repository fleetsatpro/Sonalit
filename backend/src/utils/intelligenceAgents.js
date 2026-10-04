async function publicationForCountry(orgId,country,type='daily'){
  const now=new Date();let start,end;if(type==='daily'){({start,end}=dayBounds(now));}else if(type==='weekly'){const d=new Date(now);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);d.setUTCHours(0,0,0,0);start=d;end=new Date(d.getTime()+7*86400000);}else{start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));}
  const {rows:existing}=await query(`SELECT id,status FROM intel_publications WHERE org_id=$1 AND country_code=$2 AND publication_type=$3 AND period_start=$4 AND period_end=$5 ORDER BY version DESC LIMIT 1`,[orgId,country,type,start,end]);
  if(existing.length)return{status:'exists',id:existing[0].id};
  const {rows:events}=await query(`SELECT e.id,COALESCE(e.canonical_headline,e.title) AS headline,COALESCE(e.executive_brief,e.summary) AS brief,e.severity,e.confidence,e.intelligence_type,e.last_seen_at,e.latitude,e.longitude,COUNT(DISTINCT eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4 GROUP BY e.id ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC LIMIT 40`,[orgId,country,start,end]);
  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);const sourceCount=new Set();for(const e of events){const {rows:s}=await query(`SELECT DISTINCT o.source_id FROM intel_event_observations eo JOIN intel_observations o ON o.id=eo.observation_id WHERE eo.event_id=$1`,[e.id]);for(const x of s)if(x.source_id)sourceCount.add(String(x.source_id));}
  const evidenceContract=evidenceCount>=3&&sourceCount.size>=2;let title=`${COUNTRY_NAMES[country]} Security Intelligence — ${type.toUpperCase()} Report`;
  const baseBody={reporting_standard:'Sonalit Evidence-Governed Intelligence',country_code:country,country_name:COUNTRY_NAMES[country],publication_type:type,period_start:start.toISOString(),period_end:end.toISOString(),executive_assessment:`Collection coverage for ${COUNTRY_NAMES[country]} produced ${events.length} security-relevant event objects during the reporting period.`,key_events:events,collection_coverage:{event_count:events.length,evidence_count:evidenceCount,source_count:sourceCount.size,evidence_contract_met:evidenceContract},sections:['executive_assessment','security_environment','key_events','political_developments','crime_and_public_safety','border_and_transport','natural_hazards','operational_implications','outlook','collection_gaps'],analyst_note:evidenceContract?'Evidence threshold met for automated publication.':'Evidence threshold not met; publication remains a draft for analyst review.'};
  let executive=baseBody.executive_assessment;let subtitle=null;let sections=baseBody.sections;let outlook=[];let board=null;let visual=null;let graphics=null;let provider='multi-agent-editorial-board';
  if((aiClient.hasAnyProvider())&&events.length){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events,baseBody,evidenceContract});
      board=result.board;visual=result.visual;graphics=result.graphics;
      const final=result.final;
      if(final){title=final.title||title;subtitle=final.subtitle||null;executive=final.executive_assessment||executive;sections=final.sections||sections;outlook=final.outlook||[];}
      if(!result.publishable) logger.warn(`Publication editorial board held ${country}/${type}: evidence=${evidenceContract} qa=${result.qa?.publishable===true} blocking=${(result.qa?.blocking_issues||[]).length}`);
    }catch(error){logger.warn(`Publication editorial board failed ${country}/${type}: ${error.message}`);}
  }
  const boardPublishable=board?.publishable===true;
  const status=(evidenceContract&&(!board||boardPublishable))?'published':'draft';
  const body={...baseBody,subtitle,sections,outlook,key_events:events,editorial_board:{agents:AGENT_ROLES.map(a=>a.id),board,visual_plan:visual,graphics_plan:graphics,provider},generator:{name:'SONALIT MULTI-AGENT PUBLICATION BOARD',provider,evidence_contract:evidenceContract}};
  const {rows}=await query(`INSERT INTO intel_publications (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING id,status`,[orgId,country,type,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,status==='published'?new Date():null]);return{status:'created',publication_id:rows[0].id,publication_status:rows[0].status,evidence_contract:evidenceContract,evidence_count:evidenceCount,source_count:sourceCount.size,editorial_agents:AGENT_ROLES.length};
}
async function publishDue(orgId){const results=[];for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'daily')});}catch(error){results.push({country,status:'failed',error:error.message});}}
 const d=new Date();if(d.getUTCDay()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'weekly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 if(d.getUTCDate()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'monthly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 return{processed:results.length,results};}
async function runIntelligenceAgents(){const {rows:orgs}=await globalQuery(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const output=[];for(const {org_id} of orgs){try{const result=await runWithOrgContext(org_id,async()=>{const translation=await translateQueue(org_id);const synthesis=await synthesizeEvents(org_id);const publications=await publishDue(org_id);return{translation,synthesis,publications};});output.push({org_id,...result});}catch(error){output.push({org_id,error:error.message});logger.warn(`Intelligence agents org=${org_id} failed: ${error.message}`);}}return output;}
module.exports={runIntelligenceAgents,translateQueue,synthesizeEvents,publishDue,publicationForCountry,evidenceDerivedSynthesis};async function publicationForCountry(orgId,country,type='daily'){
  const now=new Date();
  let start,end;
  if(type==='daily'){({start,end}=dayBounds(now));}
  else if(type==='weekly'){
    const d=new Date(now);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);d.setUTCHours(0,0,0,0);start=d;end=new Date(d.getTime()+7*86400000);
  } else {
    start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  }
  const {rows:existing}=await query(
    \`SELECT id,status,version FROM intel_publications
      WHERE org_id=$1 AND country_code=$2 AND publication_type=$3 AND period_start=$4 AND period_end=$5
      ORDER BY version DESC LIMIT 1\`,[orgId,country,type,start,end]
  );
  if(existing.length && existing[0].status==='published') return{status:'exists',id:existing[0].id,publication_id:existing[0].id,publication_status:'published',version:existing[0].version||1};

  const {rows:events}=await query(
    \`SELECT
      e.id,COALESCE(e.canonical_headline,e.title) AS headline,
      COALESCE(e.executive_brief,e.summary) AS brief,e.summary,e.title,e.severity,e.confidence,e.intelligence_type,
      e.latitude,e.longitude,e.region,e.risk_velocity,e.occurred_from,e.occurred_to,e.last_seen_at,
      COUNT(DISTINCT eo.observation_id)::int AS observation_count,
      COUNT(DISTINCT o.source_id)::int AS source_count,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'id',o.id,'source_id',o.source_id,'source_name',s.name,
          'title',COALESCE(o.title_en,o.title),'url',o.url,
          'observed_at',o.observed_at,'published_at',o.published_at,'credibility',o.credibility
        )) FILTER (WHERE o.id IS NOT NULL),'[]'::json
      ) AS evidence
      FROM intel_events e
      LEFT JOIN intel_event_observations eo ON eo.event_id=e.id
      LEFT JOIN intel_observations o ON o.id=eo.observation_id
      LEFT JOIN intel_sources s ON s.id=o.source_id
      WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4
      GROUP BY e.id
      ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC
      LIMIT 80\`,[orgId,country,start,end]
  );

  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);
  const sourceIds=new Set();
  for(const e of events) for(const obs of Array.isArray(e.evidence)?e.evidence:[]) if(obs&&obs.source_id) sourceIds.add(String(obs.source_id));
  const sourceCount=sourceIds.size;
  const evidenceContract=evidenceCount>=3&&sourceCount>=2;

  const deterministic=buildEvidencePublication({country,type,start,end,events,evidenceCount,sourceCount,evidenceContract});
  let finalBody=deterministic;
  let title=deterministic.title;
  let subtitle=deterministic.subtitle;
  let executive=deterministic.executive_assessment;
  let board=null,visual=null,graphics=null;
  let provider='evidence-first-fallback';

  if(String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true' && aiClient.hasAnyProvider() && events.length){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events,baseBody:deterministic,evidenceContract});
      board=result.board;visual=result.visual;graphics=result.graphics;provider=result.provider||'multi-agent-editorial-board';
      const final=result.final;
      if(final){title=final.title||title;subtitle=final.subtitle||subtitle;executive=final.executive_assessment||executive;finalBody={...deterministic,...final};}
      if(!result.publishable) logger.warn(\`Publication editorial board held \${country}/\${type}: evidence=\${evidenceContract} qa=\${result.qa?.publishable===true} blocking=\${(result.qa?.blocking_issues||[]).length}\`);
    }catch(error){logger.warn(\`Publication editorial board unavailable \${country}/\${type}; deterministic evidence product retained: \${error.message}\`);}
  }

  const boardPublishable=board?.publishable===true;
  const aiRequired=String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true';
  const status=(evidenceContract&&(!aiRequired||boardPublishable))?'published':'draft';
  const version=existing.length?Number(existing[0].version||1)+1:1;
  const body={
    ...finalBody,title,subtitle,executive_assessment:executive,key_events:events,
    editorial_board:{agents:AGENT_ROLES.map(a=>a.id),board,visual_plan:visual,graphics_plan:graphics,provider},
    generator:{
      name:'SONALIT EVIDENCE-FIRST PUBLICATION FABRIC',
      provider,
      mode:provider==='evidence-first-fallback'?'DETERMINISTIC_EVIDENCE_PUBLICATION':'AI_ENHANCED',
      evidence_contract:evidenceContract
    },
    version
  };
  let publicationId=null;
  if(existing.length){
    const updated=await query(
      \`UPDATE intel_publications
       SET title=$3,subtitle=$4,status=$5,period_start=$6,period_end=$7,executive_assessment=$8,body=$9::jsonb,evidence=$10::jsonb,confidence=$11,version=$12,published_at=CASE WHEN $5='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW()
       WHERE id=$1 AND org_id=$2 RETURNING id,status,version\`,
      [existing[0].id,orgId,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),
       events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,version]
    );
    publicationId=updated.rows[0]?.id||existing[0].id;
  } else {
    const inserted=await query(
      \`INSERT INTO intel_publications
       (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
       RETURNING id,status,version\`,
      [orgId,country,type,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),
       events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,status==='published'?new Date():null,version]
    );
    publicationId=inserted.rows[0]?.id||null;
  }
  return{
    status:'created',publication_id:publicationId,publication_status:status,
    evidence_contract:evidenceContract,evidence_count:evidenceCount,source_count:sourceCount,
    editorial_agents:AGENT_ROLES.length,generator_mode:body.generator.mode,version
  };
}
async function publishDue(orgId){const results=[];for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'daily')});}catch(error){results.push({country,status:'failed',error:error.message});}}
 const d=new Date();if(d.getUTCDay()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'weekly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 if(d.getUTCDate()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'monthly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 return{processed:results.length,results};}
async function runIntelligenceAgents(){const {rows:orgs}=await globalQuery(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const output=[];for(const {org_id} of orgs){try{const result=await runWithOrgContext(org_id,async()=>{const translation=await translateQueue(org_id);const synthesis=await synthesizeEvents(org_id);const publications=await publishDue(org_id);return{translation,synthesis,publications};});output.push({org_id,...result});}catch(error){output.push({org_id,error:error.message});logger.warn(`Intelligence agents org=${org_id} failed: ${error.message}`);}}return output;}
module.exports={runIntelligenceAgents,translateQueue,synthesizeEvents,publishDue,publicationForCountry,evidenceDerivedSynthesis};