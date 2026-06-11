import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore, getAccessToken } from '../stores/auth.js';
import { Settings as SettingsIcon, Key, Shield, Copy, Trash2, Plus, X, MessageCircle } from 'lucide-react';
import { GuardianConvoySettings } from '../components/GuardianConvoySettings.js';
const AVAILABLE_SCOPES = ['read:fleet', 'write:fleet', 'read:incidents', 'write:incidents', 'read:reports', 'admin'];
const INPUT_CLS = 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500';
function SectionCard({ title, icon, children }) {
    return (<div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </div>);
}
function ProfileSection() {
    const user = useAuthStore((s) => s.user);
    const setAuth = useAuthStore((s) => s.setAuth);
    const [name, setName] = useState(user?.name ?? '');
    const [success, setSuccess] = useState(false);
    const mutation = useMutation({
        mutationFn: (payload) => api.patch('/auth/me', payload),
        onSuccess: (res) => {
            const token = getAccessToken();
            if (res.data && token)
                setAuth(token, res.data);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        },
    });
    return (<SectionCard title="Profile" icon={<SettingsIcon size={16} className="text-orange-400"/>}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)}/>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Email (read-only)</label>
          <input className={`${INPUT_CLS} opacity-50 cursor-not-allowed`} value={user?.email ?? ''} readOnly/>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Role</label>
          <span className="inline-block px-2 py-0.5 bg-blue-800 text-blue-200 rounded text-xs font-medium">
            {user?.role ?? '—'}
          </span>
        </div>
        {mutation.isError && <p className="text-red-400 text-xs">Failed to update profile.</p>}
        {success && <p className="text-green-400 text-xs">Profile updated.</p>}
        <button onClick={() => mutation.mutate({ name })} disabled={mutation.isPending || !name.trim()} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium">
          {mutation.isPending ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </SectionCard>);
}
function ChangePasswordSection() {
    const [form, setForm] = useState({ old_password: '', new_password: '', confirm: '' });
    const [success, setSuccess] = useState(false);
    const mutation = useMutation({
        mutationFn: (payload) => api.post('/auth/change-password', {
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
    return (<SectionCard title="Change Password" icon={<Shield size={16} className="text-orange-400"/>}>
      <div className="space-y-3">
        {['old_password', 'new_password', 'confirm'].map((field) => (<div key={field}>
            <label className="block text-xs text-slate-400 mb-1 capitalize">
              {field.replace(/_/g, ' ')}
            </label>
            <input type="password" className={INPUT_CLS} value={form[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}/>
          </div>))}
        {mismatch && <p className="text-red-400 text-xs">Passwords do not match.</p>}
        {mutation.isError && <p className="text-red-400 text-xs">Failed to change password.</p>}
        {success && <p className="text-green-400 text-xs">Password changed successfully.</p>}
        <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || mismatch || !form.old_password || !form.new_password} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium">
          {mutation.isPending ? 'Updating…' : 'Change Password'}
        </button>
      </div>
    </SectionCard>);
}
function ApiKeysSection() {
    const queryClient = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [newKey, setNewKey] = useState({ name: '', scopes: [], expires_at: '' });
    const [copiedId, setCopiedId] = useState(null);
    const { data: keys, isLoading } = useQuery({
        queryKey: ['api-keys'],
        queryFn: async () => {
            const res = await api.get('/auth/api-keys');
            return res.data;
        },
    });
    const createMutation = useMutation({
        mutationFn: (payload) => api.post('/auth/api-keys', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['api-keys'] });
            setShowCreate(false);
            setNewKey({ name: '', scopes: [], expires_at: '' });
        },
    });
    const revokeMutation = useMutation({
        mutationFn: (id) => api.delete(`/auth/api-keys/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
    });
    const toggleScope = (scope) => {
        setNewKey((f) => ({
            ...f,
            scopes: f.scopes.includes(scope)
                ? f.scopes.filter((s) => s !== scope)
                : [...f.scopes, scope],
        }));
    };
    const copyKey = (preview, id) => {
        navigator.clipboard.writeText(preview).catch(() => null);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };
    return (<SectionCard title="API Keys" icon={<Key size={16} className="text-orange-400"/>}>
      <div className="space-y-3">
        {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
        {keys?.map((k) => (<div key={k.id} className="flex items-center justify-between bg-slate-900 rounded p-3">
            <div>
              <p className="text-sm font-medium">{k.name}</p>
              <p className="text-xs font-mono text-slate-500">{k.key_preview}</p>
              <div className="flex gap-1 flex-wrap mt-1">
                {k.scopes.map((s) => (<span key={s} className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300">{s}</span>))}
              </div>
            </div>
            <div className="flex gap-2 ml-3">
              <button onClick={() => copyKey(k.key_preview, k.id)} className="p-1.5 text-slate-400 hover:text-white" title="Copy">
                <Copy size={14}/>
                {copiedId === k.id && <span className="sr-only">Copied!</span>}
              </button>
              <button onClick={() => revokeMutation.mutate(k.id)} disabled={revokeMutation.isPending} className="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-50" title="Revoke">
                <Trash2 size={14}/>
              </button>
            </div>
          </div>))}
        {keys?.length === 0 && <p className="text-slate-500 text-sm">No API keys.</p>}

        {showCreate ? (<div className="bg-slate-900 rounded p-3 space-y-3">
            <div className="flex justify-between">
              <span className="text-sm font-medium">New API Key</span>
              <button onClick={() => setShowCreate(false)}><X size={14}/></button>
            </div>
            <input className={INPUT_CLS} placeholder="Key name" value={newKey.name} onChange={(e) => setNewKey((f) => ({ ...f, name: e.target.value }))}/>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Scopes</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SCOPES.map((scope) => (<label key={scope} className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={newKey.scopes.includes(scope)} onChange={() => toggleScope(scope)} className="w-3 h-3"/>
                    {scope}
                  </label>))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expiry (optional)</label>
              <input type="date" className={INPUT_CLS} value={newKey.expires_at} onChange={(e) => setNewKey((f) => ({ ...f, expires_at: e.target.value }))}/>
            </div>
            {createMutation.isError && <p className="text-red-400 text-xs">Failed to create key.</p>}
            <button onClick={() => createMutation.mutate(newKey)} disabled={createMutation.isPending || !newKey.name} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm">
              {createMutation.isPending ? 'Creating…' : 'Create Key'}
            </button>
          </div>) : (<button onClick={() => setShowCreate(true)} className="flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300">
            <Plus size={14}/> New API Key
          </button>)}
      </div>
    </SectionCard>);
}
function TotpSection() {
    const [showSetup, setShowSetup] = useState(false);
    const [totpCode, setTotpCode] = useState('');
    const [verified, setVerified] = useState(false);
    const { data: setup, isLoading } = useQuery({
        queryKey: ['totp-setup'],
        queryFn: async () => {
            const res = await api.get('/auth/totp/setup');
            return res.data;
        },
        enabled: showSetup,
    });
    const verifyMutation = useMutation({
        mutationFn: (code) => api.post('/auth/totp/verify', { code }),
        onSuccess: () => {
            setVerified(true);
            setShowSetup(false);
        },
    });
    return (<SectionCard title="Two-Factor Authentication (TOTP)" icon={<Shield size={16} className="text-orange-400"/>}>
      {!showSetup ? (<div>
          {verified && <p className="text-green-400 text-sm mb-2">TOTP enabled successfully.</p>}
          <button onClick={() => setShowSetup(true)} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium">
            Set Up Authenticator
          </button>
        </div>) : (<div className="space-y-3">
          {isLoading && <p className="text-slate-400 text-sm">Loading QR code…</p>}
          {setup && (<>
              <p className="text-xs text-slate-400">Scan this QR code with your authenticator app:</p>
              <img src={setup.qr_url} alt="TOTP QR Code" className="w-40 h-40 bg-white rounded p-1"/>
              <p className="text-xs text-slate-500 font-mono break-all">Secret: {setup.secret}</p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Enter verification code</label>
                <input className={INPUT_CLS} placeholder="123456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6}/>
              </div>
              {verifyMutation.isError && <p className="text-red-400 text-xs">Invalid code. Try again.</p>}
              <div className="flex gap-2">
                <button onClick={() => verifyMutation.mutate(totpCode)} disabled={verifyMutation.isPending || totpCode.length !== 6} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium">
                  {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
                </button>
                <button onClick={() => setShowSetup(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                  Cancel
                </button>
              </div>
            </>)}
        </div>)}
    </SectionCard>);
}
function WhatsAppSection() {
    const qc = useQueryClient();
    const [form, setForm] = useState({ phone_number_id: '', access_token: '', verify_token: '', business_id: '', active: false });
    const [editing, setEditing] = useState(false);
    const { data } = useQuery({
        queryKey: ['whatsapp-config'],
        queryFn: () => api.get('/settings/whatsapp').then(r => r.data),
    });
    const saveMut = useMutation({
        mutationFn: (body) => api.put('/settings/whatsapp', body),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['whatsapp-config'] }); setEditing(false); },
    });
    const config = data?.data;
    return (<SectionCard title="WhatsApp Cloud API" icon={<MessageCircle size={16} className="text-green-400"/>}>
      {!editing ? (<div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-300">{config?.phone_number_id ? `Phone ID: ${config.phone_number_id}` : 'Not configured'}</p>
              <p className="text-xs text-slate-500">{config?.active ? '● Active' : '○ Inactive'}</p>
            </div>
            <button onClick={() => { setForm({ phone_number_id: config?.phone_number_id ?? '', access_token: '', verify_token: '', business_id: config?.business_id ?? '', active: config?.active ?? false }); setEditing(true); }} className="text-xs text-orange-400 hover:text-orange-300">Configure</button>
          </div>
        </div>) : (<div className="space-y-3">
          <input placeholder="Phone Number ID" value={form.phone_number_id} onChange={e => setForm(p => ({ ...p, phone_number_id: e.target.value }))} className={INPUT_CLS}/>
          <input placeholder="Access Token (leave blank to keep existing)" type="password" value={form.access_token} onChange={e => setForm(p => ({ ...p, access_token: e.target.value }))} className={INPUT_CLS}/>
          <input placeholder="Webhook Verify Token" value={form.verify_token} onChange={e => setForm(p => ({ ...p, verify_token: e.target.value }))} className={INPUT_CLS}/>
          <input placeholder="Business ID (optional)" value={form.business_id} onChange={e => setForm(p => ({ ...p, business_id: e.target.value }))} className={INPUT_CLS}/>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))}/>
            Enable WhatsApp broadcasts
          </label>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setEditing(false)} className="text-sm text-slate-400 hover:text-white">Cancel</button>
            <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending} className="text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saveMut.isError && <p className="text-red-400 text-xs">Failed to save WhatsApp config.</p>}
        </div>)}
    </SectionCard>);
}
export default function Settings() {
    return (<div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <SettingsIcon size={20} className="text-orange-400"/>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>
      <ProfileSection />
      <ChangePasswordSection />
      <ApiKeysSection />
      <TotpSection />
      <WhatsAppSection />
      <GuardianConvoySettings />
    </div>);
}
