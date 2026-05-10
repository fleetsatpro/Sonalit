import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Zap, Eye, EyeOff, Shield, AlertCircle, Radio } from 'lucide-react';
import { useAuthStore } from '../store';

const schema = z.object({
  email:    z.string().min(1, 'Email required'),
  password: z.string().min(6, 'Minimum 6 characters'),
});

function TacticalGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0" style={{
        backgroundImage: `
          linear-gradient(rgba(240,180,41,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(240,180,41,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full"
           style={{ background: 'radial-gradient(circle, rgba(240,180,41,0.04) 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full"
           style={{ background: 'radial-gradient(circle, rgba(34,211,160,0.03) 0%, transparent 70%)' }} />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/10 to-transparent" />
    </div>
  );
}

function StatusTicker() {
  const [tick, setTick] = useState(0);
  const messages = [
    'SYSTEM NOMINAL · ALL NODES ONLINE',
    'ENCRYPTION ACTIVE · AES-256',
    'FLEET MONITORING · OPERATIONAL',
    'SECURE COMMS · ESTABLISHED',
  ];
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % messages.length), 3000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
      <span className="tracking-wider">{messages[tick]}</span>
    </div>
  );
}

export default function LoginPage() {
  const [showPw, setShowPw] = useState(false);
  const [serverError, setServerError] = useState('');
  const [bootDone, setBootDone] = useState(false);
  const { login, loading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    const t = setTimeout(() => setBootDone(true), 400);
    return () => clearTimeout(t);
  }, []);

  const onSubmit = async (data) => {
    setServerError('');
    const result = await login(data.email, data.password);
    if (result.ok) {
      navigate(from, { replace: true });
    } else {
      setServerError(result.error);
    }
  };

  return (
    <div className="min-h-screen bg-[#060B14] flex items-center justify-center px-4 relative">
      <TacticalGrid />

      <div className="absolute top-4 left-4 flex items-center gap-2 select-none">
        <div className="relative w-6 h-6">
          <div className="absolute inset-0 bg-gold/20 rounded blur-sm" />
          <div className="relative w-6 h-6 bg-gradient-to-br from-gold to-amber-600 rounded flex items-center justify-center">
            <Zap size={12} className="text-navy-950" />
          </div>
        </div>
        <span className="text-[11px] font-mono text-slate-600 tracking-[0.3em]">FLEETOPS PRO</span>
      </div>

      <div className="absolute top-4 right-4">
        <StatusTicker />
      </div>

      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-700 tracking-wider">v2.4.1 · SECURE</span>
        <div className="flex items-center gap-1.5">
          <Radio size={10} className="text-slate-700" />
          <span className="text-[10px] font-mono text-slate-700">ENCRYPTED CHANNEL</span>
        </div>
      </div>

      <div className={`w-full max-w-sm transition-all duration-500 ${bootDone ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-6">
            <div className="absolute inset-0 bg-gold/20 rounded-2xl blur-xl" />
            <div className="relative w-16 h-16 bg-gradient-to-br from-gold to-amber-600 rounded-2xl flex items-center justify-center shadow-2xl">
              <Zap size={28} className="text-navy-950" />
            </div>
            <div className="absolute -top-1 -left-1 w-3 h-3 border-t border-l border-gold/40 rounded-tl" />
            <div className="absolute -top-1 -right-1 w-3 h-3 border-t border-r border-gold/40 rounded-tr" />
            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b border-l border-gold/40 rounded-bl" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b border-r border-gold/40 rounded-br" />
          </div>
          <h1 className="font-display text-2xl font-black text-slate-100 tracking-[0.15em] mb-1">FLEETOPS</h1>
          <p className="text-[11px] font-mono text-slate-600 tracking-[0.35em]">TACTICAL COMMAND SYSTEM</p>
        </div>

        <div className="relative bg-[#0A0F1A] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="p-7">
            <div className="flex items-center gap-2 mb-6">
              <Shield size={12} className="text-gold/60" />
              <span className="text-[10px] font-mono text-slate-600 tracking-[0.2em]">AUTHENTICATE · SECURE ACCESS</span>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label className="block text-[10px] font-mono text-slate-500 tracking-[0.2em] mb-2 uppercase">Identity</label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="operator@fleetops.local"
                  {...register('email')}
                  className={`w-full bg-[#060B14] border ${errors.email ? 'border-danger/50' : 'border-white/[0.08] focus:border-gold/40'} rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono tracking-wide`}
                />
                {errors.email && (
                  <p className="mt-1.5 text-[11px] text-danger flex items-center gap-1">
                    <AlertCircle size={10} /> {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-500 tracking-[0.2em] mb-2 uppercase">Passphrase</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    {...register('password')}
                    className={`w-full bg-[#060B14] border ${errors.password ? 'border-danger/50' : 'border-white/[0.08] focus:border-gold/40'} rounded-xl px-4 py-3 pr-11 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono`}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-[11px] text-danger flex items-center gap-1">
                    <AlertCircle size={10} /> {errors.password.message}
                  </p>
                )}
              </div>

              {serverError && (
                <div className="flex items-start gap-2.5 bg-danger/5 border border-danger/20 rounded-xl px-4 py-3">
                  <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-danger/90 font-mono leading-relaxed">{serverError}</p>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full relative mt-2 py-3 rounded-xl font-display text-sm font-bold tracking-widest text-navy-950 transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden group"
                style={{ background: 'linear-gradient(135deg, #F0B429, #D97706)' }}>
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-navy-950/40 border-t-navy-950 rounded-full animate-spin" />
                    AUTHENTICATING…
                  </span>
                ) : 'AUTHENTICATE'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-white/[0.04]">
              <p className="text-[10px] font-mono text-slate-700 text-center tracking-wider leading-relaxed">
                DEMO · admin@fleetops.local<br />
                <span className="text-slate-800">password123</span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          {['KE', 'TZ', 'DRC', 'ML'].map(r => (
            <div key={r} className="flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="text-[9px] font-mono text-slate-700 tracking-widest">{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
