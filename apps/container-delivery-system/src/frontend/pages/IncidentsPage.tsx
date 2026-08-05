// Incidents Page
import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function IncidentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Incidents</h1>
          <p className="text-gray-500">Track and manage incidents</p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
        <p className="text-gray-500">Incident management coming soon...</p>
      </div>
    </div>
  );
}
