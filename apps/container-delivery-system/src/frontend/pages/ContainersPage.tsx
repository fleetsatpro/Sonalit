// Containers Page

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Container,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Edit,
  Eye,
} from 'lucide-react';
import { containersApi } from '../services/api';
import { useAuthStore } from '../store/auth';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  in_use: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-blue-100 text-blue-700',
  at_port: 'bg-purple-100 text-purple-700',
  at_warehouse: 'bg-gray-100 text-gray-700',
  maintenance: 'bg-amber-100 text-amber-700',
  damaged: 'bg-red-100 text-red-700',
  reserved: 'bg-yellow-100 text-yellow-700',
};

export function ContainersPage() {
  const { accessToken } = useAuthStore();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['containers', page, searchQuery, statusFilter],
    queryFn: async () => {
      const response = await containersApi.list({
        page,
        pageSize: 20,
        search: searchQuery,
        status: statusFilter,
      });
      return response.data;
    },
    enabled: !!accessToken,
  });

  const containers = data?.data || [];
  const pagination = data?.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Mock data
  const mockContainers = [
    {
      id: '1',
      containerNumber: 'MSCU1234567',
      isoCode: '40HC',
      type: '40ft_hc',
      status: 'in_transit',
      currentLocation: { lat: -1.2921, lng: 36.8219 },
      currentShipment: { reference: 'SHP-2024-001' },
    },
    {
      id: '2',
      containerNumber: 'TGHU9876543',
      isoCode: '20GP',
      type: '20ft',
      status: 'available',
      currentLocation: null,
      currentShipment: null,
    },
    {
      id: '3',
      containerNumber: 'CMAU4445556',
      isoCode: '40GP',
      type: '40ft',
      status: 'maintenance',
      currentLocation: { lat: -4.0435, lng: 39.6682 },
      currentShipment: null,
    },
    {
      id: '4',
      containerNumber: 'EGHU1112223',
      isoCode: '40HC',
      type: '40ft_hc',
      status: 'at_port',
      currentLocation: { lat: -1.9431, lng: 30.0619 },
      currentShipment: { reference: 'SHP-2024-005' },
    },
  ];

  const displayContainers = containers.length > 0 ? containers : mockContainers;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Containers</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage ISO container fleet
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-5 h-5" />
          Add Container
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total" value="156" color="blue" />
        <StatCard label="Available" value="82" color="green" />
        <StatCard label="In Transit" value="45" color="blue" />
        <StatCard label="Maintenance" value="8" color="amber" />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by container number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          >
            <option value="">All Statuses</option>
            <option value="available">Available</option>
            <option value="in_transit">In Transit</option>
            <option value="maintenance">Maintenance</option>
            <option value="damaged">Damaged</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Container #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ISO Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Shipment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {displayContainers.map((container: any) => (
                <tr key={container.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <Container className="w-5 h-5 text-gray-400" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {container.containerNumber}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 rounded">
                      {container.isoCode}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[container.status]}`}>
                      {container.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {container.currentShipment ? (
                      <Link
                        to={`/shipments/${container.currentShipment.id}`}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        {container.currentShipment.reference}
                      </Link>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {container.currentLocation ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <MapPin className="w-4 h-4" />
                        {container.currentLocation.lat.toFixed(4)}, {container.currentLocation.lng.toFixed(4)}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-1.5 text-gray-400 hover:text-gray-600">
                        <Eye className="w-5 h-5" />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600">
                        <Edit className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
      <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg ${colorClasses[color]}`}>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{value}</p>
    </div>
  );
}
