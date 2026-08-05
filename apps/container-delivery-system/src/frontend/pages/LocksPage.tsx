// Electronic Locks Page

import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Lock,
  LockOpen,
  RefreshCw,
  Battery,
  Signal,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Eye,
  Edit,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { locksApi } from '../services/api';
import { useAuthStore } from '../store/auth';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_use: 'bg-purple-100 text-purple-700',
  offline: 'bg-red-100 text-red-700',
  low_battery: 'bg-amber-100 text-amber-700',
  tampered: 'bg-red-100 text-red-700',
  faulty: 'bg-red-100 text-red-700',
  maintenance: 'bg-gray-100 text-gray-700',
};

export function LocksPage() {
  const { accessToken } = useAuthStore();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['locks', page, searchQuery, statusFilter],
    queryFn: async () => {
      const response = await locksApi.list({
        page,
        pageSize: 20,
        search: searchQuery,
        status: statusFilter,
      });
      return response.data;
    },
    enabled: !!accessToken,
  });

  const syncAllMutation = useMutation({
    mutationFn: () => locksApi.syncAll(),
    onSuccess: () => {
      toast.success('All locks synced successfully');
      refetch();
    },
    onError: () => {
      toast.error('Failed to sync locks');
    },
  });

  const locks = data?.data || [];
  const pagination = data?.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Mock data
  const mockLocks = [
    {
      id: '1',
      serialNumber: 'SL-2024-001',
      securisatId: 'SEC-LOCK-001',
      status: 'in_use',
      batteryLevel: 85,
      signalStrength: 92,
      currentLocation: { lat: -1.2921, lng: 36.8219 },
      lastHeartbeat: new Date().toISOString(),
      assignedShipment: { reference: 'SHP-2024-001' },
    },
    {
      id: '2',
      serialNumber: 'SL-2024-002',
      securisatId: 'SEC-LOCK-002',
      status: 'low_battery',
      batteryLevel: 15,
      signalStrength: 78,
      currentLocation: { lat: -4.0435, lng: 39.6682 },
      lastHeartbeat: new Date(Date.now() - 300000).toISOString(),
      assignedShipment: { reference: 'SHP-2024-002' },
    },
    {
      id: '3',
      serialNumber: 'SL-2024-003',
      securisatId: 'SEC-LOCK-003',
      status: 'offline',
      batteryLevel: 45,
      signalStrength: 0,
      currentLocation: null,
      lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
      assignedShipment: null,
    },
    {
      id: '4',
      serialNumber: 'SL-2024-004',
      securisatId: 'SEC-LOCK-004',
      status: 'available',
      batteryLevel: 100,
      signalStrength: 95,
      currentLocation: { lat: -1.9431, lng: 30.0619 },
      lastHeartbeat: new Date().toISOString(),
      assignedShipment: null,
    },
  ];

  const displayLocks = locks.length > 0 ? locks : mockLocks;

  const handleLockAction = async (lockId: string, action: 'lock' | 'unlock') => {
    try {
      if (action === 'lock') {
        await locksApi.lock(lockId);
        toast.success('Lock activated');
      } else {
        await locksApi.unlock(lockId);
        toast.success('Lock released');
      }
      refetch();
    } catch (error) {
      toast.error(`Failed to ${action} device`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Electronic Locks</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage SecuriSat electronic lock fleet
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${syncAllMutation.isPending ? 'animate-spin' : ''}`} />
            Sync All
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus className="w-5 h-5" />
            Add Lock
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Locks"
          value="88"
          icon={Lock}
          color="blue"
        />
        <StatCard
          label="In Use"
          value="32"
          icon={Lock}
          color="purple"
        />
        <StatCard
          label="Offline"
          value="5"
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          label="Low Battery"
          value="7"
          icon={Battery}
          color="amber"
        />
        <StatCard
          label="Available"
          value="44"
          icon={CheckCircle}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by serial number or ID..."
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
            <option value="in_use">In Use</option>
            <option value="offline">Offline</option>
            <option value="low_battery">Low Battery</option>
          </select>
        </div>
      </div>

      {/* Locks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayLocks.map((lock: any) => (
          <div
            key={lock.id}
            className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  lock.status === 'offline' || lock.status === 'low_battery' || lock.status === 'tampered'
                    ? 'bg-red-100 dark:bg-red-900/30'
                    : 'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  <Lock className={`w-5 h-5 ${
                    lock.status === 'offline' || lock.status === 'low_battery' || lock.status === 'tampered'
                      ? 'text-red-600'
                      : 'text-blue-600'
                  }`} />
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{lock.serialNumber}</p>
                  <p className="text-xs text-gray-500">{lock.securisatId}</p>
                </div>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[lock.status]}`}>
                {lock.status.replace('_', ' ')}
              </span>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Battery className={`w-4 h-4 ${
                    lock.batteryLevel < 20 ? 'text-red-600' : lock.batteryLevel < 50 ? 'text-amber-600' : 'text-green-600'
                  }`} />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Battery: {lock.batteryLevel}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Signal className={`w-4 h-4 ${
                    lock.signalStrength < 30 ? 'text-red-600' : lock.signalStrength < 60 ? 'text-amber-600' : 'text-green-600'
                  }`} />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Signal: {lock.signalStrength}%
                  </span>
                </div>
              </div>

              {/* Location */}
              {lock.currentLocation ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin className="w-4 h-4" />
                  <span>
                    {lock.currentLocation.lat.toFixed(4)}, {lock.currentLocation.lng.toFixed(4)}
                  </span>
                </div>
              ) : (
                <div className="text-sm text-gray-400">No location data</div>
              )}

              {/* Assigned Shipment */}
              {lock.assignedShipment && (
                <div className="text-sm">
                  <span className="text-gray-500">Assigned to: </span>
                  <span className="text-blue-600">{lock.assignedShipment.reference}</span>
                </div>
              )}

              {/* Last Heartbeat */}
              <div className="text-xs text-gray-400">
                Last heartbeat: {new Date(lock.lastHeartbeat).toLocaleTimeString()}
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-gray-200 dark:border-slate-700 flex items-center gap-2">
              <button
                onClick={() => handleLockAction(lock.id, 'lock')}
                disabled={lock.status !== 'assigned'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Lock className="w-4 h-4" />
                Lock
              </button>
              <button
                onClick={() => handleLockAction(lock.id, 'unlock')}
                disabled={lock.status !== 'in_use'}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LockOpen className="w-4 h-4" />
                Unlock
              </button>
              <button className="p-2 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700">
                <Eye className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
      <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg ${colorClasses[color]}`}>
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{value}</p>
    </div>
  );
}
