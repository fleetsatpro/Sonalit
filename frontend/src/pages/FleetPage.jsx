import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Truck, Plus, Search, X, Thermometer, Fuel, Wrench, Activity,
  MapPin, User, Clock, Battery, Gauge, Navigation, AlertTriangle,
  ChevronDown, Filter, RefreshCw, Eye
} from "lucide-react";
import toast from "react-hot-toast";
import { useVehicleStore } from "../store";
import { vehiclesAPI, sensorAPI } from "../services/api";
import { Spinner, EmptyState } from "../components/UI";
import { formatDate } from "../utils/helpers";

const schema = z.object({
  registration: z.string().min(2).max(20),
  type: z.string().min(1),
  region: z.string().min(1),
  make: z.string().optional(),
  model: z.string().optional(),
  fuel_capacity: z.coerce.number().min(10).max(2000).default(80),
});

const TYPES = ["Armoured Vehicle","SUV","Truck","Van","Motorcycle","APC","Ambulance","Command Vehicle","Fuel Tanker"];
const REGIONS = ["Kenya","Tanzania","DRC","Mali","Nigeria","Ethiopia","Uganda","Sudan"];

const statusConfig = {
  active:      { color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", dot: "bg-emerald-400 animate-pulse" },
  idle:        { color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/20",   dot: "bg-slate-500" },
  maintenance: { color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   dot: "bg-amber-400" },
  offline:     { color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     dot: "bg-red-400" },
};

function FuelIndicator({ level }) {
  if (level == null) return null;
  const pct = Math.max(0, Math.min(100, parseFloat(level)));
  const color = pct < 20 ? "bg-red-500" : pct < 40 ? "bg-amber-500" : pct < 70 ? "bg-blue-500" : "bg-emerald-500";
  const textColor = pct < 20 ? "text-red-400" : pct < 40 ? "text-amber-400" : pct < 70 ? "text-blue-400" : "text-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-slate-500 flex items-center gap-1"><Fuel size={9} />FUEL</span>
        <span className={"text-[9px] font-mono font-bold " + textColor}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
        <div className={"h-full rounded-full transition-all " + color} style={{width: pct + "%"}} />
      </div>
    </div>
  );
}

function MaintenanceScore({ score }) {
  if (score == null) return null;
  const s = parseInt(score);
  const color = s >= 80 ? "text-red-400" : s >= 50 ? "text-amber-400" : "text-emerald-400";
  const bg = s >= 80 ? "bg-red-400/10 border-red-400/20" : s >= 50 ? "bg-amber-400/10 border-amber-400/20" : "bg-emerald-400/10 border-emerald-400/20";
  const label = s >= 80 ? "OVERDUE" : s >= 50 ? "DUE SOON" : "GOOD";
  return (
    <div className={"inline-flex items-center gap-1.5 text-[9px] font-mono font-bold px-2 py-1 rounded-lg border " + bg + " " + color}>
      <Wrench size={9} />
      {label} · {s}/100
    </div>
  );
}

function VehicleCard({ vehicle, onSelect, selected }) {
  const sc = statusConfig[vehicle.status] || statusConfig.idle;
  const initials = (name) => name ? name.split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2) : "??";

  return (
    <div onClick={() => onSelect(vehicle)}
      className={"border rounded-xl overflow-hidden cursor-pointer transition-all hover:border-white/15 group " + sc.border +
        (selected ? " ring-2 ring-gold/50 border-gold/40" : "")}>
      {/* Card header */}
      <div className="px-4 py-3 bg-navy-900 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className={"w-8 h-8 rounded-lg flex items-center justify-center border " + sc.bg + " " + sc.border}>
              <Truck size={14} className={sc.color} />
            </div>
            <div className={"absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-navy-900 " + sc.dot} />
          </div>
          <div>
            <p className="font-mono font-bold text-slate-200 text-sm leading-none">{vehicle.registration}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{vehicle.type}</p>
          </div>
        </div>
        <div className="text-right">
          <span className={"text-[9px] font-mono font-bold px-2 py-0.5 rounded-full " + sc.bg + " " + sc.color}>
            {vehicle.status?.toUpperCase()}
          </span>
          <p className="text-[9px] text-slate-600 mt-1">{vehicle.region}</p>
        </div>
      </div>

      {/* Telemetry */}
      <div className="px-4 py-3 bg-navy-950/50 space-y-2.5">
        <FuelIndicator level={vehicle.fuel_level} />
        <MaintenanceScore score={vehicle.maintenance_score} />

        {/* Stats row */}
        <div className="flex items-center gap-3 pt-1 border-t border-white/[0.04]">
          {vehicle.speed != null && vehicle.speed > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
              <Gauge size={10} />{vehicle.speed} km/h
            </div>
          )}
          {vehicle.engine_hours > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
              <Clock size={10} />{parseFloat(vehicle.engine_hours).toFixed(0)}h
            </div>
          )}
          {vehicle.odometer > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
              <Navigation size={10} />{parseFloat(vehicle.odometer).toLocaleString()}km
            </div>
          )}
        </div>

        {/* Driver */}
        {vehicle.driver_name && (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-navy-700 border border-white/10 flex items-center justify-center text-[8px] font-bold text-slate-400">
              {initials(vehicle.driver_name)}
            </div>
            <span className="text-[10px] text-slate-500">{vehicle.driver_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VehicleDetailPanel({ vehicle, onClose, onStatusChange }) {
  const [sensor, setSensor] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    sensorAPI.latest(vehicle.id)
      .then(r => setSensor(r.data.data))
      .catch(() => setSensor(null))
      .finally(() => setLoading(false));
  }, [vehicle.id]);

  return (
    <div className="w-80 flex-shrink-0 bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <p className="font-mono font-bold text-gold text-base">{vehicle.registration}</p>
          <p className="text-xs text-slate-500">{vehicle.type} · {vehicle.make} {vehicle.model}</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-slate-600 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Status */}
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Region", vehicle.region],
            ["Driver", vehicle.driver_name || "—"],
            ["Engine hrs", parseFloat(vehicle.engine_hours || 0).toFixed(0) + " h"],
            ["Odometer", parseFloat(vehicle.odometer || 0).toLocaleString() + " km"],
            ["Last ping", vehicle.last_ping ? formatDate(vehicle.last_ping) : "—"],
            ["Last service", vehicle.last_service_date ? formatDate(vehicle.last_service_date) : "—"],
          ].map(([label, val]) => (
            <div key={label} className="bg-navy-800 rounded-lg p-2.5 border border-white/5">
              <p className="text-[9px] font-mono text-slate-600 mb-1">{label.toUpperCase()}</p>
              <p className="text-xs text-slate-300 truncate">{val}</p>
            </div>
          ))}
        </div>

        {/* Fuel */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <FuelIndicator level={vehicle.fuel_level} />
          {vehicle.fuel_capacity && (
            <p className="text-[9px] text-slate-600 mt-1.5 font-mono">
              Capacity: {vehicle.fuel_capacity}L · Used: {(vehicle.fuel_capacity * (1 - (vehicle.fuel_level||100)/100)).toFixed(0)}L
            </p>
          )}
        </div>

        {/* Maintenance */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 mb-2">MAINTENANCE</p>
          <MaintenanceScore score={vehicle.maintenance_score} />
        </div>

        {/* Sensors */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 mb-2 flex items-center gap-1.5">
            <Thermometer size={10} />CARGO SENSORS
          </p>
          {loading ? <div className="flex justify-center py-3"><Spinner /></div>
            : sensor ? (
              <div className="space-y-1.5">
                {[
                  ["Temp", sensor.temperature != null ? sensor.temperature + "°C" : null, sensor.temperature > 30],
                  ["Humidity", sensor.humidity != null ? sensor.humidity + "%" : null, sensor.humidity > 85],
                  ["Shock", sensor.shock_g != null ? sensor.shock_g + "G" : null, sensor.shock_g > 3],
                ].filter(([,v]) => v != null).map(([label, val, alert]) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500">{label}</span>
                    <span className={"text-[10px] font-mono font-bold " + (alert ? "text-red-400" : "text-slate-300")}>{val}</span>
                  </div>
                ))}
                <p className="text-[9px] text-slate-600 pt-1">{formatDate(sensor.timestamp)}</p>
              </div>
            ) : <p className="text-[10px] text-slate-600 text-center py-2">No sensor data</p>}
        </div>

        {/* Status change */}
        <div>
          <p className="text-[9px] font-mono text-slate-600 mb-2">CHANGE STATUS</p>
          <div className="grid grid-cols-2 gap-1.5">
            {["active","idle","maintenance","offline"].filter(s => s !== vehicle.status).map(s => {
              const sc = statusConfig[s];
              return (
                <button key={s} onClick={() => onStatusChange(vehicle.id, s)}
                  className={"py-2 text-[9px] font-mono font-bold border rounded-lg transition-colors " + sc.bg + " " + sc.border + " " + sc.color + " hover:opacity-80"}>
                  → {s.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FleetPage() {
  const { vehicles, total, loading, fetchVehicles, createVehicle } = useVehicleStore();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  const load = useCallback(() => {
    const params = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (regionFilter) params.region = regionFilter;
    fetchVehicles(params);
  }, [search, statusFilter, regionFilter]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const onSubmit = async (data) => {
    try {
      await createVehicle(data);
      toast.success("Vehicle registered");
      reset();
      setShowForm(false);
    } catch (e) { toast.error(e.response?.data?.error || "Failed"); }
  };

  const changeStatus = async (id, status) => {
    try {
      await vehiclesAPI.updateStatus(id, status);
      toast.success("Status updated");
      if (selected?.id === id) setSelected(p => ({ ...p, status }));
      load();
    } catch { toast.error("Failed"); }
  };

  const stats = [
    ["TOTAL",    vehicles.length,                                              "text-slate-300"],
    ["ACTIVE",   vehicles.filter(v => v.status === "active").length,           "text-emerald-400"],
    ["IDLE",     vehicles.filter(v => v.status === "idle").length,             "text-slate-400"],
    ["MAINT",    vehicles.filter(v => v.status === "maintenance").length,      "text-amber-400"],
    ["OFFLINE",  vehicles.filter(v => v.status === "offline").length,          "text-red-400"],
    ["LOW FUEL", vehicles.filter(v => parseFloat(v.fuel_level||100) < 25).length, "text-orange-400"],
  ];

  return (
    <div className="space-y-5 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">FLEET MANAGEMENT</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{total || vehicles.length} vehicles registered across {[...new Set(vehicles.map(v=>v.region))].length} regions</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2.5 bg-navy-900 border border-white/10 rounded-xl text-slate-400 hover:text-white hover:border-white/20 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
            {showForm ? <><X size={13} />CANCEL</> : <><Plus size={13} />ADD VEHICLE</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(([label, val, color]) => (
          <div key={label} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
            <p className={"font-display text-2xl font-bold " + color}>{val}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Add vehicle form */}
      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">REGISTER NEW VEHICLE</p>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Registration *</label>
              <input {...register("registration")} placeholder="KEN-001" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Type *</label>
              <select {...register("type")} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                <option value="">Select</option>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Region *</label>
              <select {...register("region")} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Make</label>
              <input {...register("make")} placeholder="Toyota" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Model</label>
              <input {...register("model")} placeholder="Land Cruiser" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 disabled:opacity-50">
                <Plus size={13} />{isSubmitting ? "ADDING..." : "REGISTER"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search registration, region, driver..."
            className="w-full bg-navy-900 border border-white/[0.06] focus:border-gold/40 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none min-w-36">
          <option value="">All statuses</option>
          {["active","idle","maintenance","offline"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
        <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
          className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none min-w-36">
          <option value="">All regions</option>
          {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex gap-5">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : vehicles.length === 0 ? (
            <EmptyState icon={Truck} title="No vehicles found" subtitle="Register a vehicle or adjust your filters" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {vehicles.map(v => (
                <VehicleCard key={v.id} vehicle={v} onSelect={setSelected} selected={selected?.id === v.id} />
              ))}
            </div>
          )}
        </div>

        {selected && (
          <VehicleDetailPanel vehicle={selected} onClose={() => setSelected(null)} onStatusChange={changeStatus} />
        )}
      </div>
    </div>
  );
}