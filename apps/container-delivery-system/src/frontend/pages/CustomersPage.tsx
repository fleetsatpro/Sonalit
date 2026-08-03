// Customers Page

import React from 'react';
import { Plus, Search, Users } from 'lucide-react';

export function CustomersPage() {
  const mockCustomers = [
    { id: '1', name: 'Acme Corporation', code: 'ACME', type: 'importer', contacts: 3, totalShipments: 45 },
    { id: '2', name: 'Global Trade Ltd', code: 'GTL', type: 'exporter', contacts: 2, totalShipments: 32 },
    { id: '3', name: 'East Africa Logistics', code: 'EAL', type: 'both', contacts: 5, totalShipments: 78 },
    { id: '4', name: 'Nile Shipping', code: 'NS', type: 'importer', contacts: 2, totalShipments: 23 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage customer accounts</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">
          <Plus className="w-5 h-5" /> Add Customer
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-4">
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="pb-3">Name</th>
              <th className="pb-3">Code</th>
              <th className="pb-3">Type</th>
              <th className="pb-3">Contacts</th>
              <th className="pb-3">Shipments</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {mockCustomers.map((customer) => (
              <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                <td className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <Users className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium">{customer.name}</span>
                  </div>
                </td>
                <td className="py-4 text-gray-500">{customer.code}</td>
                <td className="py-4">
                  <span className="px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-slate-700 capitalize">
                    {customer.type}
                  </span>
                </td>
                <td className="py-4">{customer.contacts}</td>
                <td className="py-4">{customer.totalShipments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
