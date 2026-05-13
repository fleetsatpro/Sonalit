import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Send, X, Zap, Clock, ChevronRight, Loader, AlertTriangle, Truck, Navigation, Shield } from 'lucide-react';
import api from '../services/api';

const SUGGESTIONS = [
  { text: 'Show fleet status overview',       icon: Truck     },
  { text: 'List vehicles with low fuel',       icon: Zap       },
  { text: 'Show open critical alerts',         icon: AlertTriangle },
  { text: 'How many vehicles are offline?',    icon: Navigation },
  { text: 'Show active convoys',               icon: Shield    },
  { text: 'Which vehicles need maintenance?',  icon: Clock     },
];

const SOURCE_BADGE = {
  claude:  { label: 'Claude AI',     color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  pattern: { label: 'Pattern Match', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  error:   { label: 'Error',         color: 'bg-danger/20 text-danger border-danger/30' },
};

export default function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = useCallback(async (cmd) => {
    const command = (cmd || input).trim();
    if (!command || loading) return;
    setInput('');
    setLoading(true);
    setMessages(m => [...m, { role: 'user', content: command, id: Date.now() }]);

    try {
      const res = await api.post('/ai/dispatch', { command, history: history.slice(-6) });
      const { response, actions = [], source = 'pattern' } = res.data;
      setMessages(m => [...m, { role: 'assistant', content: response, actions, source, id: Date.now() + 1 }]);
      setHistory(h => [...h, { role: 'user', content: command }, { role: 'assistant', content: response }]);
    } catch (e) {
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Unable to reach AI engine. Check backend connection.',
        source: 'error',
        id: Date.now() + 1,
      }]);
    } finally { setLoading(false); }
  }, [input, loading, history]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]"
      onClick={() => setOpen(false)}>
      <div
        className="relative w-full max-w-2xl mx-4 bg-[#080C14] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gold/20 border border-gold/30 rounded-lg flex items-center justify-center">
              <Zap size={12} className="text-gold" />
            </div>
            <span className="font-display text-xs font-bold text-gold tracking-widest">AI DISPATCH</span>
          </div>
          <div className="flex items-center gap-1.5 ml-1">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[9px] font-mono text-success">ONLINE</span>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto p-1 text-slate-600 hover:text-white rounded-lg hover:bg-white/5">
            <X size={14} />
          </button>
        </div>

        {/* Messages */}
        <div className="overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: '45vh', minHeight: 80 }}>
          {messages.length === 0 && (
            <div>
              <p className="text-xs text-slate-500 font-mono mb-3">QUICK COMMANDS:</p>
              <div className="grid grid-cols-2 gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s.text)}
                    className="flex items-center gap-2 px-3 py-2.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/10 rounded-xl text-left transition-all group">
                    <s.icon size={12} className="text-gold/60 group-hover:text-gold flex-shrink-0 transition-colors" />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-snug">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[80%] bg-gold/10 border border-gold/20 rounded-xl rounded-tr-sm px-3 py-2">
                  <p className="text-sm text-slate-200">{msg.content}</p>
                </div>
              ) : (
                <div className="max-w-[90%] space-y-1">
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl rounded-tl-sm px-3 py-2.5">
                    <p className="text-sm text-slate-200 leading-relaxed">{msg.content}</p>
                    {msg.actions?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.actions.map((a, i) => (
                          <span key={i} className="text-[10px] font-mono bg-gold/10 text-gold border border-gold/20 px-2 py-0.5 rounded-full">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.source && SOURCE_BADGE[msg.source] && (
                    <span className={`inline-block text-[9px] font-mono px-2 py-0.5 rounded-full border ${SOURCE_BADGE[msg.source].color}`}>
                      {SOURCE_BADGE[msg.source].label}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 bg-gold/60 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">Processing…</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] px-3 py-3">
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 focus-within:border-gold/30 rounded-xl px-3 py-2.5 transition-colors">
            <Terminal size={13} className="text-slate-500 flex-shrink-0" />
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything about your fleet…"
              className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="w-7 h-7 flex items-center justify-center bg-gold/10 hover:bg-gold/20 border border-gold/20 rounded-lg text-gold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? <Loader size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-1">
            <span className="text-[9px] font-mono text-slate-700">ENTER to send · ESC to close</span>
            <span className="text-[9px] font-mono text-slate-700">⌘K to toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
