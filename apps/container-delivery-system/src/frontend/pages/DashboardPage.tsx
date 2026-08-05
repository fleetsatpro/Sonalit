// Executive Dashboard Page

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Ship,
  Container,
  Lock,
  Truck,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  Activity,
  MapPin,
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { shipmentsApi, locksApi, vehiclesApi, driversApi } from '../services/api';
import { useAuthStore } from '../store/auth';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export function DashboardPage() {
  const { accessToken } = useAuthStore();

  const { data: shipmentStats, isLoading: loadingShipments } = useQuery({
    queryKey: ['shipment-stats'],
    queryFn: async () => {
      const response = await shipmentsApi.getStats();
      return response.data.data;
    },
    enabled: !!accessToken,
  });

  const { data: lockStats, isLoading: loadingLocks } = useQuery({
    queryKey: ['lock-stats'],
    queryFn: async () => {
      const response = await locksApi.getStats();
      return response.data.data;
    },
    enabled: !!accessToken,
  });

  const { data: vehicleStats, isLoading: loadingVehicles } = useQuery({
    queryKey: ['vehicle-stats'],
    queryFn: async () => {
      const response = await vehiclesApi.getStats();
      return response.data.data;
    },
    enabled: !!accessToken,
  });

  const { data: driverStats, isLoading: loadingDrivers } = useQuery({
    queryKey: ['driver-stats'],
    fn: async () => {
      const response = await driversApi.getStats();
      return response.data.data;
    },
    enabled: !!accessToken,
  });

  const isLoading = loadingShipments || loadingLocks || loadingVehicles || loadingDrivers;

  // Mock data for charts (replace with actual API data)
  const shipmentTrendData = [
    { date: 'Mon', delivered: 12, inTransit: 8 },
    { date: 'Tue', delivered: 18, inTransit: 12 },
    { date: 'Wed', delivered: 15, inTransit: 10 },
    { date: 'Thu', delivered: 22, inTransit: 14 },
    { date: 'Fri', delivered: 25, inTransit: 16 },
    { date: 'Sat', delivered: 10, inTransit: 6 },
    { date: 'Sun', delivered: 8, inTransit: 4 },
  ];

  const lockStatusData = lockStats ? [
    { name: 'Available', value: parseInt(lockStats.available) || 0 },
    { name: 'In Use', value: parseInt(lockStats.in_use) || 0 },
    { name: 'Offline', value: parseInt(lockStats.offline) || 0 },
    { name: 'Low Battery', value: parseInt(lockStats.low_battery) || 0 },
  ] : [
    { name: 'Available', value: 45 },
    { name: 'In Use', value: 30 },
    { name: 'Offline', value: 5 },
    { name: 'Low Battery', value: 8 },
  ];

  const recentAlerts = [
    { id: 1, type: 'Lock', message: 'Low battery detected on LOCK-001', severity: 'warning', time: '5 min ago' },
    { id: 2, type: 'Shipment', message: 'Shipment SHP-1234 delayed', severity: 'error', time: '15 min ago' },
    { id: 3, type: 'Vehicle', message: 'Vehicle VR-5678 offline', severity: 'warning', time: '30 min ago' },
    { id: 4, type: 'Route', message: 'Route deviation detected', severity: 'info', time: '1 hour ago' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Executive Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Real-time overview of container delivery operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-sm">
            <Activity className="w-4 h-4" />
            Live
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Active Shipments"
          value={shipmentStats?.in_transit || 47}
          change="+12%"
          trend="up"
          icon={Ship}
          color="blue"
        />
        <KPICard
          title="Delivered Today"
          value={shipmentStats?.delivered_today || 23}
          change="+8%"
          trend="up"
          icon={CheckCircle}
          color="green"
        />
        <KPICard
          title="Delayed"
          value={shipmentStats?.delayed || 5}
          change="-3%"
          trend="down"
          icon={Clock}
          color="amber"
        />
        <KPICard
          title="Active Locks"
          value={lockStats?.in_use || 32}
          change="+5"
          trend="up"
          icon={Lock}
          color="purple"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SecondaryKPICard
          title="Total Containers"
          value={156}
          icon={Container}
        />
        <SecondaryKPICard
          title="Active Vehicles"
          value={vehicleStats?.on_trip || 38}
          icon={Truck}
        />
        <SecondaryKPICard
          title="Drivers On Trip"
          value={driverStats?.on_trip || 42}
          icon={Activity}
        />
        <SecondaryKPICard
          title="Offline Locks"
          value={lockStats?.offline || 3}
          icon={Lock}
          alert={parseInt(lockStats?.offline) > 0}
        />
        <SecondaryKPICard
          title="Low Battery"
          value={lockStats?.low_battery || 7}
          icon={AlertTriangle}
          alert={parseInt(lockStats?.low_battery) > 5}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shipment Trend Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Shipment Activity (Last 7 Days)
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shipmentTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
                <Bar dataKey="delivered" fill="#10B981" name="Delivered" radius={[4, 4, 0, 0]} />
                <Bar dataKey="inTransit" fill="#3B82F6" name="In Transit" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lock Status Pie Chart */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Lock Status Distribution
          </h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={lockStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {lockStatusData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {lockStatusData.map((item, index) => (
              <div key={item.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">{item.name}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Alerts */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Alerts</h3>
            <a href="/alerts" className="text-sm text-blue-600 hover:text-blue-700">View all</a>
          </div>
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center gap-4 p-3 rounded-lg ${
                  alert.severity === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                    : alert.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                    : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                }`}
              >
                <div className={`p-2 rounded-full ${
                  alert.severity === 'error' ? 'bg-red-100 dark:bg-red-900/50' :
                  alert.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-900/50' :
                  'bg-blue-100 dark:bg-blue-900/50'
                }`}>
                  {alert.severity === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-600" />
                  ) : alert.severity === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  ) : (
                    <Activity className="w-4 h-4 text-blue-600" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{alert.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{alert.time}</p>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  alert.severity === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400' :
                  alert.severity === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400' :
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400'
                }`}>
                  {alert.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <QuickAction href="/shipments" icon={Ship} label="Create Shipment" />
            <QuickAction href="/locks" icon={Lock} label="Sync All Locks" />
            <QuickAction href="/vehicles" icon={Truck} label="View Fleet" />
            <QuickAction href="/reports" icon={MapPin} label="Generate Report" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface KPICardProps {
  title: string;
  value: number;
  change: string;
  trend: 'up' | 'down';
  icon: React.ElementType;
  color: string;
}

function KPICard({ title, value, change, trend, icon: Icon, color }: KPICardProps) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
      <div className="flex items-center justify-between">
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className={`flex items-center gap-1 text-sm ${
          trend === 'up' ? 'text-green-600' : 'text-red-600'
        }`}>
          {trend === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {change}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{title}</p>
      </div>
    </div>
  );
}

interface SecondaryKPICardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  alert?: boolean;
}

function SecondaryKPICard({ title, value, icon: Icon, alert }: SecondaryKPICardProps) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border p-4 ${
      alert
        ? 'border-amber-300 dark:border-amber-700'
        : 'border-gray-200 dark:border-slate-700'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${alert ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-slate-700'}`}>
          <Icon className={`w-5 h-5 ${alert ? 'text-amber-600' : 'text-gray-600 dark:text-gray-400'}`} />
        </div>
        <div>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">{value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{title}</p>
        </div>
      </div>
    </div>
  );
}

interface QuickActionProps {
  href: string;
  icon: React.ElementType;
  label: string;
}

function QuickAction({ href, icon: Icon, label }: QuickActionProps) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
    >
      <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
    </a>
  );
}
