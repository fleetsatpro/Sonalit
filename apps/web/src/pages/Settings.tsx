import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore, getAccessToken } from '../stores/auth.js';
import { Settings as SettingsIcon, Key, Shield, Copy, Trash2, Plus, X } from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  key_preview: string;
}

interface TotpSetup {
  qr_url: string;
  secret: string;
}

interface UpdateNamePayload {
  name: string;
}

interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
  confirm: string;
}

interface CreateApiKeyPayload {
  name: string;
  scopes: string[];
  expires_at: string;
}

const AVAILABLE_SCOPES = ['read:fleet', 'write:fleet', 'read:incidents', 'write:incidents', 'read:reports', 'admin'];

const INPUT_CLS = 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500';

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [name, setName] = useState(user?.name ?? '');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: UpdateNamePayload) =>
      api.patch<typeof user>('/auth/me', payload),
    onSuccess: (res) => {
      const token = getAccessToken();
      if (res.data && token) setAuth(token, res.data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  return (
    <SectionCard title="Profile" icon={<SettingsIcon size={16} className="text-blue-400" />}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input
            className={INPUT_CLS}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Email (read-only)</label>
          <input className={`${INPUT_CLS} opacity-50 cursor-not-allowed`} value={user?.email ?? ''} readOnly />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Role</label>
          <span className="inline-block px-2 py-0.5 bg-blue-800 text-blue-200 rounded text-xs font-medium">
            {user?.role ?? '—'}
          </span>
        </div>
        {mutation.isError && <p className="text-red-400 text-xs">Failed to update profile.</p>}
        {success && <p className="text-green-400 text-xs">Profile updated.</p>}
        <button
          onClick={() => mutation.mutate({ name })}
          disabled={mutation.isPending || !name.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
        >
          {mutation.isPending ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </SectionCard>
  );
}

function ChangePasswordSection() {
  const [form, setForm] = useState<ChangePasswordPayload>({ old_password: '', new_password: '', confirm: '' });
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: ChangePasswordPayload) =>
      api.post('/auth/change-password', {
        old_password: payload.old_password,
        new_password: payload.new_password,
      }),
    onSuccess: () => {
      setForm({ old_password: '', new_password: '', confirm: '' });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  const mismatch = form.confirm.length > 0 && form.confirm !== form.new_password;

  return (
    <SectionCard title="Change Password" icon={<Shield size={16} className="text-blue-400" />}>
      <div className="space-y-3">
        {(['old_password', 'new_password', 'confirm'] as const).map((field) => (
          <div key={field}>
            <label className="block text-xs text-slate-400 mb-1 capitalize">
              {field.replace(/_/g, ' ')}
            </label>
            <input
              type="password"
              className={INPUT_CLS}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
            />
          </div>
        ))}
        {mismatch && <p className="text-red-400 text-xs">Passwords do not match.</p>}
        {mutation.isError && <p className="text-red-400 text-xs">Failed to change password.</p>}
        {success && <p className="text-green-400 text-xs">Password changed successfully.</p>}
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || mismatch || !form.old_password || !form.new_password}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
        >
          {mutation.isPending ? 'Updating…' : 'Change Password'}
        </button>
      </div>
    </SectionCard>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<CreateApiKeyPayload>({ name: '', scopes: [], expires_at: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await api.get<ApiKey[]>('/auth/api-keys');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateApiKeyPayload) =>
      api.post('/auth/api-keys', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setShowCreate(false);
      setNewKey({ name: '', scopes: [], expires_at: '' });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const toggleScope = (scope: string) => {
    setNewKey((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }));
  };

  const copyKey = (preview: string, id: string) => {
    navigator.clipboard.writeText(preview).catch(() => null);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <SectionCard title="API Keys" icon={<Key size={16} className="text-blue-400" />}>
      <div className="space-y-3">
        {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
        {keys?.map((k) => (
          <div key={k.id} className="flex items-center justify-between bg-slate-900 rounded p-3">
            <div>
              <p className="text-sm font-medium">{k.name}</p>
              <p className="text-xs font-mono text-slate-500">{k.key_preview}</p>
              <div className="flex gap-1 flex-wrap mt-1">
                {k.scopes.map((s) => (
                  <span key={s} className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300">{s}</span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 ml-3">
              <button
                onClick={() => copyKey(k.key_preview, k.id)}
                className="p-1.5 text-slate-400 hover:text-white"
                title="Copy"
              >
                <Copy size={14} />
                {copiedId === k.id && <span className="sr-only">Copied!</span>}
              </button>
              <button
                onClick={() => revokeMutation.mutate(k.id)}
                disabled={revokeMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-50"
                title="Revoke"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {keys?.length === 0 && <p className="text-slate-500 text-sm">No API keys.</p>}

        {showCreate ? (
          <div className="bg-slate-900 rounded p-3 space-y-3">
            <div className="flex justify-between">
              <span className="text-sm font-medium">New API Key</span>
              <button onClick={() => setShowCreate(false)}><X size={14} /></button>
            </div>
            <input
              className={INPUT_CLS}
              placeholder="Key name"
              value={newKey.name}
              onChange={(e) => setNewKey((f) => ({ ...f, name: e.target.value }))}
            />
            <div>
              <label className="block text-xs text-slate-400 mb-1">Scopes</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newKey.scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="w-3 h-3"
                    />
                    {scope}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expiry (optional)</label>
              <input
                type="date"
                className={INPUT_CLS}
                value={newKey.expires_at}
                onChange={(e) => setNewKey((f) => ({ ...f, expires_at: e.target.value }))}
              />
            </div>
            {createMutation.isError && <p className="text-red-400 text-xs">Failed to create key.</p>}
            <button
              onClick={() => createMutation.mutate(newKey)}
              disabled={createMutation.isPending || !newKey.name}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
          >
            <Plus size={14} /> New API Key
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function TotpSection() {
  const [showSetup, setShowSetup] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [verified, setVerified] = useState(false);

  const { data: setup, isLoading } = useQuery<TotpSetup>({
    queryKey: ['totp-setup'],
    queryFn: async () => {
      const res = await api.get<TotpSetup>('/auth/totp/setup');
      return res.data;
    },
    enabled: showSetup,
  });

  const verifyMutation = useMutation({
    mutationFn: (code: string) => api.post('/auth/totp/verify', { code }),
    onSuccess: () => {
      setVerified(true);
      setShowSetup(false);
    },
  });

  return (
    <SectionCard title="Two-Factor Authentication (TOTP)" icon={<Shield size={16} className="text-blue-400" />}>
      {!showSetup ? (
        <div>
          {verified && <p className="text-green-400 text-sm mb-2">TOTP enabled successfully.</p>}
          <button
            onClick={() => setShowSetup(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
          >
            Set Up Authenticator
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">Loading QR code…</p>}
          {setup && (
            <>
              <p className="text-xs text-slate-400">Scan this QR code with your authenticator app:</p>
              <img src={setup.qr_url} alt="TOTP QR Code" className="w-40 h-40 bg-white rounded p-1" />
              <p className="text-xs text-slate-500 font-mono break-all">Secret: {setup.secret}</p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Enter verification code</label>
                <input
                  className={INPUT_CLS}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  maxLength={6}
                />
              </div>
              {verifyMutation.isError && <p className="text-red-400 text-xs">Invalid code. Try again.</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => verifyMutation.mutate(totpCode)}
                  disabled={verifyMutation.isPending || totpCode.length !== 6}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
                >
                  {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  onClick={() => setShowSetup(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <SettingsIcon size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>
      <ProfileSection />
      <ChangePasswordSection />
      <ApiKeysSection />
      <TotpSection />
    </div>
  );
}
