import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

type SettingsTab = 'profile' | 'notifications' | 'integrations' | 'team' | 'security';

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
                <div className="w-16 h-16 rounded-xl bg-ink-3 flex items-center justify-center text-[22px] font-bold text-text-2">?</div>
                <div>
                  <div className="text-sm-tight font-semibold text-text-1">Profile</div>
                  <div className="text-xs-tight text-text-2">Configure in admin panel</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Full Name</label>
                  <input type="text" placeholder="Your name" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Email</label>
                  <input type="email" placeholder="your@email.com" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-2 uppercase tracking-wider mb-1">Phone</label>
                  <input type="text" placeholder="+254 7xx xxx xxx" className="w-full text-xs-tight bg-ink-2 border border-glass-border rounded-lg px-3 py-2" />
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
          <div className="max-w-lg">
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Notification Preferences</div>
              <div className="text-xs-tight text-text-2 mt-2">Configure in admin panel</div>
            </Card>
          </div>
        )}

        {tab === 'integrations' && (
          <div className="max-w-3xl">
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Integrations</div>
              <div className="text-xs-tight text-text-2 mt-2">Configure in admin panel</div>
            </Card>
          </div>
        )}

        {tab === 'team' && (
          <div className="max-w-2xl">
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Team & Roles</div>
              <div className="text-xs-tight text-text-2 mt-2">Configure in admin panel</div>
            </Card>
          </div>
        )}

        {tab === 'security' && (
          <div className="max-w-lg space-y-3">
            <Card className="p-4">
              <div className="text-sm-tight font-semibold text-text-0 mb-1">Password</div>
              <div className="text-2xs text-text-2 mb-3">Manage your password</div>
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
              <div className="text-xs-tight text-text-2 mt-2">Configure in admin panel</div>
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
