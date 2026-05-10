import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Bell, Shield, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store';
import { authAPI } from '../services/api';
import { Card, Button, Input } from '../components/UI';
import { useLocalStorage } from '../hooks';
import { initials } from '../utils/helpers';

const pwSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'Must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Required'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [savingPw, setSavingPw] = useState(false);
  const [notifications, setNotifications] = useLocalStorage('notify_prefs', { alerts: true, convoys: true, messages: false });

  const { register, handleSubmit, formState: { errors }, reset } = useForm({ resolver: zodResolver(pwSchema) });

  const onChangePassword = async (data) => {
    setSavingPw(true);
    try {
      await authAPI.changePassword({ currentPassword: data.currentPassword, newPassword: data.newPassword });
      toast.success('Password updated');
      reset();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Password change failed');
    } finally { setSavingPw(false); }
  };

  const toggle = (key) => setNotifications((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-lg font-bold text-gold tracking-widest">SETTINGS</h1>
        <p className="text-slate-500 text-sm font-mono mt-0.5">Profile and preferences</p>
      </div>

      {/* Profile */}
      <Card header="Profile" action={<User size={14} className="text-slate-500" />}>
        <div className="p-5 flex items-center gap-5">
          <div className="w-14 h-14 rounded-xl bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <span className="font-display text-gold text-xl font-bold">{initials(user?.name)}</span>
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-slate-100">{user?.name}</p>
            <p className="text-sm text-slate-400">{user?.email}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-widest text-gold bg-gold/10 border border-gold/20 px-2 py-0.5 rounded">{user?.role}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-xs text-success font-mono">Active</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Change Password */}
      <Card header="Change Password" action={<Shield size={14} className="text-slate-500" />}>
        <div className="p-5 space-y-4">
          <Input label="Current Password" type="password" autoComplete="current-password"
            error={errors.currentPassword?.message} {...register('currentPassword')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="New Password" type="password" autoComplete="new-password"
              error={errors.newPassword?.message} {...register('newPassword')} />
            <Input label="Confirm New Password" type="password" autoComplete="new-password"
              error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          </div>
          <div className="pt-1">
            <Button loading={savingPw} onClick={handleSubmit(onChangePassword)}>
              <Save size={14} /> Update Password
            </Button>
          </div>
        </div>
      </Card>

      {/* Notification preferences */}
      <Card header="Notifications" action={<Bell size={14} className="text-slate-500" />}>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 font-mono">Browser notifications for real-time events. Token stored locally — no server changes required.</p>
          {[
            { key: 'alerts', label: 'Alert notifications', desc: 'Notify me when new high/critical alerts arrive' },
            { key: 'convoys', label: 'Convoy status changes', desc: 'Notify me when convoy status transitions' },
            { key: 'messages', label: 'New messages', desc: 'Notify me on new channel messages' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
              <div>
                <p className="text-sm text-slate-200">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
              <button onClick={() => toggle(key)}
                className={`relative w-10 h-5.5 h-6 rounded-full transition-colors duration-200 flex-shrink-0
                  ${notifications[key] ? 'bg-gold' : 'bg-navy-700 border border-white/10'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                  ${notifications[key] ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
