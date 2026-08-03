// Shipments Page

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  MoreVertical,
  Ship,
  MapPin,
  Clock,
  CheckCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { shipmentsApi } from '../services/api';
import { useAuthStore } from '../store/auth';

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-blue-100 text-blue-700',
  at_checkpoint: 'bg-amber-100 text-amber-700',
  at_border: 'bg-purple-100 text-purple-700',
  arrived: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  assigned: 'Assigned',
  container_assigned: 'Container Assigned',
  vehicle_assigned: 'Vehicle Assigned',
  driver_assigned: 'Driver Assigned',
  lock_assigned: 'Lock Assigned',
  tracking_activated: 'Tracking Active',
  in_transit: 'In Transit',
  at_checkpoint: 'At Checkpoint',
  at_border: 'At Border',
  arrived: 'Arrived',
  unlock_authorized: 'Unlock Authorized',
  delivered: 'Delivered',
  container_returned: 'Container Returned',
  closed: 'Closed',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export function ShipmentsPage() {
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', page, searchQuery, statusFilter],
    queryFn: async () => {
      const response = await shipmentsApi.list({
        page,
        pageSize: 20,
        search: searchQuery,
        status: statusFilter,
      });
      return response.data;
    },
    enabled: !!accessToken,
  });

  const shipments = data?.data || [];
  const pagination = data?.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Mock data for demonstration
  const mockShipments = [
    {
      id: '1',
      reference: 'SHP-2024-001',
      status: 'in_transit',
      customer: { name: 'Acme Corp', code: 'ACME' },
      origin: { city: 'Mombasa', country: 'Kenya' },
      destination: { city: 'Nairobi', country: 'Kenya' },
      expectedDelivery: new Date(Date.now() + 86400000 * 2).toISOString(),
      priority: 'high',
      container: { containerNumber: 'MSCU1234567' },
      vehicle: { registration: 'KXX 123X' },
    },
    {
      id: '2',
      reference: 'SHP-2024-002',
      status: 'at_checkpoint',
      customer: { name: 'Global Trade Ltd', code: 'GTL' },
      origin: { city: 'Dar es Salaam', country: 'Tanzania' },
      destination: { city: 'Lusaka', country: 'Zambia' },
      expectedDelivery: new Date(Date.now() + 86400000 * 5).toISOString(),
      priority: 'medium',
      container: { containerNumber: 'TGHU9876543' },
      vehicle: { registration: 'TZ 456Y' },
    },
    {
      id: '3',
      reference: 'SHP-2024-003',
      status: 'delivered',
      customer: { name: 'East Africa Logistics', code: 'EAL' },
      origin: { city: 'Kampala', country: 'Uganda' },
      destination: { city: 'Jinja', country: 'Uganda' },
      expectedDelivery: new Date(Date.now() - 86400000).toISOString(),
      priority: 'low',
      container: { containerNumber: 'EGHU1112223' },
      vehicle: { registration: 'UG 789Z' },
    },
    {
      id: '4',
      reference: 'SHP-2024-004',
      status: 'created',
      customer: { name: 'Nile Shipping', code: 'NS' },
      origin: { city: 'Port Sudan', country: 'Sudan' },
      destination: { city: 'Khartoum', country: 'Sudan' },
      expectedDelivery: new Date(Date.now() + 86400000 * 10).toISOString(),
      priority: 'critical',
      container: { containerNumber: 'CMAU4445556' },
      vehicle: null,
    },
  ];

  const displayShipments = shipments.length > 0 ? shipments : mockShipments;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shipments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage container delivery shipments
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Shipment
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search shipments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Route
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Container
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Expected Delivery
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {displayShipments.map((shipment: any) => (
                <tr key={shipment.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      to={`/shipments/${shipment.id}`}
                      className="font-medium text-blue-600 hover:text-blue-700"
                    >
                      {shipment.reference}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">{shipment.customer?.name}</div>
                    <div className="text-xs text-gray-500">{shipment.customer?.code}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900 dark:text-white">{shipment.origin?.city}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-gray-900 dark:text-white">{shipment.destination?.city}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {shipment.container?.containerNumber || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[shipment.status] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABELS[shipment.status] || shipment.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {shipment.expectedDelivery ? new Date(shipment.expectedDelivery).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/shipments/${shipment.id}`}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        title="View Details"
                      >
                        <Eye className="w-5 h-5" />
                      </Link>
                      <button
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        title="Edit"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} results
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="p-2 border border-gray-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 py-2 text-sm">
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 border border-gray-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
