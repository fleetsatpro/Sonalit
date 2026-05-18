import { useState, useRef, useEffect } from 'react';
import { Send, Cpu, Info, ChevronRight } from 'lucide-react';
import { MLOS_SYSTEM_PROMPT } from '../systemPrompt.js';

// ── Identity override: Sonalit, not MLOS ─────────────────────────────────────
const SONALIT_PREAMBLE = `IDENTITY OVERRIDE — MANDATORY:
You are Sonalit — the autonomous AI intelligence layer of the Sonalit Logistics Intelligence Platform. You are NOT "MLOS Copilot". You are NOT "Monster Logistics OS". You are Sonalit. If anyone asks who or what you are, you say "I am Sonalit, your logistics intelligence platform." Every capability, module, and standard described in this system prompt belongs to Sonalit. Apply all operational principles exactly as described — but your identity is Sonalit.

`;

const MODULE_NAMES = {
  '01':'Supply Chain Visibility','02':'Warehouse Management','03':'Customs & Border Intel',
  '04':'Procurement & Vendors','05':'Marketplace & Load Board','06':'Freight Exchange',
  '07':'Digital Twin Engine','08':'AI Decision Engine','09':'Incident Command',
  '10':'Driver Mobile App','11':'Contractor Portal','12':'IoT Sensor Command',
  '13':'Computer Vision','14':'Insurance Intelligence','15':'SLA & Contract Intel',
  '16':'Revenue Optimisation','17':'Tender & Bid Mgmt','18':'Risk Intelligence',
  '19':'Carbon & Sustainability','20':'Billing & Admin','21':'Advanced Analytics',
  '22':'Workflow Automation','23':'Communications Layer','24':'Audit & Forensics',
  '25':'Global Map Intelligence','26':'API Economy','27':'White-Label Engine',
  '28':'Multi-Modal Logistics','29':'Autonomous Readiness','30':'Executive Strategy',
  '31':'Compliance & Regulatory','32':'Financial Risk & FX','33':'Driver Welfare',
  '34':'Cybersecurity Ops','35':'Predictive Network Intel',
};

const MODULE_QA = {
  overview: [
    { label:'INCIDENT BRIEF',    text:'Full situational briefing on all active SEV-1 and SEV-2 incidents. Detection sources, current response status, escalation path, and human decision gates pending.' },
    { label:'ETA RISK SCAN',     text:'ETA risk scan across all active shipments. Flag every shipment with >70% SLA breach probability. For each: P50/P80/P95 ETA, primary delay driver with contribution weight, reroute recommendation with cost and time delta, decision window.' },
    { label:'FUEL SHOCK +30%',   text:'What-if scenario: fuel prices rise 30% tomorrow. Model full network impact — cost delta per lane, SLA degradation probability, CO₂ change, revenue at risk — over a 12-month rolling horizon with recommended response strategy.' },
    { label:'BORDER INTEL',      text:'Live border crossing conditions on our highest-volume corridors. Wait times with confidence intervals, pre-clearance status, document discrepancy flags, HS code confidence, sanctions screening status.' },
    { label:'VENDOR RISK',       text:'Vendor concentration risk analysis. Flag all single-source dependencies exceeding 35% of critical lanes. Model "what if Supplier X fails?" for each. Provide diversification options with switching cost and recovery time estimates.' },
    { label:'CARBON REPORT',     text:'CO₂e emissions for today. Scope 1/2/3 breakdown. Per-customer attribution using tonne-km methodology. Idle emission waste in $ and CO₂e. Top 5 carbon-intensive lanes. Verified offset options.' },
    { label:'SLA HEALTH CHECK',  text:'Which customers face SLA breach risk in the next 60 minutes? For each: current metric trajectory, breach probability, impacted SLA clause, intervention options ranked by effectiveness and cost, and decision window remaining.' },
    { label:'STRATEGIC BRIEF',   text:'Weekly C-suite AI brief: top 5 operational performance signals (positive and negative), top 3 external risk developments, 2 strategic recommendations with financial impact estimates, 1 competitive intelligence signal. Max 2 pages, every figure traceable.' },
  ],
  '01': [
    { label:'HIGH-RISK SHIPMENTS', text:'Status of all shipments with risk score ≥65. For each: P80 ETA, primary delay driver with contribution weight, recommended action, decision window. Include cross-shipment dependency graph analysis.' },
    { label:'ANOMALY SCAN',        text:'Real-time anomaly scan across all active shipments. Flag: route deviations >500m, unscheduled stops >8min (>5min high-risk zones), weight inconsistencies suggesting partial load theft, door events at unplanned coordinates.' },
    { label:'DELAY ROOT CAUSE',    text:'Top 5 delay patterns over the last 7 days. Use causal inference to distinguish traffic vs driver vs customs vs weather vs systemic delays. Surface patterns across the fleet, not just individual shipments.' },
    { label:'SUPPLIER CASCADE',    text:'Are any Tier 2 or Tier 3 supplier disruptions currently propagating downstream? Model: POs at risk, customer orders affected, revenue exposure, alternative sourcing options with lead time and cost.' },
  ],
  '02': [
    { label:'INVENTORY HEALTH',    text:'Inventory health across all warehouse nodes. FEFO/FIFO compliance risks, quarantined stock status, bins approaching capacity, near-expiry alerts at product level.' },
    { label:'LABOUR FORECAST',     text:'Can we hit today\'s wave plan cutoffs given current labour throughput? Model shift completion times, flag where reallocation or overtime is needed, quantify the risk to each order cutoff.' },
    { label:'SLOTTING REVIEW',     text:'Top 10 re-slotting recommendations based on 30-day velocity. Quantify projected travel time savings in hours per week per picker. Include slotting change execution estimate in labour hours.' },
    { label:'SAFETY EVENTS',       text:'All personnel-forklift proximity events in the last 24 hours. Near-miss count, zones affected, trend vs 30-day baseline. Weekly safety report for the safety officer.' },
  ],
  '03': [
    { label:'BORDER QUEUE LIVE',   text:'Live border crossing conditions on our top 5 corridors. Queue wait time with confidence interval, lane recommendation, data source and freshness. Highlight any pre-clearance failures.' },
    { label:'PRE-CLEARANCE STATUS',text:'Which active shipments are not yet pre-cleared and approaching their border window? Flag all document discrepancies that must be resolved before departure.' },
    { label:'DUTY OPTIMISATION',   text:'Active trade preference schemes we are not fully utilising (AGOA, EAC, EU-EPA, CPTPP, etc.). Calculate duty savings opportunity across current shipment pipeline with specific HS code recommendations.' },
    { label:'SANCTIONS SWEEP',     text:'Restricted party screening status for all active counterparties. OFAC, EU, and UN list check. Last scan timestamps. Flag any matches or pending reviews requiring compliance officer escalation.' },
  ],
  '07': [
    { label:'FULL STRESS TEST',    text:'Run the complete pre-built stress test battery: pandemic lockdown, fuel shock +50%, top 3 carrier simultaneous failure, extreme weather event, cyber attack on customs clearance. Output ranked response strategies by cost, lead time, and reversibility.' },
    { label:'CASCADE FAILURE',     text:'Model a port strike at our highest-volume hub. Compute all second and third-order cascade effects: container backlog → inland overflow → production stoppage → SLA breach cascade → revenue loss × churn probability.' },
    { label:'SHADOW EXECUTION',    text:'We are considering closing our secondary eastern depot. Run this in Shadow Execution Mode for 30 simulated days. Surface every predicted failure mode, cost delta, and SLA risk before we commit.' },
    { label:'COUNTERFACTUAL',      text:'For the last major SLA breach event, what would have happened if we had taken the alternative routing or carrier decision? Quantify the regret value. Use to calibrate future routing policy.' },
  ],
  '08': [
    { label:'DECISION LOG',        text:'All autonomous decisions in the last 4 hours: action taken, confidence score, input signals used, alternatives evaluated, audit ledger block reference. Flag any decisions near the confidence threshold.' },
    { label:'CONFIDENCE AUDIT',    text:'Is model confidence well-calibrated? Predicted confidence vs actual accuracy over the last 30 days per decision category. Flag systematic over or under-confidence — treat miscalibration as a defect.' },
    { label:'BIAS SCAN',           text:'Quarterly fairness audit: check for unintended bias in carrier selection equity, lane profitability vs service equity, driver assignment fairness. Provide statistical confidence that any detected differences are real.' },
    { label:'OVERRIDE PATTERNS',   text:'All human overrides of AI recommendations in the last 7 days. Which decision types are overridden most? What patterns emerge? What model recalibration events have been triggered? What should change?' },
  ],
  '09': [
    { label:'ACTIVE INCIDENTS',    text:'Full incident command briefing for all active SEV-1 through SEV-4 incidents. For each: detection method and signal sources, current response status, assigned responders, escalation path, resolution ETA, resource conflicts.' },
    { label:'PRE-INCIDENT INTEL',  text:'Pre-incident intelligence scan. Which drivers show 3+ consecutive shifts with micro-fatigue signals? Which vehicles have elevated failure probability in the next 30 days? Trigger proactive interventions before incidents occur.' },
    { label:'WAR ROOM STATUS',     text:'Are any incident war rooms currently active? Live telemetry summary, all assigned responders, last communication timestamp, outstanding escalations, evidence preservation status.' },
    { label:'AFTER-ACTION REVIEW', text:'After-action review for the last closed SEV-1 or SEV-2 incident: AI root-cause analysis, contributing factor tree, timeline replay, prevention recommendations, model recalibration signals, and total cost of incident (direct + indirect + revenue impact).' },
  ],
  '18': [
    { label:'THREAT MAP NOW',      text:'Current risk picture across all operational corridors. Theft hotspot density (5km grid, hourly update), civil unrest advisories, weather hazard overlays, cyber threat indicators. All data within 60-second staleness threshold.' },
    { label:'CORRIDOR RISK SCORE', text:'Score all active freight corridors by composite risk index. Flag any where index has increased >10 points in the last 24 hours. Include cargo-type-specific overlay (pharmaceutical, electronics, fuel have distinct hotspot maps).' },
    { label:'GEOPOLITICAL BRIEF',  text:'Geopolitical developments in our operating regions in the last 72 hours that could affect freight flows. Border disruption probability, diplomatic tension signals, recommended pre-positioning actions with lead time.' },
    { label:'CYBER ADVISORY',      text:'Active cyber threats targeting logistics operators right now: ransomware campaigns, GPS spoofing incidents, customs system outages, port IT failures, fuel card fraud patterns. Issue operational advisories for each active threat.' },
  ],
  '19': [
    { label:'EMISSIONS REPORT',    text:'Today\'s CO₂e report. Scope 1/2/3 breakdown. Per-customer attribution using tonne-km allocation (methodology locked per contract). Idle emission waste in $ and CO₂e. Top 5 emission-intensive lanes. Regulatory reporting status.' },
    { label:'CARBON ROUTING',      text:'Top 10 lanes by volume: explicit three-way comparison of fastest, cheapest, and lowest-emission route options — with CO₂e, cost, and time for each. Present trade-offs transparently. Let the shipper choose.' },
    { label:'EV TRANSITION PLAN',  text:'Which routes are EV-ready today based on range sufficiency and charging infrastructure? Model TCO crossover point vs diesel per route. Recommend optimal electrification sequencing by depot with phased implementation plan.' },
    { label:'OFFSET CALCULATION',  text:'Calculate residual unavoidable emissions for this month. Source verified Gold Standard or VCS offset units via carbon market API. Generate on-chain certificate with full provenance trail. Never offer unverified claims.' },
  ],
  '30': [
    { label:'P&L FORECAST',        text:'12-month P&L projection under three scenarios: base case (current trend), optimistic (full pipeline conversion + efficiency gains), and stress case (fuel +40%, volume -20%, key carrier loss). Every projection traceable to its input assumptions.' },
    { label:'BOARD REPORT',        text:'Board-ready report: ESG performance, operational excellence KPIs, strategic initiative status, and covenant compliance. Formatted to board standards. Full data lineage available for audit committee.' },
    { label:'MARKET EXPANSION',    text:'Model entry into a proposed new geography: addressable market, competitive landscape, regulatory entry requirements, capex+opex profile, revenue ramp projection, and risk-adjusted payback period. Include sensitivity analysis.' },
    { label:'CONCENTRATION RISK',  text:'Full concentration risk dashboard: single-customer, single-carrier, single-lane, single-geography revenue and cost concentration. Model the impact of losing any position >25% of a category. Recommend diversification roadmap.' },
  ],
  '34': [
    { label:'THREAT DETECTION',    text:'Current security events across all systems: anomalous login patterns, GPS spoofing attempts, firmware tampering signals, API traffic anomalies, lateral movement indicators. Auto-contain status for any confirmed threats.' },
    { label:'GPS SPOOFING SCAN',   text:'GPS spoofing detection status across the active fleet. Cross-validate positions against inertial nav, cellular triangulation, map-matching, and peer-vehicle validation. Flag any position anomalies with corroboration score.' },
    { label:'THIRD-PARTY RISK',    text:'Cybersecurity posture of our critical technology vendors and integration partners. Flag vendors with unpatched critical vulnerabilities. Review vendor cyber criteria scores from last onboarding assessment.' },
    { label:'RANSOMWARE READINESS',text:'Current ransomware resilience posture: immutable backup status (last test date), RTO by system tier, incident response playbook readiness, and any active ransomware campaigns targeting logistics operators.' },
  ],
};

const EPISTEMIC_MODES = [
  { mode:'CERTAINTY',       color:'var(--green)',  desc:'Direct sensor / confirmed ledger' },
  { mode:'HIGH CONFIDENCE', color:'var(--cyan)',   desc:'≥85% model probability' },
  { mode:'INFERENCE',       color:'var(--amber)',  desc:'Derived from correlated signals' },
  { mode:'PROJECTION',      color:'var(--purple)', desc:'Forward-looking model output' },
  { mode:'ASSUMPTION',      color:'var(--orange)', desc:'Input data missing — flagged' },
  { mode:'UNKNOWN',         color:'var(--red)',    desc:'Outside data availability — investigating' },
];

const UC_CONTEXT = {
  operator:   'USER CLASS: OPERATOR (dispatcher / fleet manager / supervisor). Respond concise and action-first. One clear recommendation, quantified outcome, named actor, time window. 3–5 sentences max plus supporting data. Lead with the decision needed.',
  strategist: 'USER CLASS: STRATEGIST (C-suite / logistics director / procurement head). Respond with structured narrative. Lead with the financial implication or strategic exposure. 2–4 paragraphs with supporting data, P&L context, and strategic optionality analysis.',
  field:      'USER CLASS: FIELD ACTOR (driver / warehouse staff / contractor). Plain simple language only. Lead with exactly what to do right now. Maximum 1–3 sentences. Safety first. Assume high-pressure, low-bandwidth context. No jargon.',
  system:     'USER CLASS: SYSTEM ACTOR (API / automation engine / webhook consumer). Respond with schema-valid JSON only. All fields fully typed and specified. Error states explicitly modelled. Zero prose. Zero ambiguity.',
};

const AL_CONTEXT = {
  1: 'AUTONOMY LEVEL 1 — ADVISORY: Provide recommendations only. No autonomous actions. Every recommendation must include: primary rationale, confidence level, key input signals, alternative considered, and decision window before the opportunity closes.',
  2: 'AUTONOMY LEVEL 2 — AUTO-DRAFT + HUMAN APPROVAL: Prepare the complete action package. Include: full rationale, projected outcome with confidence interval, risk if declined, and a clear one-click approve/reject recommendation. Flag if SLA window requires urgent response.',
  3: 'AUTONOMY LEVEL 3 — FULLY AUTONOMOUS EXECUTION: Execute end-to-end when confidence meets threshold and no anomalous context signals are present. Log the full reasoning chain, confidence score, input signals, and alternatives evaluated to the Immutable Audit Ledger. Pause immediately and escalate to human if confidence drops below threshold mid-execution.',
};

function detectTag(text) {
  const u = text.toUpperCase();
  if (u.includes('ACTION REQUIRED')) return 'req';
  if (u.includes('ACTION TAKEN'))    return 'done';
  if (u.includes('MONITORING ACTIVE') || u.includes('MONITORING')) return 'mon';
  return null;
}

function StatusTag({ type }) {
  const map = {
    req:  ['⚠ ACTION REQUIRED',  'req'],
    mon:  ['◉ MONITORING ACTIVE', 'mon'],
    done: ['✓ ACTION TAKEN',      'done'],
  };
  if (!map[type]) return null;
  const [label, cls] = map[type];
  return <div className={`msg-tag ${cls}`}>{label}</div>;
}

function Msg({ m }) {
  const isUser = m.role === 'user';
  const time   = new Date(m.ts).toISOString().slice(11, 19);
  const tag    = !isUser ? detectTag(m.content) : null;
  return (
    <div className={`msg ${isUser ? 'user' : 'ai'}`}>
      <div className="msg-avatar">{isUser ? 'OPR' : 'S'}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-sender">{isUser ? 'OPERATOR' : 'SONALIT AI'}</span>
          <span className="msg-time">{time} UTC</span>
        </div>
        <div className="msg-bubble">{m.content}</div>
        {tag && <StatusTag type={tag} />}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="msg ai">
      <div className="msg-avatar" style={{ background: 'var(--amber-glow)', border: '1px solid var(--amber)', color: 'var(--amber)' }}>S</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-sender" style={{ color: 'var(--amber)' }}>SONALIT AI</span>
          <span className="msg-time">processing across 7 reasoning modes…</span>
        </div>
        <div className="typing">
          <div className="t-dot" /><div className="t-dot" /><div className="t-dot" />
        </div>
      </div>
    </div>
  );
}

export default function ChatArea({ apiKey, activeModule, userClass, autonomyLevel, mobileActive }) {
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [showEp,  setShowEp]  = useState(false);
  const bottomRef = useRef(null);
  const textRef   = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  const modName = activeModule !== 'overview' ? MODULE_NAMES[activeModule] : null;
  const qa      = MODULE_QA[activeModule] || MODULE_QA['overview'];

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  const send = async (text) => {
    if (!text.trim() || loading) return;
    setError('');

    const userMsg = { role: 'user', content: text.trim(), ts: Date.now() };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput('');
    if (textRef.current) { textRef.current.style.height = 'auto'; }
    setLoading(true);

    const systemPrompt = [
      SONALIT_PREAMBLE,
      MLOS_SYSTEM_PROMPT,
      '\n\n---\n## ACTIVE SESSION CONTEXT\n\n',
      UC_CONTEXT[userClass]     || UC_CONTEXT.operator,
      '\n\n',
      AL_CONTEXT[autonomyLevel] || AL_CONTEXT[1],
      modName
        ? `\n\nACTIVE MODULE: ${activeModule} — ${modName}. Prioritise responses for this domain while remaining available for cross-module queries.`
        : '',
      '\n\nOBLIGATION: Every response MUST close with exactly one state declaration: ACTION REQUIRED / ACTION TAKEN / MONITORING ACTIVE / NO ACTION NEEDED — [REASON]. Never omit this.',
    ].join('');

    try {
      const key = apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!key) throw new Error('NO_KEY');

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: systemPrompt,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message || `HTTP ${res.status}`);
      }

      const data    = await res.json();
      const content = data.content?.map(b => b.text || '').join('') || '';
      setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now() }]);
    } catch (e) {
      setError(
        e.message === 'NO_KEY'
          ? 'No API key configured. Set VITE_ANTHROPIC_API_KEY in your .env file.'
          : `Sonalit API Error: ${e.message}`
      );
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const clearSession = () => { setMsgs([]); setError(''); setShowEp(false); };

  return (
    <div className={`chat-area ${mobileActive ? 'mob-show' : ''}`}>

      {/* Header */}
      <div className="chat-hdr">
        <div className="chat-hdr-icon"><Cpu size={16} /></div>
        <div className="chat-hdr-info">
          <div className="chat-hdr-title">SONALIT AI · AUTONOMOUS LOGISTICS INTELLIGENCE</div>
          <div className="chat-hdr-sub">
            COMPOUND AI · 7 REASONING MODES · 35 DOMAINS · PRIORITY: HUMAN LIFE → SAFETY → COMPLIANCE
          </div>
        </div>
        <button
          onClick={() => setShowEp(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px',
            borderRadius: 'var(--r-sm)', cursor: 'pointer', minHeight: 30,
            background: showEp ? 'var(--purple-glow)' : 'transparent',
            border: `1px solid ${showEp ? 'var(--purple)' : 'var(--border-mid)'}`,
            fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.06em',
            color: showEp ? 'var(--purple)' : 'var(--text-low)',
          }}>
          <Info size={11} /> §1.6
        </button>
        {modName && (
          <div className="chat-mod-tag">MOD {activeModule} · {modName.toUpperCase()}</div>
        )}
      </div>

      {/* Epistemic Key */}
      {showEp && (
        <div className="epistemic-bar">
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--text-low)', letterSpacing: '0.1em', flexShrink: 0 }}>
            EPISTEMIC MODES:
          </span>
          {EPISTEMIC_MODES.map(ep => (
            <div key={ep.mode} className="ep-item">
              <div className="ep-dot" style={{ background: ep.color }} />
              <span className="ep-mode" style={{ color: ep.color }}>{ep.mode}</span>
              <span className="ep-desc">— {ep.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="chat-msgs">
        {msgs.length === 0 && !loading ? (
          <div className="welcome-wrap">
            <div className="welcome-emblem">
              <div className="welcome-gem" />
            </div>
            <div>
              <div className="welcome-name">SONA<span>LIT</span></div>
              <div className="welcome-tagline">
                {modName
                  ? `Module ${activeModule} · ${modName}`
                  : 'Logistics Intelligence Platform · 35 Modules Active'}
              </div>
            </div>
            <div className="welcome-desc">
              {modName
                ? `${modName} context loaded. Sonalit AI will prioritise this domain while remaining available for cross-module queries.`
                : 'The autonomous intelligence layer optimising every dollar, kilogram, kilometre, and minute across your logistics network. Human life and safety always first.'}
            </div>
            <div className="welcome-hint">SELECT A QUICK COMMAND OR TYPE YOUR OWN BELOW</div>
            <div className="qa-grid">
              {qa.map((q, i) => (
                <button key={i} className="qa-btn" onClick={() => send(q.text)}>
                  <div className="qa-label">
                    <ChevronRight size={9} style={{ display: 'inline', marginRight: 3 }} />
                    {q.label}
                  </div>
                  <div className="qa-text">{q.text.slice(0, 82)}…</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {msgs.map((m, i) => <Msg key={i} m={m} />)}
            {loading && <Typing />}
            {error && (
              <div className="err-bar">
                <span style={{ flexShrink: 0 }}>⚠</span>
                <span>{error}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-row">
          <textarea
            ref={textRef}
            rows={1}
            value={input}
            disabled={loading}
            placeholder="Issue a command to Sonalit AI… (Enter to send · Shift+Enter for new line)"
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={onKey}
          />
          <button
            className="send-btn"
            onClick={() => send(input)}
            disabled={!input.trim() || loading}>
            <Send size={15} />
          </button>
        </div>
        <div className="chat-input-foot">
          <span className="chat-foot-hint">
            ⬡ SONALIT · 35 MODULES · FULL PROMPT ACTIVE · ALL DECISIONS AUDIT-LOGGED · HUMAN OVERRIDE ALWAYS AVAILABLE
          </span>
          {msgs.length > 0 && (
            <button className="clear-btn" onClick={clearSession}>CLEAR</button>
          )}
        </div>
      </div>
    </div>
  );
}
