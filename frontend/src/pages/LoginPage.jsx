import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Zap, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store';
import { Button } from '../components/UI';

const schema = z.object({
  email: z.string().min(1, 'Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export default function LoginPage() {
  const [showPw, setShowPw] = useState(false);
  const [serverError, setServerError] = useState('');
  const { login, loading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

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
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4"
         style={{ backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(240,180,41,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(34,211,160,0.03) 0%, transparent 50%)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gold/10 border border-gold/30 rounded-2xl mb-5">
            <Zap size={32} className="text-gold" />
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-100 tracking-widest">FLEETOPS PRO</h1>
          <p className="text-slate-500 text-sm mt-1 font-mono tracking-wider">SECURE COMMAND INTERFACE</p>
        </div>

        {/* Card */}
        <div className="bg-navy-900 border border-white/10 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-widest mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@fleetops.local"
                {...register('email')}
                className={`w-full bg-navy-800 border ${errors.email ? 'border-danger/60' : 'border-white/10'} focus:border-gold/60 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors`}
              />
              {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className={`w-full bg-navy-800 border ${errors.password ? 'border-danger/60' : 'border-white/10'} focus:border-gold/60 rounded-xl px-4 py-3 pr-10 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors`}
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-danger">{errors.password.message}</p>}
            </div>

            {serverError && (
              <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger">
                {serverError}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full py-3 text-base mt-2">
              Authenticate
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-[11px] text-slate-600 font-mono text-center tracking-wider">
              DEMO — admin@fleetops.local / password123
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
