import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { Send, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1', timeout: 25000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const C = {
  bg: '#060e1a', panel: '#0b1829', surface: '#0d2240',
  cyan: '#00d4ff', cyanBg: 'rgba(0,212,255,0.07)', cyanBd: 'rgba(0,212,255,0.18)',
  success: '#00ff88', danger: '#ff3355', muted: '#4a7090', body: '#c8ddf0', bright: '#e8f4ff',
};

const GREETING = {
  id: 'g0', role: 'copilot',
  text: "**Sonalit Copilot is ready.** Ask about active movements, route risk, shipment status, convoy operations, exceptions, or operational decisions. I will use the current Sonalit decision fabric and available operational context.",
  reasoning: 'Copilot is connected to the tenant-aware decision fabric. Live operational values are retrieved per request rather than hard-coded into the greeting.',
};

function parseMarkdown(text) {
  return String(text ?? '').split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} style={{ color: C.bright }}>{part.slice(2, -2)}</strong>;
      return part;
    });
    if (line.startsWith('- ')) return <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}><span style={{ color: C.cyan }}>•</span><span>{parts.map((p, j) => typeof p === 'string' ? p.replace(/^- /, '') : p)}</span></div>;
    return <div key={i} style={{ marginBottom: line === '' ? 8 : 3 }}>{parts}</div>;
  });
}

function Message({ msg }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  if (msg.role === 'operator') return <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}><div style={{ background: C.surface, border: `1px solid ${C.cyan}30`, borderRadius: '12px 12px 2px 12px', padding: '10px 14px', maxWidth: '75%', fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, color: C.body, lineHeight: 1.65 }}>{msg.text}</div></div>;
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 14, maxWidth: '88%' }}>
    <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.cyan, letterSpacing: '0.14em', marginBottom: 5 }}>⬡ SONALIT COPILOT</div>
    <div style={{ background: C.panel, border: '1px solid rgba(0,212,255,0.1)', borderRadius: '2px 12px 12px 12px', padding: '12px 16px', fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, color: C.body, lineHeight: 1.7, width: '100%' }}>
      {parseMarkdown(msg.text)}
      {msg.error && <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', border: `1px solid ${C.danger}35`, borderRadius: 6, color: C.danger, fontFamily: 'IBM Plex Mono', fontSize: 9 }}><AlertTriangle size={12} />{msg.error}</div>}
      {msg.reasoning && <div style={{ marginTop: 10 }}><button onClick={() => setReasonOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.muted, background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.1em', padding: 0 }}>{reasonOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}{reasonOpen ? 'HIDE CONTEXT' : 'VIEW CONTEXT'}</button>{reasonOpen && <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,212,255,0.04)', border: `1px solid ${C.cyanBd}`, borderRadius: 6, fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.muted, lineHeight: 1.7 }}>{msg.reasoning}</div>}</div>}
    </div>
  </div>;
}

let msgId = 1;
const mkId = () => `m${msgId++}`;

export default function CopilotPage() {
  const [messages, setMessages] = useState([{ ...GREETING, id: mkId() }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg = { id: mkId(), role: 'operator', text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role === 'operator' ? 'user' : 'assistant', content: m.text }));
      const res = await api.post('/ai/decision', { command: text, history });
      const data = res.data ?? {};
      const reply = data.answer || data.response || data.message || data.decision?.summary || 'The decision fabric returned no readable answer.';
      const degraded = data.meta?.degraded === true;
      setMessages(prev => [...prev, { id: mkId(), role: 'copilot', text: reply, reasoning: degraded ? 'The decision fabric answered in degraded mode after provider fallback.' : "Request routed through Sonalit’s tenant-aware decision fabric.", error: degraded ? 'AI provider capacity is currently constrained; this answer was produced through an available fallback path.' : undefined }]);
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.error || error?.response?.data?.message;
      setMessages(prev => [...prev, { id: mkId(), role: 'copilot', text: 'Copilot could not complete that request.', error: detail || (status === 401 || status === 403 ? 'Your Sonalit session is not authorized for Copilot.' : 'The Copilot decision service is unavailable. No fabricated operational data was shown.'), reasoning: `Decision request failed${status ? ` with HTTP ${status}` : ''}.` }]);
    } finally { setLoading(false); }
  }

  return <div style={{ height: '100%', background: C.bg, color: C.body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,212,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 32, height: 32, borderRadius: 8, background: C.cyanBg, border: `1px solid ${C.cyanBd}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⬡</div><div><div style={{ fontFamily: 'Syne, sans-serif', fontSize: 14, fontWeight: 700, color: C.bright }}>Sonalit Copilot</div><div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.success, letterSpacing: '0.12em' }}>● DECISION FABRIC · TENANT-AWARE</div></div></div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px' }}>{messages.map(m => <Message key={m.id} msg={m} />)}{loading && <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 8, color: C.cyan, letterSpacing: '0.14em', marginBottom: 14 }}>⬡ SONALIT COPILOT · ANALYZING…</div>}<div ref={bottomRef} /></div>
    <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(0,212,255,0.08)', display: 'flex', gap: 10 }}><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask Sonalit Copilot about routes, convoys, shipments, risk, exceptions, or decisions…" rows={2} style={{ flex: 1, background: C.surface, border: `1px solid ${C.cyanBd}`, borderRadius: 8, color: C.body, fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, padding: '10px 14px', resize: 'none', outline: 'none', lineHeight: 1.55 }} /><button onClick={send} disabled={!input.trim() || loading} aria-label="Send" style={{ width: 44, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer', background: input.trim() && !loading ? C.cyan : 'rgba(0,212,255,0.2)', color: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }}><Send size={16} /></button></div>
  </div>;
}
