// Vehicles Page
import React from 'react';
import { Plus, Search, Car } from 'lucide-react';

export function VehiclesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vehicles</h1>
          <p className="text-gray-500">Manage vehicle fleet</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">
          <Plus className="w-5 h-5" /> Add Vehicle
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
        <p className="text-gray-500">Vehicle management interface coming soon...</p>
      </div>
    </div>
  );
}
