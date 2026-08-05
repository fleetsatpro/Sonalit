// Drivers Page
import React from 'react';
import { Plus, Search, User } from 'lucide-react';

export function DriversPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Drivers</h1>
          <p className="text-gray-500">Manage driver profiles and assignments</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">
          <Plus className="w-5 h-5" /> Add Driver
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
        <p className="text-gray-500">Driver management interface coming soon...</p>
      </div>
    </div>
  );
}
