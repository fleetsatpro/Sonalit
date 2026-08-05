// Alerts Page
import React from 'react';
import { Bell } from 'lucide-react';

export function AlertsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alerts</h1>
          <p className="text-gray-500">System notifications and alerts</p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
        <p className="text-gray-500">Alert management coming soon...</p>
      </div>
    </div>
  );
}
