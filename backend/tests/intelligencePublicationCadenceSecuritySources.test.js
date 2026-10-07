const fs=require('fs');
const path=require('path');

const agents=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
const mesh=()=>fs.readFileSync(path.join(__dirname,'../src/utils/aggressiveIntelligenceAgents.js'),'utf8');
const worker=()=>fs.readFileSync(path.join(__dirname,'../src/workers/worker.intelligence.js'),'utf8');
const quality=()=>fs.readFileSync(path.join(__dirname,'../src/utils/publicationQuality.js'),'utf8');

describe('Intel Hub publication contract',()=>{
  test('daily editions use the previous completed local calendar day',()=>{
    const s=agents();
    expect(s).toContain("PUBLICATION_TIMEZONE=process.env.INTEL_PUBLICATION_TIMEZONE||'Africa/Nairobi'");
    expect(s).toContain("KE:'Africa/Nairobi'");
    expect(s).toContain("CD:'Africa/Kinshasa'");
    expect(s).toContain("const previous=shiftedCalendarParts(local,-1)");
    expect(s).toContain("startParts={...previous,hour:0,minute:0,second:0}");
    expect(s).toContain("endParts={year:local.year,month:local.month,day:local.day,hour:0,minute:0,second:0}");
  });

  test('weekly and monthly editions use completed periods, not the current partial period',()=>{
    const s=agents();
    expect(s).toContain("const previousWeekStart=shiftedCalendarParts(local,-(mondayOffset+7))");
    expect(s).toContain("if(isPublicationBoundary(now,timeZone))return new Date(now.getTime()+1000);");
    expect(s).toContain("const currentWeekStart=shiftedCalendarParts(local,-mondayOffset)");
    expect(s).toContain("endParts={...currentWeekStart,hour:0,minute:0,second:0}");
    expect(s).toContain("const previousMonth=new Date(Date.UTC(local.year,local.month-2,1))");
  });

  test('publication query prefers occurrence time and only falls back to report time when occurrence is unknown',()=>{
    const s=agents();
    expect(s).toContain("e.occurred_from IS NOT NULL AND e.occurred_from>=$3 AND e.occurred_from<$4");
    expect(s).toContain("e.occurred_from IS NULL AND e.last_seen_at>=$3 AND e.last_seen_at<$4");
  });

  test('publication scope is explicitly security-only',()=>{
    const s=agents();
    expect(s).toContain("new Set(['SECURITY','CRIME','BORDER','MARITIME'])");
    expect(s).toContain("if(type==='POLITICAL')return SECURITY_POLITICAL_RE.test(blob)");
    expect(s).toContain("const events=rawEvents.filter(isSecurityRelevantEvent)");
  });

  test('normal worker cycles do not regenerate publications every collection interval',()=>{
    const s=worker();
    expect(s).toContain("runIntelligenceAgents({includePublications:false})");
    expect(s).toContain('country-local');
    expect(s).toContain("schedulePublicationBoundary()");
    expect(s).toContain("withAdvisoryLock('sonalit:intelligence:publication-boundary'");
  });

  test('startup repair can catch up daily publications without converting normal cycles into publication schedules',()=>{
    const s=worker();
    expect(s).toContain('forceDailyPublications: true');
    expect(s).toContain('Intelligence publication startup catch-up');
    const a=agents();
    expect(a).toContain('const forceDailyPublications=Boolean(options.forceDailyPublications);');
    expect(a).toContain("publishDue(org_id,now,{forceDaily:forceDailyPublications})");
    expect(a).toContain('const forceDaily=Boolean(options.forceDaily);');
    expect(a).toContain("if(forceDaily || isPublicationBoundary(now,tz))await run(country,'daily');");
    expect(s).toContain('generateMissingPublicationPdfs(org.org_id, Number(process.env.INTEL_PUBLICATION_PDF_BATCH || 8))');
    expect(s).toContain('pdf_ready=');
  });

  test('publication recovery is ordered before the expensive startup collection',()=>{
    const s=worker();
    expect(s.indexOf('const catchup = await runIntelligenceAgents')).toBeGreaterThan(-1);
    expect(s.indexOf('const catchup = await runIntelligenceAgents')).toBeLessThan(s.indexOf("await evaluateSpatialEye('startup')"));
  });

  test('SGA WhatsApp is registered as an authorized-feed source, never scraped implicitly',()=>{
    const s=mesh();
    expect(s).toContain("channel_id:'sga-whatsapp-group'");
    expect(s).toContain("name:'SGA WhatsApp Group — Local Security Updates'");
    expect(s).toContain("endpoint:process.env.INTEL_SGA_WHATSAPP_FEED_URL||null");
    expect(s).toContain("requires_authorized_ingest:true");
    expect(s).toContain("authorized_only:true");
    expect(s).toContain("if(!channel.endpoint)return{name:source.name,configured:false,pending_authorized_feed:true");
  });

  test('grassroots Mashinani/county sources are present upstream of the publication security filter',()=>{
    const s=mesh();
    expect(s).toContain("id:'mashinani-news'");
    expect(s).toContain("id:'standard-mashinani'");
    expect(s).toContain("id:'kbc-county'");
    expect(s).toContain("id:'county-pulse'");
  });

  test('ultra-quality release gate is at least 90/100',()=>{
    const q=quality();
    expect(q).toContain('finalScore >= 90');
    expect(q).toContain('threshold: 90');
    const board=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationEditorialBoard.js'),'utf8');
    expect(board).toContain('minimum_qa_score:90');
  });
});
