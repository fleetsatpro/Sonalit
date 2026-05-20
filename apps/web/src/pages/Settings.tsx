import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { useUIStore } from '../stores/ui.js';

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
});

const passwordSchema = z.object({
  current_password: z.string().min(1, 'Required'),
  new_password: z.string().min(8, 'Minimum 8 characters'),
  confirm_password: z.string().min(1, 'Required'),
}).refine((d) => d.new_password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

const INPUT_CLS = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { theme, setTheme } = useUIStore();

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: user ? { name: user.name, email: user.email } : undefined,
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileForm) => api.patch('/auth/profile', data),
    onSuccess: () => {
      profileForm.reset(profileForm.getValues());
    },
    onError: () => {
      profileForm.setError('root', { message: 'Failed to update profile.' });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordForm) => api.post('/auth/change-password', data),
    onSuccess: () => {
      passwordForm.reset();
    },
    onError: () => {
      passwordForm.setError('root', { message: 'Failed to change password. Check your current password.' });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <SectionCard title="Profile">
        <form
          onSubmit={profileForm.handleSubmit((v) => profileMutation.mutate(v))}
          className="space-y-4"
        >
          {profileForm.formState.errors.root && (
            <p className="text-red-400 text-sm">{profileForm.formState.errors.root.message}</p>
          )}
          {profileMutation.isSuccess && (
            <p className="text-green-400 text-sm">Profile updated successfully.</p>
          )}
          <div className="space-y-1">
            <label className="block text-sm text-slate-300">Name</label>
            <input {...profileForm.register('name')} className={INPUT_CLS} />
            {profileForm.formState.errors.name && (
              <p className="text-red-400 text-xs">{profileForm.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-300">Email</label>
            <input type="email" {...profileForm.register('email')} className={INPUT_CLS} />
            {profileForm.formState.errors.email && (
              <p className="text-red-400 text-xs">{profileForm.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-300">Role</label>
            <input value={user?.role ?? ''} disabled className={`${INPUT_CLS} opacity-50 cursor-not-allowed`} readOnly />
          </div>
          <button
            type="submit"
            disabled={profileMutation.isPending}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {profileMutation.isPending ? 'Saving…' : 'Save Profile'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Change Password">
        <form
          onSubmit={passwordForm.handleSubmit((v) => passwordMutation.mutate(v))}
          className="space-y-4"
        >
          {passwordForm.formState.errors.root && (
            <p className="text-red-400 text-sm">{passwordForm.formState.errors.root.message}</p>
          )}
          {passwordMutation.isSuccess && (
            <p className="text-green-400 text-sm">Password changed successfully.</p>
          )}
          {(['current_password', 'new_password', 'confirm_password'] as const).map((field) => (
            <div key={field} className="space-y-1">
              <label className="block text-sm text-slate-300 capitalize">
                {field.replace(/_/g, ' ')}
              </label>
              <input type="password" {...passwordForm.register(field)} className={INPUT_CLS} />
              {passwordForm.formState.errors[field] && (
                <p className="text-red-400 text-xs">{passwordForm.formState.errors[field]?.message}</p>
              )}
            </div>
          ))}
          <button
            type="submit"
            disabled={passwordMutation.isPending}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {passwordMutation.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Appearance">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Theme</p>
            <p className="text-xs text-slate-400">Choose between dark and light mode</p>
          </div>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${theme === t ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
