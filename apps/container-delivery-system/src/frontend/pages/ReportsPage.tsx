// Reports Page
import React from 'react';
import { FileText } from 'lucide-react';

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-gray-500">Generate and download reports</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {['Delivery Report', 'Lock Utilization', 'Fleet Performance'].map((title, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-4">
              <FileText className="w-6 h-6 text-blue-600" />
              <h3 className="font-semibold">{title}</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">Generate PDF, Excel, or CSV report</p>
            <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Generate Report
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
