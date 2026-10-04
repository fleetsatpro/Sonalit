      LEFT JOIN intel_event_observations eo ON eo.event_id=e.id
      LEFT JOIN intel_observations o ON o.id=eo.observation_id
      LEFT JOIN intel_sources s ON s.id=o.source_id
      WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4
      GROUP BY e.id
      ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC
      LIMIT 80`,[orgId,country,start,end]
  );

  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);
  const sourceIds=new Set();
  for(const e of events) for(const obs of Array.isArray(e.evidence)?e.evidence:[]) if(obs&&obs.source_id) sourceIds.add(String(obs.source_id));
  const sourceCount=sourceIds.size;
  const evidenceContract=evidenceCount>=3&&sourceCount>=2;
  const periodClosed=end.getTime()<=now.getTime();
  const priorCoverage=existing[0]?.body?.collection_coverage||{};
  const priorResearch=existing[0]?.body?.deep_research||{};
  const priorDossiers=Array.isArray(existing[0]?.body?.incident_dossiers)?existing[0].body.incident_dossiers:[];
  const fingerprint=publicationFingerprint(country,type,start,end,events);
  const priorFingerprint=String(priorCoverage.fingerprint||'');
  const evidenceChanged=priorFingerprint!==fingerprint;
  // Research exactly the bounded incident set exposed by the publication.
  const publicationEvents=events.slice(0,8);
  const deepResearchEnabled=String(process.env.INTEL_PUBLICATION_DEEP_RESEARCH||'true').toLowerCase()!=='false';
  const expectedResearchCount=publicationEvents.length;
  const previousResearchCount=Number(priorResearch.incidents_researched||0)+Number(priorResearch.incidents_fallback||0);
  const researchCooldownMinutes=Math.max(5,Math.min(24*60,Number(process.env.INTEL_PUBLICATION_RESEARCH_RETRY_MINUTES)||60));
  const lastResearchAttemptAt=priorResearch.last_attempt_at?new Date(priorResearch.last_attempt_at):null;
  const researchAttemptRecent=Boolean(lastResearchAttemptAt&&!Number.isNaN(lastResearchAttemptAt.getTime())&&(now.getTime()-lastResearchAttemptAt.getTime())<researchCooldownMinutes*60*1000);
  const needsDeepResearch=deepResearchEnabled&&expectedResearchCount>0&&previousResearchCount<expectedResearchCount&&(!researchAttemptRecent||evidenceChanged);
  const unchanged=existing.length
    && !evidenceChanged
    && Number(priorCoverage.evidence_count||-1)===evidenceCount
    && Number(priorCoverage.source_count||-1)===sourceCount
    && !needsDeepResearch;
  if(existing.length&&unchanged)return{status:'exists',id:existing[0].id,publication_id:existing[0].id,publication_status:existing[0].status,version:existing[0].version||1};

  const refreshPdf=Boolean(existing.length&&(String(priorCoverage.fingerprint||'')!==fingerprint||needsDeepResearch));

  const priorResearchByEvent=Object.fromEntries(priorDossiers.map(d=>[
    String(d.id||d.event_id||d.observation_id||''),
    {packet:{},agent:{
      status:d.research_status||null,
      narrative:d.what_happened||'',
      context:d.context||'',
      confirmed_facts:Array.isArray(d.key_facts)?d.key_facts:[],
      reported_or_disputed:Array.isArray(d.reported_or_disputed)?d.reported_or_disputed:[],
      analytical_assessment:d.assessment||'',
      why_it_matters:Array.isArray(d.why_it_matters)?d.why_it_matters:[],
      uncertainty:Array.isArray(d.caveats)?d.caveats:[],
      chronology:Array.isArray(d.chronology)?d.chronology:[],
      sources:Array.isArray(d.research_sources)?d.research_sources:[],
      provider:d.research_provider||'prior-publication'
    }}
  ]).filter(([id])=>id));

  let incidentResearch={byEvent:{},summary:{requested:0,researched:0,fallback:0,failed:0,web_search_requests:0}};
  let researchAttempted=false;
  if(deepResearchEnabled&&expectedResearchCount>0&&needsDeepResearch){
    researchAttempted=true;
    try{
      incidentResearch=await researchPublicationIncidents(publicationEvents,{country});
      logger.info('Intelligence publication research '+country+'/'+type+': requested='+incidentResearch.summary.requested+' researched='+incidentResearch.summary.researched+' fallback='+incidentResearch.summary.fallback+' failed='+incidentResearch.summary.failed+' web_search_requests='+(incidentResearch.summary.web_search_requests||0));
    }catch(error){
      incidentResearch={byEvent:{},summary:{requested:expectedResearchCount,researched:0,fallback:expectedResearchCount,failed:0,web_search_requests:0}};
      logger.warn('Intelligence publication research failed '+country+'/'+type+': '+error.message);
    }
  }else if(deepResearchEnabled&&expectedResearchCount>0&&researchAttemptRecent&&!evidenceChanged){
    incidentResearch={
      byEvent:priorResearchByEvent,
      summary:{requested:expectedResearchCount,researched:Number(priorResearch.incidents_researched||0),fallback:Number(priorResearch.incidents_fallback||0),failed:0,web_search_requests:0,skipped_due_to_cooldown:true}
    };
    logger.info('Intelligence publication research '+country+'/'+type+': skipped due to retry cooldown='+researchCooldownMinutes+'m');
  }

  const effectiveResearchByEvent={...incidentResearch.byEvent};
  for(const e of publicationEvents){
    const id=String(e.id);
    const current=effectiveResearchByEvent[id];
    const prior=priorResearchByEvent[id];
    if(current?.agent?.status==='fallback'&&prior?.agent?.status==='researched') effectiveResearchByEvent[id]=prior;
    else if(!current&&prior) effectiveResearchByEvent[id]=prior;
  }
  const enrichedEvents=events.map(e=>({...e,research:effectiveResearchByEvent[String(e.id)]||null}));
  const deterministic=buildEvidencePublication({country,type,start,end,events:enrichedEvents,evidenceCount,sourceCount,evidenceContract});
  let finalBody=deterministic;
  let title=deterministic.title;
  let subtitle=deterministic.subtitle;
  let executive=deterministic.executive_assessment;
  let board=null,visual=null,graphics=null;
  let provider='evidence-first-fallback';

  if(String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true' && aiClient.hasAnyProvider() && events.length){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events:enrichedEvents,baseBody:deterministic,evidenceContract,precomputedResearch:incidentResearch});
      board=result.board;visual=result.visual;graphics=result.graphics;provider=result.provider||'multi-agent-editorial-board';
      const final=result.final;
      if(final){title=final.title||title;subtitle=final.subtitle||subtitle;executive=final.executive_assessment||executive;finalBody={...final,...deterministic,title:final.title||deterministic.title,subtitle:final.subtitle||deterministic.subtitle,executive_assessment:final.executive_assessment||deterministic.executive_assessment};}
      if(!result.publishable) logger.warn(`Publication editorial board held ${country}/${type}: evidence=${evidenceContract} qa=${result.qa?.publishable===true} blocking=${(result.qa?.blocking_issues||[]).length}`);
    }catch(error){logger.warn(`Publication editorial board unavailable ${country}/${type}; deterministic evidence product retained: ${error.message}`);}
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
      mode:incidentResearch.summary.researched>0?'EVIDENCE_FIRST_WITH_DEEP_RESEARCH':(provider==='evidence-first-fallback'?'DETERMINISTIC_EVIDENCE_PUBLICATION':'AI_ENHANCED'),
      evidence_contract:evidenceContract
    },
    deep_research:{
      ...deterministic.deep_research,
      agent_summary:incidentResearch.summary,
      last_attempt_at:researchAttempted?now.toISOString():(priorResearch.last_attempt_at||null),
      next_attempt_at:researchAttempted&&incidentResearch.summary.researched<expectedResearchCount
        ?new Date(now.getTime()+researchCooldownMinutes*60*1000).toISOString()
        :(priorResearch.next_attempt_at||null),
      retry_cooldown_minutes:researchCooldownMinutes,
      skipped_due_to_cooldown:Boolean(incidentResearch.summary.skipped_due_to_cooldown),
      last_failure_reason:researchAttempted&&incidentResearch.summary.researched<expectedResearchCount
        ?'one or more incident research results fell back to evidence-only content'
        :(priorResearch.last_failure_reason||null)
    },
    version
  };
  let publicationId=null;
  if(existing.length){
    const updated=await query(
      `UPDATE intel_publications
       SET title=$3,subtitle=$4,status=$5,period_start=$6,period_end=$7,executive_assessment=$8,body=$9::jsonb,evidence=$10::jsonb,confidence=$11,version=$12,published_at=CASE WHEN $5='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW()
       WHERE id=$1 AND org_id=$2 RETURNING id,status,version`,
      [existing[0].id,orgId,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),
       events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,version]
    );
    publicationId=updated.rows[0]?.id||existing[0].id;
    if(refreshPdf && status==='published'){
      await query(
        "UPDATE intel_publications SET pdf_status='not_requested',pdf_key=NULL,pdf_url=NULL,pdf_generated_at=NULL,pdf_error=NULL,pdf_version=COALESCE(pdf_version,1)+1,updated_at=NOW() WHERE id=$1 AND org_id=$2",
        [publicationId,orgId]
      );
    }
  } else {
    const inserted=await query(
      `INSERT INTO intel_publications
       (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
       RETURNING id,status,version`,
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
async function publicationForCountry(orgId,country,type='daily'){