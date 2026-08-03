// Settings Page
import React from 'react';
import { Settings, Bell, Lock, User, Globe } from 'lucide-react';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-500">Manage application preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Profile Settings */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold">Profile</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name</label>
                <input type="text" className="w-full px-4 py-2 border rounded-lg" defaultValue="Admin User" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
                <input type="email" className="w-full px-4 py-2 border rounded-lg" defaultValue="admin@cds.io" />
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Changes</button>
            </div>
          </div>

          {/* Security Settings */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-6">
              <Lock className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold">Security</h3>
            </div>
            <button className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700">Change Password</button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-3 mb-4">
              <Globe className="w-5 h-5 text-gray-400" />
              <span className="font-medium">Language</span>
            </div>
            <select className="w-full px-4 py-2 border rounded-lg">
              <option>English</option>
              <option>Swahili</option>
              <option>French</option>
            </select>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-3 mb-4">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="font-medium">Notifications</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="w-4 h-4" defaultChecked />
              <span className="text-sm">Email notifications</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
