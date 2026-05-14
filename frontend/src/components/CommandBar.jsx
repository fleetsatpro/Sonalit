import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Send, X, Zap, Clock, Loader, AlertTriangle, Truck, Navigation, Shield, Sparkles } from 'lucide-react';
import api from '../services/api';

const SUGGESTIONS = [
  { text: 'Fleet status overview',         icon: Truck         },
  { text: 'Show low fuel vehicles',        icon: Zap           },
  { text: 'List critical alerts',          icon: AlertTriangle },
  { text: 'Which vehicles are offline?',   icon: Navigation    },
  { text: 'Active convoys status',         icon: Shield        },
  { text: 'Vehicles needing maintenance',  icon: Clock         },
];

const SOURCE_BADGE = {
  claude:       { label: '✦ Claude AI',      cls: 'bg-purple-500/10 text-purple-300 border-purple-500/20' },
  unconfigured: { label: '⚙ Not configured', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20'   },
  error:        { label: '⚠ Error',          cls: 'bg-danger/10 text-danger border-danger/20'            },
};

export default function CommandBar() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);

  // Keyboard shortcut — Ctrl+K or Cmd+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (cmd) => {
    const command = (cmd || input).trim();
    if (!command || loading) return;
    setInput('');
    setLoading(true);
    const userMsg = { role: 'user', content: command, id: Date.now() };
    setMessages(m => [...m, userMsg]);

    try {
      const res = await api.post('/ai/dispatch', {
        command,
        history: history.slice(-6),
      });
      const { response, actions = [], source = 'pattern' } = res.data;
      const aiMsg = { role: 'assistant', content: response, actions, source, id: Date.now() + 1 };
      setMessages(m => [...m, aiMsg]);
      setHistory(h => [...h, { role: 'user', content: command }, { role: 'assistant', content: response }]);
    } catch (e) {
      const errMsg = e.response?.data?.error || e.message || 'Connection failed';
      setMessages(m => [...m, {
        role: 'assistant',
        content: `Unable to reach AI engine: ${errMsg}. Make sure the backend is running.`,
        source: 'error',
        id: Date.now() + 1,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, history]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clear = () => { setMessages([]); setHistory([]); };

  if (!open) return (
    // Floating trigger button — always visible
    <button
      onClick={() => setOpen(true)}
      title="AI Dispatch (Ctrl+K)"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9000,
        width: 48, height: 48,
        background: 'linear-gradient(135deg, rgba(240,180,41,0.15), rgba(240,180,41,0.05))',
        border: '1px solid rgba(240,180,41,0.35)',
        borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(12px)', transition: 'all .2s',
      }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <Sparkles size={18} color="#F0B429" />
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          width: '100%', maxWidth: 640, margin: '0 16px',
          background: '#080C14', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          maxHeight: '72vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ width:28, height:28, background:'rgba(240,180,41,0.12)', border:'1px solid rgba(240,180,41,0.25)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Sparkles size={13} color="#F0B429" />
          </div>
          <div>
            <p style={{ fontFamily:'monospace', fontSize:11, fontWeight:800, color:'#F0B429', letterSpacing:'0.15em', margin:0 }}>AI DISPATCH</p>
            <p style={{ fontFamily:'monospace', fontSize:9, color:'#475569', margin:0 }}>Natural language fleet intelligence</p>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            {messages.length > 0 && (
              <button onClick={clear} style={{ fontFamily:'monospace', fontSize:9, color:'#475569', background:'none', border:'1px solid rgba(255,255,255,0.06)', borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>
                CLEAR
              </button>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#22D3A0', animation:'pulse 2s infinite' }} />
              <span style={{ fontFamily:'monospace', fontSize:9, color:'#22D3A0' }}>ONLINE</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ padding:4, background:'none', border:'none', color:'#475569', cursor:'pointer', borderRadius:6 }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:12, minHeight:80 }}>
          {messages.length === 0 && (
            <div>
              <p style={{ fontFamily:'monospace', fontSize:10, color:'#475569', marginBottom:10, letterSpacing:'0.1em' }}>QUICK COMMANDS — CLICK OR TYPE BELOW:</p>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s.text)}
                    style={{
                      display:'flex', alignItems:'center', gap:8, padding:'10px 12px',
                      background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)',
                      borderRadius:10, cursor:'pointer', textAlign:'left', transition:'all .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background='rgba(240,180,41,0.05)'; e.currentTarget.style.borderColor='rgba(240,180,41,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'; }}
                  >
                    <s.icon size={12} color="#F0B429" style={{ flexShrink:0 }} />
                    <span style={{ fontSize:11, color:'#94a3b8', fontFamily:'sans-serif', lineHeight:1.3 }}>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} style={{ display:'flex', justifyContent: msg.role==='user'?'flex-end':'flex-start' }}>
              {msg.role === 'user' ? (
                <div style={{ maxWidth:'80%', background:'rgba(240,180,41,0.08)', border:'1px solid rgba(240,180,41,0.18)', borderRadius:'12px 12px 2px 12px', padding:'8px 12px' }}>
                  <p style={{ fontSize:13, color:'#e2e8f0', margin:0, lineHeight:1.5 }}>{msg.content}</p>
                </div>
              ) : (
                <div style={{ maxWidth:'90%', display:'flex', flexDirection:'column', gap:5, alignItems:'flex-start' }}>
                  <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'12px 12px 12px 2px', padding:'10px 14px' }}>
                    <p style={{ fontSize:13, color:'#e2e8f0', margin:0, lineHeight:1.6 }}>{msg.content}</p>
                    {msg.actions?.length > 0 && (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                        {msg.actions.map((a, i) => (
                          <span key={i} style={{ fontSize:10, fontFamily:'monospace', background:'rgba(240,180,41,0.1)', color:'#F0B429', border:'1px solid rgba(240,180,41,0.2)', padding:'2px 8px', borderRadius:20 }}>{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.source && SOURCE_BADGE[msg.source] && (
                    <span style={{ fontSize:9, fontFamily:'monospace', padding:'2px 8px', borderRadius:20, border:'1px solid', display:'inline-block' }}
                      className={SOURCE_BADGE[msg.source].cls}>
                      {SOURCE_BADGE[msg.source].label}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display:'flex', justifyContent:'flex-start' }}>
              <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'12px 12px 12px 2px', padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'rgba(240,180,41,0.6)', animation:'bounce 1s infinite', animationDelay:`${i*0.15}s` }} />
                ))}
                <span style={{ fontFamily:'monospace', fontSize:10, color:'#475569', marginLeft:4 }}>Analysing fleet data…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', padding:'12px 14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:12, padding:'8px 12px', transition:'border-color .2s' }}
            onFocus={e => e.currentTarget.style.borderColor='rgba(240,180,41,0.35)'}
            onBlur={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.10)'}
          >
            <Terminal size={13} color="#475569" style={{ flexShrink:0 }} />
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything about your fleet…"
              style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:13, color:'#e2e8f0', fontFamily:'sans-serif' }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center',
                background: input.trim() && !loading ? 'rgba(240,180,41,0.15)' : 'transparent',
                border:'1px solid ' + (input.trim() && !loading ? 'rgba(240,180,41,0.3)' : 'transparent'),
                borderRadius:8, cursor: input.trim() && !loading ? 'pointer' : 'default',
                transition:'all .15s', flexShrink:0,
              }}
            >
              {loading ? <Loader size={12} color="#F0B429" style={{ animation:'spin 1s linear infinite' }} /> : <Send size={12} color={input.trim() ? '#F0B429' : '#334155'} />}
            </button>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, padding:'0 2px' }}>
            <span style={{ fontFamily:'monospace', fontSize:9, color:'#334155' }}>ENTER to send · ESC to close</span>
            <span style={{ fontFamily:'monospace', fontSize:9, color:'#334155' }}>Ctrl+K to toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
