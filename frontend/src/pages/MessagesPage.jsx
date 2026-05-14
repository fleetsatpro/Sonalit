import { useEffect, useRef, useState } from 'react';
import { Send, Hash, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import { messagesAPI } from '../services/api';
import socketService from '../services/socket';
import { useAuthStore } from '../store';
import { Button, Card, Spinner } from '../components/UI';
import { formatDate, initials } from '../utils/helpers';

export default function MessagesPage() {
  const { user } = useAuthStore();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const bottomRef = useRef(null);
  const activeChannelRef = useRef(null);

  // Keep a ref of the active channel so the socket callback reads the current value
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);

  useEffect(() => {
    messagesAPI.channels().then((r) => {
      setChannels(r.data.data);
      if (r.data.data.length) setActiveChannel(r.data.data[0]);
    });

    const unsub = socketService.onMessageNew((data) => {
      if (!data.isBroadcast) {
        setMessages((prev) => {
          // Only append if it belongs to current channel
          if (data.channelId === activeChannelRef.current?.id) {
            return [...prev, { id: Date.now(), channel_id: data.channelId, content: data.content, sender_name: data.senderName, created_at: new Date().toISOString() }];
          }
          return prev;
        });
      } else {
        toast(`📢 Broadcast: ${data.content}`, { duration: 8000, style: { background: '#0D1321', color: '#F0B429', border: '1px solid rgba(240,180,41,0.3)' } });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    setLoadingMsgs(true);
    messagesAPI.messages(activeChannel.id).then((r) => {
      setMessages(r.data.data);
      setLoadingMsgs(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });
  }, [activeChannel?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const content = input.trim();
    if (!content || !activeChannel) return;
    setSending(true);
    setInput('');
    try {
      const r = await messagesAPI.send(activeChannel.id, content);
      setMessages((prev) => [...prev, r.data.data]);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Send failed');
      setInput(content);
    } finally { setSending(false); }
  };

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-bold text-gold tracking-widest">MESSAGES</h1>
        <p className="text-slate-500 text-sm font-mono mt-0.5">Channel communications</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[400px]">
        {/* Channel list */}
        <div className="w-52 flex-shrink-0 bg-navy-900 border border-white/5 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-white/5">
            <p className="text-xs font-mono uppercase tracking-widest text-slate-500">Channels</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {channels.map((ch) => (
              <button key={ch.id} onClick={() => setActiveChannel(ch)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors rounded-lg mx-1 w-[calc(100%-8px)]
                  ${activeChannel?.id === ch.id ? 'bg-gold/10 text-gold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                <Hash size={13} className="flex-shrink-0" />
                <span className="truncate">{ch.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Message thread */}
        <div className="flex-1 flex flex-col bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
            <Hash size={15} className="text-slate-500" />
            <p className="font-medium text-slate-200 text-sm">{activeChannel?.name}</p>
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-slow ml-auto" />
            <span className="text-xs font-mono text-slate-500">LIVE</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {loadingMsgs ? (
              <div className="flex justify-center pt-10"><Spinner /></div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-600">
                <Radio size={32} className="mb-3 opacity-30" />
                <p className="text-sm">No messages yet — start the comms</p>
              </div>
            ) : messages.map((m, i) => {
              const isMe = m.sender_id === user?.id || m.sender_name === user?.name;
              return (
                <div key={m.id ?? i} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold font-mono
                    ${isMe ? 'bg-gold/20 border border-gold/30 text-gold' : 'bg-navy-700 border border-white/10 text-slate-400'}`}>
                    {initials(m.sender_name ?? 'SYS')}
                  </div>
                  <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                    <div className={`flex items-center gap-2 text-[10px] font-mono text-slate-600 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-slate-500">{m.sender_name ?? 'System'}</span>
                      <span>{formatDate(m.created_at, { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className={`px-3.5 py-2.5 rounded-xl text-sm leading-relaxed
                      ${isMe ? 'bg-gold/15 border border-gold/20 text-slate-100 rounded-tr-sm' : 'bg-navy-800 border border-white/5 text-slate-200 rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/5 px-4 py-3 flex gap-3">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder={`Message #${activeChannel?.name ?? 'channel'}…`} rows={1}
              className="flex-1 bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none resize-none transition-colors leading-snug" />
            <Button onClick={send} loading={sending} disabled={!input.trim()}>
              <Send size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
