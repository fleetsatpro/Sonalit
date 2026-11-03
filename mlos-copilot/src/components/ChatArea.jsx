import { useState, useRef, useEffect } from 'react';
import { Send, Cpu, ChevronRight, Info } from 'lucide-react';
import { MLOS_SYSTEM_PROMPT } from '../systemPrompt.js';

const MODULE_NAMES = {
  '01': 'Supply Chain Visibility', '02': 'Warehouse Management',
  '03': 'Customs & Border', '04': 'Procurement & Vendors',
  '05': 'Marketplace & Load Board', '06': 'Freight Exchange',
  '07': 'Digital Twin Engine', '08': 'AI Decision Engine',
  '09': 'Incident Command', '10': 'Driver Mobile App',
  '11': 'Contractor Portal', '12': 'IoT Sensor Command',
  '13': 'Computer Vision', '14': 'Insurance Intelligence',
  '15': 'SLA & Contract Intel', '16': 'Revenue Optimisation',
  '17': 'Tender & Bid Mgmt', '18': 'Risk Intelligence',
  '19': 'Carbon & Sustainability', '20': 'Billing & SaaS Admin',
  '21': 'Advanced Analytics', '22': 'Workflow Automation',
  '23': 'Communications Layer', '24': 'Audit & Forensics',
  '25': 'Global Map Intelligence', '26': 'API Economy',
  '27': 'White-Label Engine', '28': 'Multi-Modal Logistics',
  '29': 'Autonomous Readiness', '30': 'Executive Strategy Suite',
  '31': 'Compliance & Regulatory', '32': 'Financial Risk & FX',
  '33': 'Driver Welfare & HR', '34': 'Cybersecurity Ops',
  '35': 'Predictive Network Intel',
};

const MODULE_QUICK_ACTIONS = {
  overview: [
    { label: 'INCIDENT BRIEF',     text: 'Give me a full situational briefing on all active SEV-1 and SEV-2 incidents across the network right now. Include multi-signal detection sources, current response status, and escalation path.' },
    { label: 'ETA RISK SCAN',      text: 'Run an ETA risk scan across all active shipments. Identify those with >70% SLA breach probability. For each, provide: P50/P80/P95 ETA, root cause with contribution weight, and reroute recommendation with cost/time delta.' },
    { label: 'WHAT-IF: FUEL +30%', text: 'Run a what-if scenario: What happens to our network if fuel prices rise 30% tomorrow? Model cost delta, service level impact, CO₂ change, revenue at risk, and the AI-recommended response strategy over a 12-month rolling horizon.' },
    { label: 'BORDER INTEL',       text: 'What are current border crossing conditions and wait times for our highest-volume corridors? Include pre-clearance status, HS code confidence levels, and any active sanctions screening flags.' },
    { label: 'VENDOR RISK',        text: 'Run a vendor concentration risk analysis. Flag any single-source dependencies exceeding 35% of critical lanes or commodities. Model "what if Supplier X fails?" for each flagged dependency. Include diversification options with switching cost.' },
    { label: 'CARBON REPORT',      text: 'Generate a CO₂e emissions summary for today. Include Scope 1/2/3 breakdown, per-customer attribution (tonne-km methodology), idle emission waste cost, top 5 carbon-intensive lanes, and offset recommendations.' },
    { label: 'SLA HEALTH',         text: 'Which customers are at risk of SLA breach in the next 60 minutes? For each: current metric trajectory, breach probability, impacted SLA clause, intervention options ranked by effectiveness and cost, and decision window.' },
    { label: 'STRATEGIC BRIEF',    text: 'Generate the weekly strategic AI brief for the C-suite: top 5 operational performance signals, top 3 external risk developments, 2 strategic recommendations with financial impact estimates, and 1 competitive intelligence signal. Max 2 pages.' },
  ],
  '01': [
    { label: 'SHIPMENT STATUS',    text: 'What is the current status of all high-risk shipments (risk score ≥65)? Include P80 ETA, primary delay driver with contribution weight, and recommended action with decision window.' },
    { label: 'ANOMALY SCAN',       text: 'Run a real-time anomaly scan across all active shipments. Flag any route deviations >500m, unscheduled stops >8min, weight inconsistencies, or door events at unplanned locations.' },
    { label: 'ROOT CAUSE DRILL',   text: 'Analyse the top 5 delay patterns in the last 7 days. Use causal inference to distinguish traffic vs driver vs customs vs weather delays. Surface systemic patterns across the fleet.' },
    { label: 'SUPPLIER CASCADE',   text: 'Are any Tier 2 or Tier 3 supplier disruptions currently propagating downstream? Model the cascade: which POs are at risk, which customer orders are affected, and what is the revenue exposure?' },
  ],
  '02': [
    { label: 'INVENTORY STATUS',   text: 'What is the current inventory health across all warehouse nodes? Flag any FEFO/FIFO compliance risks, quarantined stock, and bins approaching capacity thresholds.' },
    { label: 'LABOUR FORECAST',    text: 'Can we hit today\'s wave plan cutoffs given current labour throughput? Model shift completion times and flag where we need reallocation or overtime authorisation.' },
    { label: 'SLOTTING REVIEW',    text: 'What are the top 10 re-slotting recommendations based on 30-day velocity? Quantify projected travel time savings in hours per week per picker.' },
    { label: 'SAFETY ALERTS',      text: 'Show all personnel-forklift proximity events in the last 24 hours. Include near-miss count, zones affected, and weekly safety trend for the safety officer report.' },
  ],
  '03': [
    { label: 'BORDER QUEUE NOW',   text: 'What are live border crossing conditions on our top 5 highest-volume corridors? Include queue wait time with confidence interval, lane-specific recommendation, and data freshness.' },
    { label: 'PRE-CLEARANCE',      text: 'Which active shipments are not yet pre-cleared and are approaching their border crossing window? Flag document discrepancies that need resolution before departure.' },
    { label: 'DUTY OPTIMISATION',  text: 'Are there any active trade preference schemes (AGOA, EAC, EU-EPA, CPTPP) we are not maximising? Calculate duty savings opportunity across current shipment pipeline.' },
    { label: 'SANCTIONS SCAN',     text: 'Run a restricted party screening check for all active counterparties against OFAC, EU, and UN lists. Confirm last scan timestamp and flag any pending reviews.' },
  ],
  '07': [
    { label: 'RUN STRESS TEST',    text: 'Run the full pre-built stress test battery: pandemic lockdown, fuel shock +50%, top 3 carrier simultaneous failure, and cyber attack on customs systems. Output ranked response strategies by cost, lead time, and reversibility.' },
    { label: 'CASCADE MODEL',      text: 'Model a port strike scenario at our highest-volume hub. Compute all second and third-order cascade effects: container backlog, inland overflow, production line risk, SLA breach cascade, and churn probability.' },
    { label: 'SHADOW EXECUTION',   text: 'We are considering closing our secondary depot in the eastern region. Run this change in Shadow Execution Mode for 30 simulated days. Surface all predicted failure modes before we commit.' },
    { label: 'COUNTERFACTUAL',     text: 'For the last major SLA breach event, run the counterfactual: what would have happened if we had taken the alternative routing decision? Quantify the regret value.' },
  ],
  '08': [
    { label: 'DECISION LOG',       text: 'What autonomous decisions has the AI Decision Engine taken in the last 4 hours? Show: action taken, confidence score, input signals used, alternatives evaluated, and audit ledger reference.' },
    { label: 'CONFIDENCE AUDIT',   text: 'Is model confidence well-calibrated? Show predicted confidence vs actual accuracy over the last 30 days. Flag any systematic over or under-confidence patterns.' },
    { label: 'BIAS SCAN',          text: 'Run the quarterly fairness audit: check for unintended bias in carrier selection, lane profitability distribution, and driver assignment patterns. Surface any statistical anomalies.' },
    { label: 'OVERRIDE ANALYSIS',  text: 'Show all human overrides of AI recommendations in the last 7 days. What patterns emerge? Which decision types are overridden most often? What model recalibration events have been triggered?' },
  ],
  '09': [
    { label: 'ACTIVE INCIDENTS',   text: 'Full incident command briefing: all active SEV-1 through SEV-4 incidents. For each: detection method, current response status, assigned responders, escalation path, and resolution ETA.' },
    { label: 'PRE-INCIDENT INTEL', text: 'Run pre-incident intelligence scan. Which drivers have shown 3+ consecutive shifts with micro-fatigue signals? Which vehicles show elevated failure probability in the next 30 days?' },
    { label: 'WAR ROOM STATUS',    text: 'Are any incident war rooms currently active? Show: live telemetry summary, all assigned responders, last communication timestamp, and outstanding escalations.' },
    { label: 'AFTER-ACTION',       text: 'Generate the after-action review for the last closed SEV-1 or SEV-2 incident: AI root-cause analysis, contributing factor tree, timeline replay, prevention recommendations, and total cost of incident.' },
  ],
  '18': [
    { label: 'THREAT MAP NOW',     text: 'What is the current risk picture across our operational corridors? Include theft hotspot density, civil unrest advisories, weather hazards, and cyber threat indicators. All data within last 60 seconds.' },
    { label: 'CORRIDOR RISK',      text: 'Score all active freight corridors by composite risk index. Flag any where the index has increased >10 points in the last 24 hours. Include cargo-type-specific risk overlay.' },
    { label: 'GEOPOLITICAL BRIEF', text: 'What geopolitical developments in our operating regions in the last 72 hours could affect freight flows? Include border disruption probability, diplomatic tension signals, and recommended pre-positioning actions.' },
    { label: 'CYBER ADVISORY',     text: 'Are there any active cyber threats targeting logistics operators right now? Check: ransomware campaigns, GPS spoofing incidents, customs system outages, and fuel card fraud patterns.' },
  ],
  '19': [
    { label: 'EMISSIONS TODAY',    text: 'Generate today\'s CO₂e emissions report. Scope 1/2/3 breakdown. Per-customer attribution using tonne-km allocation. Top 5 emission-intensive lanes. Idle waste cost in $ and tonnes CO₂e.' },
    { label: 'CARBON ROUTING',     text: 'For our top 10 lanes by volume, show the three-way route comparison: fastest, cheapest, and lowest-emission options with their respective CO₂e, cost, and time values. Let the shipper choose.' },
    { label: 'EV TRANSITION',      text: 'Which routes in our network are ready for EV transition today? Model range sufficiency, charging infrastructure gaps, TCO crossover point vs diesel, and optimal electrification sequencing by depot.' },
    { label: 'OFFSET VERIFY',      text: 'Calculate our residual unavoidable emissions for this month. Source verified Gold Standard or VCS offset units. Generate the on-chain certificate with full provenance trail.' },
  ],
  '30': [
    { label: 'P&L FORECAST',       text: 'Generate a 12-month P&L projection under three scenarios: base case (current trend), optimistic (full pipeline conversion + efficiency gains), and stress case (fuel +40%, volume -20%, key carrier loss). Every assumption traceable.' },
    { label: 'BOARD REPORT',       text: 'Generate a board-ready report: ESG performance, operational excellence KPIs, strategic initiative status, and covenant compliance. Full data lineage available for audit committee.' },
    { label: 'MARKET EXPANSION',   text: 'Model entry into a new geography. Include: addressable market size, competitive landscape, regulatory entry requirements, capex+opex profile, revenue ramp projection, and risk-adjusted payback period.' },
    { label: 'CONCENTRATION RISK', text: 'Show our full concentration risk dashboard: single-customer, single-carrier, single-lane, and single-geography revenue exposure. Model the impact of losing any position >25% of a category.' },
  ],
};

const EPISTEMIC_MODES = [
  { mode: 'CERTAINTY',         color: 'var(--green)',  desc: 'Direct sensor data / confirmed ledger facts' },
  { mode: 'HIGH CONFIDENCE',   color: 'var(--cyan)',   desc: '≥85% model probability' },
  { mode: 'INFERENCE',         color: 'var(--amber)',  desc: 'Derived from correlated signals' },
  { mode: 'PROJECTION',        color: 'var(--purple)', desc: 'Forward-looking model output' },
  { mode: 'ASSUMPTION',        color: 'var(--orange)', desc: 'Input data missing, assumption made' },
  { mode: 'UNKNOWN',           color: 'var(--red)',    desc: 'Outside data availability — flagged' },
];

const USER_CLASS_CONTEXT = {
  operator:   'The current user is an OPERATOR (dispatcher/fleet manager/supervisor). Respond with concise, action-first guidance. One clear recommendation, quantified outcome, named actor, time window. 3–5 sentences + data. Lead with the decision needed.',
  strategist: 'The current user is a STRATEGIST (C-suite/logistics director/procurement head). Respond with structured narrative. Lead with the implication or exposure. 2–4 paragraphs with supporting data, P&L context, and strategic optionality.',
  field:      'The current user is a FIELD ACTOR (driver/warehouse staff/contractor). Respond in plain, simple language. Lead with exactly what to do right now. Maximum 1–3 sentences. Safety first. Assume low-bandwidth, high-pressure context.',
  system:     'The current user is a SYSTEM ACTOR (API/automation/webhook). Respond with schema-valid JSON only. All fields typed and fully specified. Error states explicitly modelled. Zero ambiguity. No prose.',
};

const AUTONOMY_CONTEXT = {
  1: 'Operating at AUTONOMY LEVEL 1 — ADVISORY. Provide recommendations only. All actions require human approval. Include: primary rationale, confidence level, key input signals, alternative considered, and decision window.',
  2: 'Operating at AUTONOMY LEVEL 2 — AUTO-DRAFT + HUMAN APPROVAL. Prepare the full action package with rationale, projected outcome (with confidence), risk if declined, and a clear approve/reject recommendation. Escalate if no response within SLA window.',
  3: 'Operating at AUTONOMY LEVEL 3 — FULLY AUTONOMOUS EXECUTION. Execute end-to-end when confidence meets threshold and context is non-anomalous. Log full reasoning chain to Immutable Audit Ledger. Pause and escalate if confidence drops mid-execution.',
};

function detectStatusTag(text) {
  const upper = text.toUpperCase();
  if (upper.includes('ACTION REQUIRED')) return 'action-required';
  if (upper.includes('ACTION TAKEN')) return 'action-taken';
  if (upper.includes('MONITORING ACTIVE')) return 'monitoring';
  return null;
}

function StatusTag({ type }) {
  const cfg = {
    'action-required': { cls: 'action-required', label: '⚠ ACTION REQUIRED' },
    'monitoring':      { cls: 'monitoring',       label: '◉ MONITORING ACTIVE' },
    'action-taken':    { cls: 'action-taken',      label: '✓ ACTION TAKEN' },
  };
  const c = cfg[type];
  if (!c) return null;
  return <div className={`message-status ${c.cls}`}>{c.label}</div>;
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  const time = new Date(msg.ts).toISOString().slice(11, 19);
  const statusType = !isUser ? detectStatusTag(msg.content) : null;

  return (
    <div className={`message ${msg.role}`}>
      <div className="message-avatar">{isUser ? 'OPR' : 'AI'}</div>
      <div className="message-body">
        <div className="message-meta">
          <span className="message-sender">{isUser ? 'OPERATOR' : 'MLOS COPILOT'}</span>
          <span className="message-time">{time} UTC</span>
        </div>
        <div className="message-bubble">{msg.content}</div>
        {!isUser && <StatusTag type={statusType} />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="message assistant">
      <div className="message-avatar" style={{ background: 'var(--amber-glow)', border: '1px solid var(--amber)', color: 'var(--amber)' }}>AI</div>
      <div className="message-body">
        <div className="message-meta">
          <span className="message-sender" style={{ color: 'var(--amber)' }}>MLOS COPILOT</span>
          <span className="message-time">processing across 7 reasoning modes...</span>
        </div>
        <div className="typing-indicator">
          <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

export default function ChatArea({ apiKey, activeModule, userClass, autonomyLevel }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showEpistemic, setShowEpistemic] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const moduleName = activeModule !== 'overview' ? MODULE_NAMES[activeModule] : null;
  const quickActions = MODULE_QUICK_ACTIONS[activeModule] || MODULE_QUICK_ACTIONS['overview'];

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    setError('');

    const userMsg = { role: 'user', content: text.trim(), ts: Date.now() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    // Build full context-aware system prompt
    let systemPrompt = MLOS_SYSTEM_PROMPT;
    systemPrompt += `\n\n---\n## ACTIVE SESSION CONTEXT\n`;
    systemPrompt += `\n### USER CLASS (§1.3)\n${USER_CLASS_CONTEXT[userClass] || USER_CLASS_CONTEXT.operator}`;
    systemPrompt += `\n### AUTONOMY LEVEL (§8)\n${AUTONOMY_CONTEXT[autonomyLevel] || AUTONOMY_CONTEXT[1]}`;
    if (moduleName) {
      systemPrompt += `\n### ACTIVE MODULE\nThe operator is currently viewing MODULE ${activeModule} — ${moduleName}. Prioritise responses relevant to this module while remaining available for cross-module queries.`;
    }
    systemPrompt += `\n### RESPONSE OBLIGATION\nEvery response MUST close with one of: ACTION REQUIRED / ACTION TAKEN / MONITORING ACTIVE / NO ACTION NEEDED — [REASON]. Never omit this state declaration.`;

    try {
      const key = apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!key) throw new Error('NO_API_KEY');

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
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

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${resp.status}`);
      }

      const data = await resp.json();
      const content = data.content?.map(b => b.text || '').join('') || '';
      setMessages(prev => [...prev, { role: 'assistant', content, ts: Date.now() }]);
    } catch (e) {
      if (e.message === 'NO_API_KEY') {
        setError('No API key configured. Set VITE_ANTHROPIC_API_KEY in .env or enter one at the auth screen.');
      } else {
        setError(`MLOS API FAULT: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-icon"><Cpu size={16} /></div>
        <div className="chat-header-info">
          <div className="chat-header-title">MLOS COPILOT · AUTONOMOUS LOGISTICS CORTEX</div>
          <div className="chat-header-subtitle">
            COMPOUND AI · 7 REASONING MODES · 35 DOMAINS · PRIORITY: HUMAN LIFE → SAFETY → COMPLIANCE
          </div>
        </div>
        <button onClick={() => setShowEpistemic(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: showEpistemic ? 'var(--purple-glow)' : 'transparent', border: `1px solid ${showEpistemic ? 'var(--purple)' : 'var(--border-mid)'}`, fontFamily: 'var(--font-mono)', fontSize: 9, color: showEpistemic ? 'var(--purple)' : 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.06em' }}>
          <Info size={10} />
          EPISTEMIC KEY
        </button>
        {moduleName && (
          <div className="chat-module-tag">MOD {activeModule} · {moduleName.toUpperCase()}</div>
        )}
      </div>

      {/* Epistemic Modes Panel */}
      {showEpistemic && (
        <div style={{ padding: '10px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', alignSelf: 'center' }}>§1.6 EPISTEMIC MODES:</div>
          {EPISTEMIC_MODES.map(em => (
            <div key={em.mode} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: em.color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: em.color, fontWeight: 700 }}>{em.mode}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>— {em.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Messages / Welcome */}
      <div className="chat-messages">
        {messages.length === 0 && !loading ? (
          <div className="chat-welcome">
            <div className="welcome-emblem">
              <div className="welcome-emblem-inner" />
            </div>
            <div>
              <div className="welcome-title">MLOS <span>COPILOT</span></div>
              <div className="welcome-subtitle">Sovereign Edition · Full System Prompt Loaded · {moduleName ? `Module ${activeModule} Active` : 'All 35 Modules Available'}</div>
            </div>
            <div className="welcome-description">
              {moduleName
                ? `Module ${activeModule} — ${moduleName} context loaded. The copilot will prioritise responses for this domain while remaining available for cross-module queries.`
                : 'The autonomous intelligence layer of the world\'s first fully self-healing, self-optimising, self-negotiating Logistics Operating System. Every dollar, kilogram, kilometre, and minute — optimised.'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textAlign: 'center' }}>
              SELECT A QUICK COMMAND OR TYPE YOUR OWN · SHIFT+ENTER FOR MULTILINE
            </div>
            <div className="quick-actions">
              {quickActions.map((qa, i) => (
                <button key={i} className="quick-action" onClick={() => sendMessage(qa.text)}>
                  <div className="quick-action-label">
                    <ChevronRight size={8} style={{ display: 'inline', marginRight: 3 }} />
                    {qa.label}
                  </div>
                  <div className="quick-action-text">{qa.text.slice(0, 80)}...</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => <Message key={i} msg={m} />)}
            {loading && <TypingIndicator />}
            {error && (
              <div className="error-banner">
                <span>⚠</span><span>{error}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrap">
          <textarea ref={textareaRef} rows={1} value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder="Issue a command to MLOS Copilot... (Enter to send · Shift+Enter for new line)"
            disabled={loading}
          />
          <button className="chat-send-btn" onClick={() => sendMessage(input)} disabled={!input.trim() || loading}>
            <Send size={14} />
          </button>
        </div>
        <div className="chat-input-footer">
          <span className="chat-input-hint">
            ⬡ MLOS v2.0 · SOVEREIGN EDITION · FULL PROMPT ACTIVE · ALL DECISIONS AUDIT-LOGGED · HUMAN OVERRIDE ALWAYS AVAILABLE
          </span>
          <div className="chat-input-actions">
            {messages.length > 0 && (
              <button className="input-action-btn" onClick={() => { setMessages([]); setError(''); }}>CLEAR SESSION</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
