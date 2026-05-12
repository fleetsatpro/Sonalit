import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Truck, Plus, Search, Filter, X, Thermometer, Fuel,
  Wrench, Activity, ChevronRight, AlertTriangle, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useVehicleStore } from '../store';
import { vehiclesAPI, sensorAPI } from '../services/api';
import { Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../components/UI';
import { formatDate, initials } from '../utils/helpers';

const vehicleSchema = z.object({
  registration: z.string().min(3, 'Min 3 chars').max(20),
  type: z.string().min(1, 'Required'),
  region: z.string().min(1, 'Required'),
  make: z.string().optional(),
  model: z.string().optional(),
  fuel_capacity: z.coerce.number().min(1).max(1000).default(80),
});

const TYPES = ['Armoured Vehicle','SUV','Truck','Motorcycle','Ambulance','Command Vehicle'];
const REGIONS = ['Kenya','Tanzania','DRC','Mali','Nigeria','Ethiopia'];

function MaintenanceBadge({ score }) {
  if (score == null) return null;
  const color = score >= 80 ? 'bg-danger/20 text-danger border-danger/30'
    : score >= 50 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-success/20 text-success border-success/30';
  const label = score >= 80 ? 'OVERDUE' : score >= 50 ? 'DUE SOON' : 'GOOD';
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${color}`}>
      <Wrench size={9} />
      {label} {score}/100
    </span>
  );
}

function FuelBar({ level }) {
  if (level == null) return null;
  const pct = Math.max(0, Math.min(100, level));
  const color = pct < 20 ? 'bg-danger' : pct < 40 ? 'bg-amber-400' : 'bg-success';
  return (
    <div className="flex items-center gap-2">
      <Fuel size={11} className={pct < 20 ? 'text-danger' : pct < 40 ? 'text-amber-400' : 'text-slate-500'} />
      <div className="flex-1 h-1.5 bg-navy-700 rounded-full">
        <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-500 w-8">{pct.toFixed(0)}%</span>
    </div>
  );
}

function VehicleCard({ vehicle, onSelect, selected }) {
  const statusColors = {
    active:      'bg-success/20 text-success border-success/30',
    idle:        'bg-slate-500/20 text-slate-400 border-slate-500/30',
    maintenance: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    offline:     'bg-danger/20 text-danger border-danger/30',
  };

  return (
    <div
      onClick={() => onSelect(vehicle)}
      className={`bg-navy-900 border rounded-xl p-4 cursor-pointer transition-all hover:border-white/10
        ${selected ? 'border-gold/30 bg-gold/5' : 'border-white/[0.04]'}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-navy-700 border border-white/5 flex items-center justify-center">
            <Truck size={15} className="text-slate-400" />
          </div>
          <div>
            <p className="font-mono font-bold text-slate-200 text-sm">{vehicle.registration}</p>
            <p className="text-[10px] text-slate-500">{vehicle.type} · {vehicle.region}</p>
          </div>
        </div>
        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${statusColors[vehicle.status] || statusColors.idle}`}>
          {vehicle.status?.toUpperCase()}
        </span>
      </div>

      <div className="space-y-2">
        <FuelBar level={vehicle.fuel_level} />
        <MaintenanceBadge score={vehicle.maintenance_score} />
      </div>

      {vehicle.speed != null && vehicle.speed > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-slate-500">
          <Activity size={10} />
          {vehicle.speed} km/h
        </div>
      )}

      {vehicle.driver_name && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
          <div className="w-4 h-4 rounded-full bg-navy-700 flex items-center justify-center text-[8px] font-bold text-slate-400">
            {initials(vehicle.driver_name)}
          </div>
          {vehicle.driver_name}
        </div>
      )}
    </div>
  );
}

export default function FleetPage() {
  const { vehicles, total, loading, pagination, fetchVehicles, createVehicle } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [sensorData, setSensorData] = useState(null);
  const [sensorLoading, setSensorLoading] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(vehicleSchema) });

  useEffect(() => {
    const params = {};
    if (search)       params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (regionFilter) params.region = regionFilter;
    const timer = setTimeout(() => fetchVehicles(params), 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter, regionFilter]);

  useEffect(() => {
    if (!selected) return;
    setSensorLoading(true);
    sensorAPI.latest(selected.id)
      .then(r => setSensorData(r.data.data))
      .catch(() => setSensorData(null))
      .finally(() => setSensorLoading(false));
  }, [selected?.id]);

  const onSubmit = async (data) => {
    try {
      await createVehicle(data);
      toast.success('Vehicle added');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to add vehicle');
    }
  };

  const changeStatus = async (status) => {
    try {
      await vehiclesAPI.updateStatus(selected.id, status);
      toast.success(`Status → ${status}`);
      setSelected(prev => ({ ...prev, status }));
      fetchVehicles();
    } catch { toast.error('Update failed'); }
  };

  const stats = [
    ['TOTAL',       total || vehicles.length,                                         'text-slate-200'],
    ['ACTIVE',      vehicles.filter(v => v.status === 'active').length,               'text-success'],
    ['IDLE',        vehicles.filter(v => v.status === 'idle').length,                 'text-slate-400'],
    ['MAINTENANCE', vehicles.filter(v => v.status === 'maintenance').length,          'text-amber-400'],
    ['LOW FUEL',    vehicles.filter(v => (v.fuel_level || 100) < 25).length,          'text-danger'],
    ['MAINT DUE',   vehicles.filter(v => (v.maintenance_score || 0) >= 80).length,    'text-amber-400'],
  ];

  return (
    <div className="space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">FLEET MANAGEMENT</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{total || vehicles.length} vehicles registered</p>
        </div>
        <Button onClick={() => setShowForm(f => !f)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? 'Cancel' : 'Add Vehicle'}
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(([label, val, color]) => (
          <div key={label} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
            <p className={`font-display text-2xl font-bold ${color}`}>{val}</p>
            <p className="text-[9px] font-mono text-slate-500 tracking-wider mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Add vehicle form */}
      {showForm && (
        <Card>
          <div className="p-5">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-4">Register New Vehicle</p>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="Registration *" placeholder="KEN-001" {...register('registration')} error={errors.registration?.message} />
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Type *</label>
                <select {...register('type')} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                  <option value="">Select type</option>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.type && <p className="text-[10px] text-danger">{errors.type.message}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Region *</label>
                <select {...register('region')} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                  <option value="">Select region</option>
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {errors.region && <p className="text-[10px] text-danger">{errors.region.message}</p>}
              </div>
              <Input label="Make" placeholder="Toyota" {...register('make')} />
              <Input label="Model" placeholder="Land Cruiser" {...register('model')} />
              <Input label="Fuel Capacity (L)" type="number" placeholder="80" {...register('fuel_capacity')} error={errors.fuel_capacity?.message} />
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <Button type="submit" loading={isSubmitting}><Plus size={14} />Register Vehicle</Button>
              </div>
            </form>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search registration or region..."
            className="w-full bg-navy-900 border border-white/5 focus:border-gold/40 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-navy-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All statuses</option>
          {['active','idle','maintenance','offline'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
          className="bg-navy-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All regions</option>
          {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="flex gap-5">
        {/* Vehicle grid */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : vehicles.length === 0 ? (
            <EmptyState icon={Truck} title="No vehicles found" subtitle="Add a vehicle or adjust filters" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {vehicles.map(v => (
                <VehicleCard key={v.id} vehicle={v} onSelect={setSelected} selected={selected?.id === v.id} />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 flex-shrink-0 space-y-4">
            <Card>
              <div className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-mono font-bold text-gold text-lg">{selected.registration}</p>
                    <p className="text-xs text-slate-500">{selected.type} · {selected.make} {selected.model}</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white">
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Region</span>
                    <span className="text-slate-200">{selected.region}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Driver</span>
                    <span className="text-slate-200">{selected.driver_name || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last ping</span>
                    <span className="text-slate-200">{selected.last_ping ? formatDate(selected.last_ping, { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  </div>
                  {selected.engine_hours != null && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Engine hrs</span>
                      <span className="text-slate-200">{parseFloat(selected.engine_hours || 0).toFixed(0)} h</span>
                    </div>
                  )}
                  {selected.odometer != null && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Odometer</span>
                      <span className="text-slate-200">{parseFloat(selected.odometer || 0).toLocaleString()} km</span>
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <p className="text-[10px] font-mono text-slate-600 mb-1.5">FUEL LEVEL</p>
                  <FuelBar level={selected.fuel_level} />
                </div>

                <div className="mt-3">
                  <MaintenanceBadge score={selected.maintenance_score} />
                </div>

                {/* Status actions */}
                <div className="mt-4 space-y-1.5">
                  <p className="text-[10px] font-mono text-slate-600 mb-2">CHANGE STATUS</p>
                  {['active','idle','maintenance','offline'].map(s => (
                    <button key={s} onClick={() => changeStatus(s)} disabled={selected.status === s}
                      className={`w-full py-1.5 text-xs font-mono rounded-lg border transition-colors
                        ${selected.status === s ? 'bg-gold/10 text-gold border-gold/30' : 'border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/10'}`}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Sensor data */}
            <Card>
              <div className="p-4">
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Thermometer size={12} />CARGO SENSORS
                </p>
                {sensorLoading ? (
                  <div className="flex justify-center py-4"><Spinner /></div>
                ) : sensorData ? (
                  <div className="space-y-2 text-sm">
                    {sensorData.temperature != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Temperature</span>
                        <span className={`font-mono ${sensorData.temperature > 30 ? 'text-danger' : 'text-slate-200'}`}>
                          {sensorData.temperature}°C
                        </span>
                      </div>
                    )}
                    {sensorData.humidity != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Humidity</span>
                        <span className={`font-mono ${sensorData.humidity > 85 ? 'text-danger' : 'text-slate-200'}`}>
                          {sensorData.humidity}%
                        </span>
                      </div>
                    )}
                    {sensorData.shock_g != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Last shock</span>
                        <span className={`font-mono ${sensorData.shock_g > 3 ? 'text-danger' : 'text-slate-200'}`}>
                          {sensorData.shock_g}G
                        </span>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-600">{formatDate(sensorData.timestamp)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 text-center py-2">No sensor data</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
