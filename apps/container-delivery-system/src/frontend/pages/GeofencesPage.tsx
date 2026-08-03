// Geofences Page
import React from 'react';
import { Plus, Map, Search } from 'lucide-react';

export function GeofencesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Geofences</h1>
          <p className="text-gray-500">Configure monitoring zones</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">
          <Plus className="w-5 h-5" /> Create Geofence
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
        <p className="text-gray-500">Geofence management coming soon...</p>
      </div>
    </div>
  );
}
