import { useState, useEffect } from "react";
import { Plus, X, UserCheck, Truck } from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { convoysAPI } from "../services/api";

const REGIONS = ["Kenya","Tanzania","DRC","Mali","Nigeria","Ethiopia","Uganda","Sudan"];
const PRIORITIES = ["low","medium","high","critical"];
const POSITIONS = [1,2,3,4,5,6];

const emptyTruck = () => ({ position: "", vehicle_id: "", driver_name: "", driver_phone: "", driver_license_no: "" });
const emptyCfo = () => ({ cfo_user_id: "", assigned_truck_positions: [] });

export default function CfoConvoyForm({ onCreated, onCancel }) {
  const [vehicles, setVehicles] = useState([]);
  const [cfoUsers, setCfoUsers] = useState([]);
  const [trucks, setTrucks] = useState([emptyTruck()]);
  const [cfos, setCfos] = useState([emptyCfo()]);
  const [meta, setMeta] = useState({
    name: "", region: "Kenya", priority: "high",
    timezone: "UTC", start_date: "", end_date: "",
    seal_count_per_truck: 3, route_origin: "", route_destination: "", description: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get("/vehicles", { params: { limit: 200 } }).then(r => setVehicles(r.data.data || [])).catch(() => {});
    api.get("/auth/users", { params: { role: "cfo", limit: 100 } })
      .catch(() => api.get("/devices", { params: { limit: 1 } })) // fallback to check auth
      .catch(() => {});
    // Fetch CFO users from users endpoint
    api.get("/auth/users?role=cfo").then(r => setCfoUsers(r.data.data || [])).catch(() => {});
  }, []);

  function updateTruck(i, field, val) {
    setTrucks(ts => ts.map((t, idx) => idx === i ? { ...t, [field]: val } : t));
  }

  function updateCfo(i, field, val) {
    setCfos(cs => cs.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }

  function toggleCfoPos(cfoIdx, pos) {
    setCfos(cs => cs.map((c, i) => {
      if (i !== cfoIdx) return c;
      const posNum = Number(pos);
      const has = c.assigned_truck_positions.includes(posNum);
      return {
        ...c,
        assigned_truck_positions: has
          ? c.assigned_truck_positions.filter(p => p !== posNum)
          : [...c.assigned_truck_positions, posNum],
      };
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!meta.name || !meta.start_date || !meta.end_date || !meta.route_origin || !meta.route_destination) {
      toast.error("Fill in all required fields");
      return;
    }
    if (trucks.some(t => !t.position || !t.driver_name)) {
      toast.error("All trucks need a position and driver name");
      return;
    }
    if (cfos.some(c => !c.cfo_user_id || c.assigned_truck_positions.length === 0)) {
      toast.error("All CFOs need a user and at least one truck position");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        ...meta,
        seal_count_per_truck: Number(meta.seal_count_per_truck),
        trucks: trucks.map(t => ({ ...t, position: Number(t.position) })),
        cfos: cfos.map(c => ({
          cfo_user_id: c.cfo_user_id,
          assigned_truck_positions: c.assigned_truck_positions,
        })),
      };
      const res = await convoysAPI.create(body);
      toast.success("CFO convoy created");
      onCreated(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create convoy");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none placeholder-slate-600";
  const label = "text-[9px] font-mono text-slate-500 uppercase tracking-widest";

  const usedPositions = trucks.map(t => Number(t.position)).filter(Boolean);

  return (
    <form onSubmit={handleSubmit} className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-gold uppercase tracking-widest">CFO CONVOY SETUP</p>
        <button type="button" onClick={onCancel} className="text-slate-600 hover:text-white"><X size={14} /></button>
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Convoy Name *","name","text"],["Origin *","route_origin","text"],["Destination *","route_destination","text"],["Timezone","timezone","text"]].map(([lbl,name,type]) => (
          <div key={name} className="space-y-1">
            <label className={label}>{lbl}</label>
            <input type={type} value={meta[name]} onChange={e => setMeta(m => ({...m, [name]: e.target.value}))} className={field} />
          </div>
        ))}
        <div className="space-y-1">
          <label className={label}>Region *</label>
          <select value={meta.region} onChange={e => setMeta(m => ({...m, region: e.target.value}))} className={field}>
            {REGIONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={label}>Priority *</label>
          <select value={meta.priority} onChange={e => setMeta(m => ({...m, priority: e.target.value}))} className={field}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={label}>Start Date *</label>
          <input type="date" value={meta.start_date} onChange={e => setMeta(m => ({...m, start_date: e.target.value}))} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>End Date *</label>
          <input type="date" value={meta.end_date} onChange={e => setMeta(m => ({...m, end_date: e.target.value}))} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Seals / Truck (1-6)</label>
          <input type="number" min={1} max={6} value={meta.seal_count_per_truck}
            onChange={e => setMeta(m => ({...m, seal_count_per_truck: e.target.value}))} className={field} />
        </div>
      </div>

      {/* Trucks */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center gap-1"><Truck size={11} /> TRUCKS (max 6)</p>
          {trucks.length < 6 && (
            <button type="button" onClick={() => setTrucks(ts => [...ts, emptyTruck()])}
              className="text-[9px] font-mono text-gold hover:text-gold/70 flex items-center gap-1"><Plus size={10} />ADD</button>
          )}
        </div>
        {trucks.map((t, i) => (
          <div key={i} className="grid grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <label className={label}>Pos</label>
              <select value={t.position} onChange={e => updateTruck(i, "position", e.target.value)} className={field}>
                <option value="">—</option>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1 col-span-2">
              <label className={label}>Driver Name *</label>
              <input value={t.driver_name} onChange={e => updateTruck(i, "driver_name", e.target.value)} className={field} placeholder="John Doe" />
            </div>
            <div className="space-y-1">
              <label className={label}>Phone</label>
              <input value={t.driver_phone} onChange={e => updateTruck(i, "driver_phone", e.target.value)} className={field} placeholder="+254…" />
            </div>
            <button type="button" onClick={() => setTrucks(ts => ts.filter((_,j) => j !== i))}
              className="text-slate-600 hover:text-red-400 pb-2"><X size={12} /></button>
          </div>
        ))}
      </div>

      {/* CFOs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center gap-1"><UserCheck size={11} /> FIELD OFFICERS</p>
          <button type="button" onClick={() => setCfos(cs => [...cs, emptyCfo()])}
            className="text-[9px] font-mono text-gold hover:text-gold/70 flex items-center gap-1"><Plus size={10} />ADD</button>
        </div>
        {cfos.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <label className={label}>CFO User ID (UUID)</label>
              <input value={c.cfo_user_id} onChange={e => updateCfo(i, "cfo_user_id", e.target.value)} className={field} placeholder="uuid-of-cfo-user" />
            </div>
            <div className="flex-1 space-y-1">
              <label className={label}>Assigned Truck Positions (tap to toggle)</label>
              <div className="flex gap-1 mt-1">
                {usedPositions.map(pos => (
                  <button key={pos} type="button"
                    onClick={() => toggleCfoPos(i, pos)}
                    className={"w-8 h-8 rounded text-xs font-bold border transition-colors " +
                      (c.assigned_truck_positions.includes(pos)
                        ? "bg-gold text-navy-950 border-gold"
                        : "bg-navy-800 text-slate-400 border-white/10 hover:border-gold/40")}>
                    {pos}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => setCfos(cs => cs.filter((_,j) => j !== i))}
              className="text-slate-600 hover:text-red-400 mt-6"><X size={12} /></button>
          </div>
        ))}
      </div>

      <button type="submit" disabled={submitting}
        className="w-full py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 transition-colors disabled:opacity-50">
        {submitting ? "CREATING…" : "CREATE CFO CONVOY"}
      </button>
    </form>
  );
}
