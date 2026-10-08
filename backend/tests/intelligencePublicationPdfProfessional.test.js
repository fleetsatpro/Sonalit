const fs=require('fs');
const os=require('os');
const pathModule=require('path');
const {execFile}=require('child_process');
const {promisify}=require('util');
const execFileAsync=promisify(execFile);
const {buildProfessionalPdf,PDF_RENDERER_VERSION,buildIncidentMap}=require('../src/services/intelligencePublicationPdfProfessional');

describe('professional intelligence publication PDF renderer',()=>{
  const baseEvent={
    id:'evt-1',
    headline:'Road closure reported after armed attack',
    title:'Road closure reported after armed attack',
    brief:'A road section was reportedly disrupted after an armed attack. Local reporting indicates temporary disruption while the duration and wider geographic effect remain unclear.',
    severity:'high',
    confidence:82,
    intelligence_type:'SECURITY',
    latitude:-1.28,
    longitude:36.82,
    region:'NAIROBI',
    observation_count:2,
    source_count:2,
    key_facts:['A road section was reportedly disrupted.','Two distinct source records are linked to the event.'],
    why_it_matters:['The disruption could increase delay and exposure for vehicles using the corridor.'],
    caveats:['The available reporting does not establish the full duration or geographic extent.'],
    assessment:{judgement:'The evidence supports a short-term access risk, but does not justify a broader deterioration judgement.'},
    evidence:[
      {id:'obs-1',source_id:'src-1',source_name:'BBC World',title:'Road closure reported after attack',url:'https://example.com/bbc'},
      {id:'obs-2',source_id:'src-2',source_name:'UN News',title:'Transport disruption reported',url:'https://example.com/un'}
    ]
  };

  beforeEach(()=>{
    global.fetch=jest.fn(async(url)=>{
      if(String(url).includes('raw.githubusercontent.com/johan/world.geo.json')){
        return {
          ok:true,
          headers:{get:()=> 'application/geo+json'},
          json:async()=>({
            type:'Feature',
            properties:{},
            geometry:{
              type:'Polygon',
              coordinates:[[
                [33.8,-4.7],[41.9,-4.7],[41.9,5.1],[33.8,5.1],[33.8,-4.7]
              ]]
            }
          })
        };
      }
      return {ok:false,status:404,headers:{get:()=> 'text/html'},text:async()=>''};
    });
  });
  afterEach(()=>{delete global.fetch});

  test('produces a bounded, non-corrupted PDF without ghost pages',async()=>{
    const publication={
      id:'pub-1',
      country_code:'KE',
      publication_type:'daily',
      title:'Kenya Daily Intelligence',
      subtitle:'Evidence-governed intelligence - 04 Oct 2026',
      status:'published',
      period_start:'2026-10-04T00:00:00.000Z',
      period_end:'2026-10-05T00:00:00.000Z',
      executive_assessment:'Kenya recorded one high-severity security signal during the reporting period. The evidence supports continued monitoring of the affected corridor while the duration and geographic extent remain uncertain.',
      body:{
        country_code:'KE',
        country_name:'Kenya',
        publication_type:'daily',
        subtitle:'Evidence-governed intelligence - 04 Oct 2026',
        period_start:'2026-10-04T00:00:00.000Z',
        period_end:'2026-10-05T00:00:00.000Z',
        executive_assessment:'Kenya recorded one high-severity security signal during the reporting period. The evidence supports continued monitoring of the affected corridor while the duration and geographic extent remain uncertain.',
        security_environment:{
          summary:'One event was captured in the current evidence set. Collection completeness is not equivalent to incident absence.',
          highest_priority:'Road closure reported after armed attack'
        },
        public_safety_security_overview:{
          summary:'One security-relevant event object was captured in the reporting period.',
          indicators:[
            {label:'RECORDED EVENTS',value:1},
            {label:'HIGH / CRITICAL',value:1},
            {label:'CORROBORATED',value:1},
            {label:'MAPPED',value:1}
          ],
          methodology:'Indicators use only fields available to the publication run.'
        },
        threat_posture:{level:'HIGH',trajectory:'RISING'},
        assessment_highlights:[{
          id:'evt-1',
          headline:'Road closure reported after armed attack',
          judgement:'The evidence supports a short-term access risk, but does not justify a broader deterioration judgement.',
          confidence:82
        }],
        emerging_trends:[{theme:'SECURITY',count:1,share_percent:100,basis:'CURRENT_PERIOD_CONCENTRATION',assessment:'One recorded security event is present; this is a current-period concentration, not a time-series trend.'}],
        key_drivers:[{driver:'Severity pressure',evidence:'One recorded event is assessed at high severity.'}],
        intelligence_gaps:['The duration and geographic extent remain uncertain.'],
        outlook:['Maintain monitoring pending corroboration and evidence of persistence or spread.'],
        pmesi:[
          {domain:'POLITICAL',status:'NO MATERIAL UPDATE',update:null},
          {domain:'MILITARY',status:'HIGH',update:'A high-severity security event was recorded.'},
          {domain:'ECONOMY',status:'NO MATERIAL UPDATE',update:null},
          {domain:'SOCIAL',status:'NO MATERIAL UPDATE',update:null},
          {domain:'INFORMATION & MEDIA',status:'NO MATERIAL UPDATE',update:null}
        ],
        incident_dossiers:[{
          event_id:'evt-1',
          headline:'Road closure reported after armed attack',
          what_happened:'The disruption followed an armed attack and temporarily affected movement on the reported road section. Local reporting did not establish the full duration or wider geographic effect.',
          context:'The affected corridor supports routine movement, so prolonged disruption could create delays and increase exposure on alternate routes.',
          assessment:'The evidence supports a short-term access risk, but does not justify a broader deterioration judgement.',
          why_it_matters:['The disruption could increase delay and exposure for vehicles using the corridor.'],
          caveats:['The duration and wider geographic extent remain uncertain.'],
          chronology:[{time:'04 Oct 2026 09:00 UTC',event:'Initial disruption reported.'}],
          research_status:'researched',
          research_sources:[
            {title:'BBC report',url:'https://example.com/bbc',domain:'bbc.com'},
            {title:'UN transport update',url:'https://example.com/un',domain:'un.org'}
          ]
        }],
        regional_news:[{region:'NAIROBI',items:[{
          headline:'Road closure reported after armed attack',
          brief:'Movement was reportedly disrupted on the affected road section.',
          severity:'high'
        }]}],
        collection_coverage:{evidence_contract_met:true,evidence_count:2,source_count:2},
        deep_research:{incidents_researched:1,web_sources_discovered:2},
        generator:{mode:'EVIDENCE_FIRST_WITH_DEEP_RESEARCH'},
        disclaimer:'This product is evidence-governed decision support and should not replace appropriate professional judgement.'
      }
    };
    const pdf=await buildProfessionalPdf(publication,[baseEvent],[]);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    const tmpDir=fs.mkdtempSync(pathModule.join(os.tmpdir(),'sonalit-pdf-test-'));
    const pdfPath=pathModule.join(tmpDir,'publication.pdf');
    fs.writeFileSync(pdfPath,pdf);
    const script=String.raw`
      const fs=require('fs');
      const {PDFParse}=require('pdf-parse');
      (async()=>{
        const parser=new PDFParse({data:fs.readFileSync(process.argv[1])});
        try{
          const info=await parser.getInfo();
          const parsed=await parser.getText();
          process.stdout.write(JSON.stringify({pages:info.total,text:parsed.text}));
        }finally{
          await parser.destroy();
        }
      })().catch(error=>{console.error(error);process.exit(1);});
    `;
    const {stdout}=await execFileAsync(process.execPath,['--experimental-vm-modules','-e',script,pdfPath],{maxBuffer:8*1024*1024});
    fs.rmSync(tmpDir,{recursive:true,force:true});
    const parsed=JSON.parse(stdout);
    expect(parsed.pages).toBeLessThanOrEqual(16);
    expect(parsed.pages).toBeGreaterThanOrEqual(9);
    expect(PDF_RENDERER_VERSION).toBe('2.4.0');
    expect(parsed.text).not.toContain('[object Object]');
    expect(parsed.text).not.toContain('Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News');
    expect(parsed.text).not.toContain('Evidence-derived event record retained; automated analytical synthesis is unavailable.');
    expect(parsed.text).not.toContain('The current evidence does not justify filling those gaps with assumption.');
    expect(parsed.text).not.toContain('\uFFFD');
    expect(parsed.text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/);
    expect(parsed.text).toContain('PRIORITY INCIDENT DOSSIER');
    expect(parsed.text).toContain('INCIDENT GEOGRAPHY');
    expect(parsed.text).toContain('WHAT HAPPENED');
    expect(parsed.text).toContain('ANALYTICAL ASSESSMENT');
    expect(parsed.text).toContain('MAP REGISTER');
  });
});


test('renders a real boundary map and filters implausible coordinates',async()=>{
  const {image,points,excludedPoints,totalPoints}=await buildIncidentMap('KE',[
    {id:'inside',headline:'Nairobi event',severity:'high',latitude:-1.28,longitude:36.82},
    {id:'outside',headline:'Outlier event',severity:'moderate',latitude:40.0,longitude:120.0}
  ]);
  const meta=await require('sharp')(image).metadata();
  expect(meta.format).toBe('png');
  expect(meta.width).toBe(3200);
  expect(meta.height).toBe(1800);
  expect(totalPoints).toBe(2);
  expect(points).toHaveLength(1);
  expect(excludedPoints).toBe(1);
  expect(points[0].headline).toBe('Nairobi event');
  expect(points[0].n).toBe(1);
});


test('executive judgements use structured assessment cards rather than concatenated dossier prose',()=>{
  const source=fs.readFileSync(pathModule.join(__dirname,'../src/services/intelligencePublicationPdfProfessional.js'),'utf8');
  expect(source).toContain('const highlights=Array.isArray(body.assessment_highlights)');
  expect(source).not.toContain("return (i+1)+'. '+m.headline+' - '+why;");
});
