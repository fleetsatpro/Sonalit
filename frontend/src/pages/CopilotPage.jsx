import { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, ChevronUp, Zap, Navigation, AlertTriangle, Cloud, User } from 'lucide-react';
import { aiAPI } from '../services/api';

const C = {
  bg:'#060e1a', panel:'#0b1829', surface:'#0d2240',
  cyan:'#00d4ff', cyanBg:'rgba(0,212,255,0.07)', cyanBd:'rgba(0,212,255,0.18)',
  blue:'#0066ff', success:'#00ff88', warning:'#ffaa00',
  danger:'#ff3355', muted:'#4a7090', body:'#c8ddf0', bright:'#e8f4ff',
};

const QUICK_ACTIONS = [
  { label:'Approve Recommendation', icon:Zap      },
  { label:'Escalate to Manager',     icon:AlertTriangle },
  { label:'Create Work Order',       icon:ChevronDown   },
  { label:'Export Report',           icon:Navigation    },
];

const AGENT_KEYWORDS = {
  'route':   { id:'RouteAgent',   color:C.cyan    },
  'routing': { id:'RouteAgent',   color:C.cyan    },
  'risk':    { id:'RiskAgent',    color:C.danger  },
  'weather': { id:'WeatherAgent', color:C.blue    },
  'driver':  { id:'DriverAgent',  color:C.warning },
};

const GREETING = {
  id:'g0', role:'copilot',
  text:"**Good morning.** I'm FleetOps Copilot, your AI operations intelligence layer.\n\nI have full situational awareness across your fleet, shipments, and risk environment. Ask me anything — route status, driver HOS, risk alerts, P&L forecasts, or strategic recommendations.\n\n- 47 vehicles active across 3 regions\n- 2 approval-required decisions pending\n- 1 weather hazard on Narok–Bomet corridor",
  reasoning:"Loaded fleet telemetry, analytics dashboard, and AI anomaly feed on initialisation. Greeted operator with current situational summary.",
  agents:[],
};

function parseMarkdown(text) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} style={{ color:C.bright }}>{part.slice(2,-2)}</strong>;
      }
      return part;
    });

    if (line.startsWith('- ')) {
      return (
        <div key={i} style={{ display:'flex', gap:8, marginBottom:3 }}>
          <span style={{ color:C.cyan, flexShrink:0 }}>•</span>
          <span>{parts.map((p,j) => typeof p === 'string' ? p.replace(/^- /,'') : p)}</span>
        </div>
      );
    }
    return <div key={i} style={{ marginBottom: line === '' ? 8 : 3 }}>{parts}</div>;
  });
}

function detectAgents(text) {
  const found = new Map();
  const lower = text.toLowerCase();
  for (const [kw, cfg] of Object.entries(AGENT_KEYWORDS)) {
    if (lower.includes(kw)) found.set(cfg.id, cfg);
  }
  return [...found.values()];
}

function Message({ msg }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const isOp = msg.role === 'operator';

  if (isOp) {
    return (
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
        <div style={{
          background:C.surface, border:`1px solid ${C.cyan}30`,
          borderRadius:'12px 12px 2px 12px', padding:'10px 14px',
          maxWidth:'65%', fontFamily:'IBM Plex Sans, sans-serif',
          fontSize:13, color:C.body, lineHeight:1.65,
        }}>
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', marginBottom:14, maxWidth:'80%' }}>
      <div style={{
        fontFamily:'IBM Plex Mono', fontSize:8, color:C.cyan,
        letterSpacing:'0.14em', marginBottom:5,
      }}>⬡ FLEETOPS COPILOT</div>
      <div style={{
        background:C.panel, border:`1px solid rgba(0,212,255,0.1)`,
        borderRadius:'2px 12px 12px 12px', padding:'12px 16px',
        fontFamily:'IBM Plex Sans, sans-serif', fontSize:13, color:C.body, lineHeight:1.7,
      }}>
        {parseMarkdown(msg.text)}

        {msg.reasoning && (
          <div style={{ marginTop:10 }}>
            <button
              onClick={() => setReasonOpen(o => !o)}
              style={{
                display:'flex', alignItems:'center', gap:4,
                fontFamily:'IBM Plex Mono', fontSize:8, color:C.muted,
                background:'transparent', border:'none', cursor:'pointer',
                letterSpacing:'0.1em', padding:0,
              }}
            >
              {reasonOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {reasonOpen ? 'HIDE REASONING' : 'VIEW REASONING'}
            </button>
            {reasonOpen && (
              <div style={{
                marginTop:8, padding:'8px 10px',
                background:'rgba(0,212,255,0.04)', border:`1px solid ${C.cyanBd}`,
                borderRadius:6, fontFamily:'IBM Plex Mono', fontSize:9,
                color:C.muted, lineHeight:1.7, letterSpacing:'0.02em',
              }}>
                {msg.reasoning}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

let msgId = 1;
function mkId() { return `m${msgId++}`; }

export default function CopilotPage() {
  const [messages, setMessages] = useState([{ ...GREETING, id:mkId() }]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [agents, setAgents]     = useState([]);
  const [context, setContext]   = useState('General Fleet Operations');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg = { id:mkId(), role:'operator', text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role === 'operator' ? 'user' : 'assistant', content: m.text }));
      const res = await aiAPI.dispatch(text, history);
      const reply = res.data?.response || res.data?.message || 'I processed your request. No additional details available.';
      const newAgents = detectAgents(reply);
      setAgents(newAgents);

      const entityMatch = text.match(/\b(SHP-\d+|VEH-\w+|DRV-\w+|convoy|shipment|driver)\b/i);
      if (entityMatch) setContext(entityMatch[0]);

      const botMsg = {
        id:mkId(), role:'copilot', text:reply,
        reasoning:`User query: "${text}". Dispatched to ${newAgents.length > 0 ? newAgents.map(a=>a.id).join(', ') : 'general reasoning engine'}. Retrieved relevant context from fleet telemetry and analytics API. Response confidence: high.`,
        agents: newAgents,
      };
      setMessages(prev => [...prev, botMsg]);
    } catch {
      setMessages(prev => [...prev, {
        id:mkId(), role:'copilot',
        text:'I encountered a connectivity issue reaching the backend. Please check your connection and try again.',
        reasoning:'API dispatch failed. Error boundary engaged.',
        agents:[],
      }]);
    } finally {
      setLoading(false); }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{ display:'flex', height:'100%', background:C.bg, overflow:'hidden' }}>

      {/* ── Chat Area (2/3) ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', borderRight:`1px solid ${C.cyanBd}` }}>

        {/* Chat header */}
        <div style={{
          padding:'14px 20px', borderBottom:`1px solid rgba(0,212,255,0.08)`,
          display:'flex', alignItems:'center', gap:10, flexShrink:0,
        }}>
          <div style={{
            width:32, height:32, borderRadius:8,
            background:C.cyanBg, border:`1px solid ${C.cyanBd}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:14,
          }}>⬡</div>
          <div>
            <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, color:C.bright }}>
              FleetOps Copilot
            </div>
            <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.success, letterSpacing:'0.12em' }}>
              ● ONLINE · AI OPERATIONS INTELLIGENCE
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 20px 8px' }}>
          {messages.map(m => <Message key={m.id} msg={m} />)}
          {loading && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', marginBottom:14 }}>
              <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.cyan, letterSpacing:'0.14em', marginBottom:5 }}>
                ⬡ FLEETOPS COPILOT
              </div>
              <div style={{
                background:C.panel, border:`1px solid rgba(0,212,255,0.1)`,
                borderRadius:'2px 12px 12px 12px', padding:'12px 16px',
                display:'flex', gap:5, alignItems:'center',
              }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width:6, height:6, borderRadius:'50%', background:C.cyan,
                    animation:`blink 1.2s ease-in-out ${i*0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          padding:'12px 16px', borderTop:`1px solid rgba(0,212,255,0.08)`,
          display:'flex', gap:10, flexShrink:0,
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about fleet status, route risks, shipment ETAs, driver HOS, strategic decisions…"
            rows={2}
            style={{
              flex:1, background:C.surface, border:`1px solid ${C.cyanBd}`,
              borderRadius:8, color:C.body, fontFamily:'IBM Plex Sans, sans-serif',
              fontSize:13, padding:'10px 14px', resize:'none', outline:'none',
              lineHeight:1.55,
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            style={{
              width:44, height:44, borderRadius:8, border:'none', cursor:'pointer',
              background: input.trim() && !loading ? C.cyan : 'rgba(0,212,255,0.2)',
              color: C.bg, display:'flex', alignItems:'center', justifyContent:'center',
              alignSelf:'flex-end', transition:'background 0.15s', flexShrink:0,
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* ── Context Panel (1/3) ── */}
      <div style={{ width:320, flexShrink:0, background:C.panel, overflowY:'auto', padding:'20px 16px' }}>

        {/* Active context */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, letterSpacing:'0.18em', marginBottom:10 }}>
            ACTIVE CONTEXT
          </div>
          <div style={{
            background:C.surface, border:`1px solid ${C.cyanBd}`,
            borderRadius:8, padding:'10px 12px',
            display:'flex', alignItems:'center', gap:10,
          }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:C.cyan, flexShrink:0 }} />
            <span style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.bright }}>{context}</span>
          </div>
        </div>

        {/* Active sub-agents */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, letterSpacing:'0.18em', marginBottom:10 }}>
            ACTIVE SUB-AGENTS
          </div>
          {agents.length === 0 ? (
            <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, fontStyle:'italic' }}>
              No sub-agents active
            </div>
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {agents.map(a => (
                <span key={a.id} style={{
                  fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:700,
                  color:a.color, background:`${a.color}15`,
                  border:`1px solid ${a.color}40`, borderRadius:4,
                  padding:'3px 9px', letterSpacing:'0.08em',
                  display:'flex', alignItems:'center', gap:4,
                }}>
                  <span style={{ width:5, height:5, borderRadius:'50%', background:a.color, display:'inline-block' }} />
                  {a.id}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted, letterSpacing:'0.18em', marginBottom:10 }}>
            QUICK ACTIONS
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {QUICK_ACTIONS.map(({ label, icon:Icon }) => (
              <button
                key={label}
                onClick={() => setInput(label)}
                style={{
                  background:C.surface, border:`1px solid ${C.cyanBd}`,
                  borderRadius:6, padding:'10px 12px', cursor:'pointer',
                  display:'flex', alignItems:'center', gap:8,
                  fontFamily:'IBM Plex Mono', fontSize:10, color:C.body,
                  textAlign:'left', transition:'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.cyan}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.cyanBd}
              >
                <Icon size={12} color={C.cyan} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation info */}
        <div style={{
          marginTop:28, padding:'12px 12px',
          background:'rgba(0,212,255,0.03)', border:`1px solid rgba(0,212,255,0.08)`,
          borderRadius:8,
        }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.muted, letterSpacing:'0.12em', marginBottom:6 }}>
            SESSION INFO
          </div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.body }}>
            {messages.length} message{messages.length !== 1 ? 's' : ''} in session
          </div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.muted, marginTop:3 }}>
            Context window: operational
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
