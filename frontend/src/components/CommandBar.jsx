import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Send, X, Zap, Clock, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

const SUGGESTIONS = [
  'Show all active convoys',
  'List vehicles with low fuel',
  'Show open critical alerts',
  'What is the risk score for Operation Alpha?',
  'How many vehicles are offline?',
];

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (cmd) => {
    const command = (cmd || input).trim();
    if (!command) return;
    setInput('');
    setLoading(true);
    const userMsg = { role: 'user', content: command, id: Date.now() };
    setMessages((m) => [...m, userMsg]);

    try {
      const res = await api.post('/ai/dispatch', {
        command,
        history: history.slice(-6),
      });
      const { response, actions, source } = res.data;
      const assistantMsg = { role: 'assistant', content: response, actions, source, id: Date.now() + 1 };
      setMessages((m) => [...m, assistantMsg]);
      setHistory((h) => [...h, { role: 'user', content: command }, { role: 'assistant', content: response }]);

      if (actions?.length) {
        const done = actions.filter((a) => a.done).length;
        if (done) toast.success(`${done} action${done > 1 ? 's' : ''} executed`);
      }
    } catch (err) {
      setMessages((m) => [...m, {
        role: 'assistant', content: 'Command failed — check backend connection.', id: Date.now() + 1,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, history]);

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-gold text-navy-950 px-4 py-2.5 rounded-xl font-mono text-xs font-bold shadow-lg hover:bg-gold/90 transition-all"
      title="AI Dispatch Assistant (⌘K)"
    >
      <Zap size={14} />
      AI DISPATCH
      <span className="opacity-60 text-[10px]">⌘K</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg bg-navy-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-gold/20 border border-gold/30 flex items-center justify-center">
            <Zap size={13} className="text-gold" />
          </div>
          <span className="text-sm font-mono font-bold text-gold tracking-wider">AI DISPATCH</span>
          <span className="text-[10px] font-mono text-slate-500 ml-auto">ESC to close</span>
          <button onClick={() => setOpen(false)} className="p-1 hover:text-white text-slate-500">
            <X size={14} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">Suggested commands</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 bg-navy-800 hover:bg-navy-700 border border-white/5 rounded-lg text-sm text-slate-300 transition-colors">
                  <ChevronRight size={12} className="text-gold flex-shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold font-mono
                ${m.role === 'user' ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-navy-700 text-slate-400 border border-white/10'}`}>
                {m.role === 'user' ? 'YOU' : 'AI'}
              </div>
              <div className={`max-w-[80%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed
                  ${m.role === 'user'
                    ? 'bg-gold/15 border border-gold/20 text-slate-100 rounded-tr-sm'
                    : 'bg-navy-800 border border-white/5 text-slate-200 rounded-tl-sm'}`}>
                  {m.content}
                </div>
                {m.actions?.filter(a => a.done).map((a, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] font-mono text-success">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    {a.type?.replace(/_/g, ' ')}
                  </div>
                ))}
                {m.source && (
                  <span className="text-[10px] font-mono text-slate-600">{m.source}</span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-navy-700 border border-white/10 flex items-center justify-center">
                <div className="w-3 h-3 border border-gold/40 border-t-gold rounded-full animate-spin" />
              </div>
              <div className="px-3 py-2 bg-navy-800 border border-white/5 rounded-xl rounded-tl-sm">
                <div className="flex gap-1">
                  {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/5 px-3 py-3 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Type a command or question..."
            className="flex-1 bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors"
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="px-3 py-2 bg-gold/20 hover:bg-gold/30 border border-gold/30 rounded-lg text-gold disabled:opacity-40 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
