// Shipment Detail Page

import React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Ship,
  Container,
  Truck,
  User,
  Lock,
  MapPin,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  MapPin as MapPinIcon,
} from 'lucide-react';
import { format } from 'date-fns';

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();

  // Mock data - replace with API call
  const shipment = {
    id,
    reference: 'SHP-2024-001',
    status: 'in_transit',
    priority: 'high',
    customer: { name: 'Acme Corp', code: 'ACME', email: 'contact@acme.com' },
    origin: { city: 'Mombasa', country: 'Kenya', address: 'Port of Mombasa' },
    destination: { city: 'Nairobi', country: 'Kenya', address: 'Industrial Area' },
    container: { containerNumber: 'MSCU1234567', type: '40HC', sealNumber: 'SL-12345' },
    vehicle: { registration: 'KXX 123X', make: 'Mercedes', model: 'Actros' },
    driver: { name: 'John Kamau', phone: '+254 712 345 678' },
    lock: { serialNumber: 'SL-2024-001', status: 'active' },
    expectedPickup: new Date(Date.now() - 86400000 * 2).toISOString(),
    expectedDelivery: new Date(Date.now() + 86400000 * 2).toISOString(),
    checkpoints: [
      { name: 'Mombasa Port', status: 'completed', timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
      { name: 'Nairobi Warehouse', status: 'pending', timestamp: new Date(Date.now() + 86400000 * 2).toISOString() },
    ],
    timeline: [
      { status: 'created', timestamp: new Date(Date.now() - 86400000 * 5).toISOString(), notes: 'Shipment created' },
      { status: 'assigned', timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), notes: 'Assigned to transporter' },
      { status: 'container_assigned', timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), notes: 'Container MSCU1234567 assigned' },
      { status: 'in_transit', timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), notes: 'Shipment in transit' },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/shipments"
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{shipment.reference}</h1>
            <p className="text-gray-500">Shipment Details</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            shipment.status === 'in_transit' ? 'bg-blue-100 text-blue-700' :
            shipment.status === 'delivered' ? 'bg-green-100 text-green-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {shipment.status.replace('_', ' ').toUpperCase()}
          </span>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Update Status
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Route Card */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Route</h3>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <MapPinIcon className="w-6 h-6 text-green-600 mx-auto" />
                <p className="font-medium text-gray-900 dark:text-white mt-2">{shipment.origin.city}</p>
                <p className="text-sm text-gray-500">{shipment.origin.country}</p>
              </div>
              <div className="flex-1 mx-8">
                <div className="h-1 bg-blue-600 rounded-full relative">
                  <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-3 h-3 bg-blue-600 rounded-full"></div>
                  <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-3 h-3 bg-blue-600 rounded-full animate-pulse"></div>
                </div>
              </div>
              <div className="text-center">
                <MapPinIcon className="w-6 h-6 text-red-600 mx-auto" />
                <p className="font-medium text-gray-900 dark:text-white mt-2">{shipment.destination.city}</p>
                <p className="text-sm text-gray-500">{shipment.destination.country}</p>
              </div>
            </div>
          </div>

          {/* Assigned Entities */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Container className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Container</p>
                  <p className="font-medium text-gray-900 dark:text-white">{shipment.container.containerNumber}</p>
                  <p className="text-xs text-gray-500">{shipment.container.type}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <Truck className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Vehicle</p>
                  <p className="font-medium text-gray-900 dark:text-white">{shipment.vehicle.registration}</p>
                  <p className="text-xs text-gray-500">{shipment.vehicle.make} {shipment.vehicle.model}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <User className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Driver</p>
                  <p className="font-medium text-gray-900 dark:text-white">{shipment.driver.name}</p>
                  <p className="text-xs text-gray-500">{shipment.driver.phone}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <Lock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Electronic Lock</p>
                  <p className="font-medium text-gray-900 dark:text-white">{shipment.lock.serialNumber}</p>
                  <p className="text-xs text-gray-500">{shipment.lock.status}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Timeline</h3>
            <div className="space-y-4">
              {shipment.timeline.map((event, index) => (
                <div key={index} className="flex items-start gap-4">
                  <div className="relative">
                    <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                    {index < shipment.timeline.length - 1 && (
                      <div className="absolute top-3 left-0 w-0.5 h-8 bg-gray-200 dark:bg-gray-700"></div>
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900 dark:text-white capitalize">{event.status.replace('_', ' ')}</p>
                      <p className="text-sm text-gray-500">{format(new Date(event.timestamp), 'MMM d, HH:mm')}</p>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{event.notes}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Info */}
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Customer</h3>
            <p className="text-xl font-medium text-gray-900 dark:text-white">{shipment.customer.name}</p>
            <p className="text-sm text-gray-500">{shipment.customer.code}</p>
            <p className="text-sm text-blue-600 mt-2">{shipment.customer.email}</p>
          </div>

          {/* Dates */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Key Dates</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Expected Pickup</span>
                <span className="text-sm font-medium">{format(new Date(shipment.expectedPickup), 'MMM d, yyyy')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Expected Delivery</span>
                <span className="text-sm font-medium">{format(new Date(shipment.expectedDelivery), 'MMM d, yyyy')}</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
                <MapPinIcon className="w-5 h-5 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-200">View on Map</span>
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
                <FileText className="w-5 h-5 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-200">Generate Report</span>
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
                <AlertCircle className="w-5 h-5 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-200">Report Issue</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
