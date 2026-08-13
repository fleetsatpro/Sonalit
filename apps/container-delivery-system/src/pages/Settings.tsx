import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

type SettingsTab = 'profile' | 'notifications' | 'integrations' | 'team' | 'security';

const integrations = [
  { name: 'SecuriSat', description: 'Electronic lock management and GPS tracking', status: 'connected', icon: 'SS', color: '#ff7a00' },
  { name: 'WhatsApp Business', description: 'AI Inbox message intake and driver communications', status: 'connected', icon: 'WA', color: '#25d366' },
  { name: 'KRA eCitizen', description: 'Kenya Revenue Authority customs integration', status: 'configured', icon: 'KR', color: '#33d6a8' },
  { name: 'KPA Port', description: 'Kenya Ports Authority container tracking', status: 'configured', icon: 'KP', color: '#ffb020' },
  { name: 'Safaricom SMS', description: 'SMS notifications via Safaricom API', status: 'disconnected', icon: 'SF', color: '#6b7380' },
  { name: 'Email (SMTP)', description: 'Transactional email for alerts and reports', status: 'connected', icon: 'EM', color: '#33d6a8' },
];

const teamMembers = [
  { name: 'Operations Admin', role: 'admin', members: 2, permissions: 'Full access' },
  { name: 'Dispatch Officer', role: 'dispatch', members: 4, permissions: 'Shipments, vehicles, drivers, live tracking' },
  { name: 'Port Officer', role: 'port', members: 3, permissions: 'Delivery ops, containers, locks' },
  { name: 'Customer Manager', role: 'customer_mgr', members: 2, permissions: 'Customers, reports, documents' },
  { name: 'Viewer', role: 'viewer', members: 6, permissions: 'Read-only dashboard and reports' },
];

const statusVariants: Record<string, 'ok' | 'warn' | 'neutral'> = { connected: 'ok', configured: 'warn', disconnected: 'neutral' };

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('profile');

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Settings"
        description="Account, notifications, integrations, and platform configuration."
      />

      <Tabs
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'notifications', label: 'Notifications' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'team', label: 'Team & Roles' },
          { id: 'security', label: 'Security' },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as SettingsTab)}
        variant="underline"
      />

      <div className="mt-4">
        {tab === 'profile' && (
          <div className="max-w-lg space-y-4">
            <Card className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-cds-orange flex items-center justify-center text-[22px] font-bold text-white">KO</div>
                <div>
                  <div className="text-sm-tight font-semibold">Kelvin Omondi</div>
                  <div className="text-xs-tight text-text-2">Operations Manager · Shift A</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Full Name</label>
                  <input type="text" defaultValue="Kelvin Omondi" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Email</label>
                  <input type="email" defaultValue="kelvin@sonalit.co.ke" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Phone</label>
                  <input type="text" defaultValue="+254 720 •• 090" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Timezone</label>
                  <select defaultValue="Africa/Nairobi" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2">
                    <option>Africa/Nairobi</option>
                    <option>UTC</option>
                  </select>
                </div>
              </div>
              <Button>Save Changes</Button>
            </Card>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="max-w-lg space-y-3">
            {[
              { label: 'Tamper Alerts', description: 'Immediate notification when lock tamper is detected', email: true, push: true, sms: false },
              { label: 'Battery Warnings', description: 'Alert when lock battery drops below 15%', email: true, push: true, sms: false },
              { label: 'Geofence Breaches', description: 'Route deviation and unauthorized entry/exit', email: true, push: true, sms: true },
              { label: 'Delivery Completed', description: 'Confirmation when shipment is delivered', email: true, push: false, sms: false },
              { label: 'Incident Reports', description: 'New incidents requiring investigation', email: true, push: true, sms: true },
              { label: 'Daily Digest', description: 'Daily operations summary at end of shift', email: true, push: false, sms: false },
            ].map((n) => (
              <Card key={n.label} className="p-3.5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs-tight font-semibold text-text-0">{n.label}</div>
                    <div className="text-2xs text-text-2 mt-0.5">{n.description}</div>
                  </div>
                  <div className="flex gap-3 items-center">
                    {[
                      { label: 'Email', enabled: n.email },
                      { label: 'Push', enabled: n.push },
                      { label: 'SMS', enabled: n.sms },
                    ].map((ch) => (
                      <label key={ch.label} className="flex items-center gap-1 text-2xs font-mono text-text-2 cursor-pointer">
                        <input type="checkbox" defaultChecked={ch.enabled} className="accent-cds-orange" />
                        {ch.label}
                      </label>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'integrations' && (
          <div className="grid grid-cols-2 gap-3 max-w-3xl">
            {integrations.map((intg) => (
              <Card key={intg.name} className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-[36px] h-[36px] rounded-lg flex items-center justify-center text-xs-tight font-bold flex-none"
                    style={{ background: `${intg.color}18`, color: intg.color }}
                  >
                    {intg.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm-tight font-semibold text-text-0">{intg.name}</span>
                      <Badge variant={statusVariants[intg.status] ?? 'neutral'}>{intg.status.toUpperCase()}</Badge>
                    </div>
                    <div className="text-2xs text-text-2 mt-0.5">{intg.description}</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="ghost">Configure</Button>
                  {intg.status === 'disconnected' && <Button size="sm">Connect</Button>}
                  {intg.status === 'connected' && <Button size="sm" variant="ghost">Test</Button>}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'team' && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs-tight text-text-2">{teamMembers.reduce((a, t) => a + t.members, 0)} team members across {teamMembers.length} roles</span>
              <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
                Invite Member
              </Button>
            </div>
            <div className="glass p-0">
              <table className="w-full border-collapse text-xs-tight">
                <thead>
                  <tr>
                    {['Role', 'Members', 'Permissions', ''].map((h) => (
                      <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((tm) => (
                    <tr key={tm.role} className="border-t border-hair hover:bg-ink-2 transition-colors">
                      <td className="px-3.5 py-3 text-text-0 font-semibold">{tm.name}</td>
                      <td className="px-3.5 py-3 font-mono text-text-0">{tm.members}</td>
                      <td className="px-3.5 py-3 text-text-1 text-2xs">{tm.permissions}</td>
                      <td className="px-3.5 py-3"><Button size="sm" variant="ghost">Edit</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="max-w-lg space-y-3">
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Password</div>
              <div className="text-2xs text-text-2 mb-3">Last changed 45 days ago</div>
              <Button variant="ghost">Change Password</Button>
            </Card>
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Two-Factor Authentication</div>
              <div className="text-2xs text-text-2 mb-3">Add an extra layer of security to your account</div>
              <div className="flex items-center gap-2">
                <Badge variant="neutral">NOT ENABLED</Badge>
                <Button>Enable 2FA</Button>
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Active Sessions</div>
              <div className="text-2xs text-text-2 mb-3">2 active sessions</div>
              <div className="space-y-2 text-xs-tight">
                <div className="flex items-center justify-between py-2 border-b border-hair">
                  <div>
                    <div className="text-text-0">Chrome · macOS — Nairobi</div>
                    <div className="text-2xs text-text-2 font-mono">Current session · 196.201.xx.xx</div>
                  </div>
                  <Badge variant="ok">CURRENT</Badge>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-text-0">Safari · iOS — Nairobi</div>
                    <div className="text-2xs text-text-2 font-mono">Last active 2h ago · 197.232.xx.xx</div>
                  </div>
                  <Button size="sm" variant="danger">Revoke</Button>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">API Keys</div>
              <div className="text-2xs text-text-2 mb-3">Manage API keys for third-party integrations</div>
              <Button variant="ghost">Manage API Keys</Button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
