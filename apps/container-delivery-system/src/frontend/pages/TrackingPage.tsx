// GPS Tracking Page

import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { MapPin, Layers, Navigation, Play, Pause, Clock, Maximize2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Mock data
const liveVehicles = [
  { id: '1', registration: 'KXX 123X', lat: -1.2921, lng: 36.8219, speed: 65, heading: 45, status: 'moving' },
  { id: '2', registration: 'KYY 456Y', lat: -1.3500, lng: 36.8500, speed: 0, heading: 0, status: 'idle' },
  { id: '3', registration: 'KZZ 789Z', lat: -1.2800, lng: 36.8000, speed: 80, heading: 180, status: 'moving' },
];

export function TrackingPage() {
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<'streets' | 'satellite' | 'dark'>('streets');
  const [isPlaying, setIsPlaying] = useState(false);

  const center = [-1.2921, 36.8219];

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">GPS Tracking</h1>
          <p className="text-gray-500">Real-time fleet position monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {isPlaying ? 'Pause' : 'Live'}
          </button>
          <div className="flex items-center gap-1 border border-gray-300 dark:border-slate-600 rounded-lg p-1">
            {(['streets', 'satellite', 'dark'] as const).map((style) => (
              <button
                key={style}
                onClick={() => setMapStyle(style)}
                className={`px-3 py-1.5 text-sm rounded ${
                  mapStyle === style
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Map and Sidebar */}
      <div className="flex-1 flex gap-4">
        {/* Map */}
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          <MapContainer
            center={center as [number, number]}
            zoom={10}
            className="h-full w-full"
          >
            <TileLayer
              url={
                mapStyle === 'dark'
                  ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                  : mapStyle === 'satellite'
                  ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                  : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
              }
              attribution='&copy; OpenStreetMap contributors'
            />
            {liveVehicles.map((vehicle) => (
              <Marker
                key={vehicle.id}
                position={[vehicle.lat, vehicle.lng]}
                eventHandlers={{
                  click: () => setSelectedVehicle(vehicle.id),
                }}
              >
                <Popup>
                  <div className="p-2">
                    <p className="font-bold">{vehicle.registration}</p>
                    <p className="text-sm">Speed: {vehicle.speed} km/h</p>
                    <p className="text-sm">Status: {vehicle.status}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Live Vehicles</h3>
            <p className="text-sm text-gray-500">{liveVehicles.length} vehicles online</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {liveVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                onClick={() => setSelectedVehicle(vehicle.id)}
                className={`p-4 border-b border-gray-200 dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 ${
                  selectedVehicle === vehicle.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-white">{vehicle.registration}</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    vehicle.status === 'moving' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {vehicle.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                  <span>{vehicle.speed} km/h</span>
                  <span>Heading: {vehicle.heading}°</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
