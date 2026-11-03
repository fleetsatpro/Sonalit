import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Route, Plus, X, ChevronRight, Shield, FileText, AlertTriangle,
  Activity, Truck, Clock, MapPin, Users, TrendingUp, Radio,
  CheckCircle, AlertCircle, Navigation, Fuel, Wrench, Eye, RefreshCw
} from "lucide-react";
import toast from "react-hot-toast";
import { useConvoyStore } from "../store";
import { convoysAPI, documentsAPI } from "../services/api";
import api from "../services/api";
import { Card, Button, Input, Spinner, EmptyState } from "../components/UI";
import { formatDate } from "../utils/helpers";
import CfoConvoyForm from "./CfoConvoyForm";

const schema = z.object({
  name: z.string().min(3),
  region: z.string().min(1),
  priority: z.enum(["low","medium","high","critical"]),
  route_origin: z.string().min(1),
  route_destination: z.string().min(1),
  description: z.string().optional(),
  departure_time: z.string().optional(),
});

const REGIONS = ["Kenya","Tanzania","DRC","Mali","Nigeria","Ethiopia","Uganda","Sudan"];

const priorityColors = {
  low: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  medium: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  high: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
};

const riskConfig = {
  LOW:      { color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", dot: "bg-emerald-400" },
  MEDIUM:   { color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/20",   dot: "bg-amber-400"   },
  HIGH:     { color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/20",  dot: "bg-orange-400"  },
  CRITICAL: { color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/20",     dot: "bg-red-400 animate-pulse" },
};

const statusConfig = {
  planned:   { color: "text-slate-400",   border: "border-slate-600/30",   bg: "bg-slate-800/30",   header: "bg-slate-800/50"   },
  active:    { color: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-900/10", header: "bg-emerald-900/30" },
  completed: { color: "text-blue-400",    border: "border-blue-500/30",    bg: "bg-blue-900/10",    header: "bg-blue-900/30"    },
  aborted:   { color: "text-red-400",     border: "border-red-500/30",     bg: "bg-red-900/10",     header: "bg-red-900/30"     },
};

function RiskBadge({ convoyId, inline = false }) {
  const [risk, setRisk] = useState(null);
  useEffect(() => {
    api.get("/ai/risk/" + convoyId).then(r => setRisk(r.data.data)).catch(() => {});
  }, [convoyId]);
  if (!risk) return <div className="w-12 h-4 bg-navy-700 rounded animate-pulse" />;
  const c = riskConfig[risk.level] || riskConfig.LOW;
  if (inline) return (
    <span className={"inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border " + c.bg + " " + c.border + " " + c.color}>
      <span className={"w-1.5 h-1.5 rounded-full " + c.dot} />
      {risk.level}
    </span>
  );
  return (
    <div className={"flex items-center gap-2 px-3 py-2 rounded-lg border " + c.bg + " " + c.border}>
      <Shield size={13} className={c.color} />
      <span className={"text-xs font-mono font-bold " + c.color}>{risk.level} RISK</span>
      {risk.openAlerts > 0 && <span className="text-[10px] text-slate-500 ml-auto">{risk.openAlerts} open alerts</span>}
    </div>
  );
}

function ETACountdown({ estimatedArrival }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!estimatedArrival) return;
    const calc = () => {
      const diff = new Date(estimatedArrival) - Date.now();
      if (diff <= 0) { setRemaining("ARRIVED"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setRemaining(h + "h " + m + "m");
    };
    calc();
    const t = setInterval(calc, 60000);
    return () => clearInterval(t);
  }, [estimatedArrival]);
  if (!estimatedArrival || !remaining) return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono">
      <Clock size={10} className="text-gold" />
      <span className="text-gold font-bold">ETA {remaining}</span>
    </div>
  );
}

function ConvoyCard({ convoy, onSelect, selected }) {
  const sc = statusConfig[convoy.status] || statusConfig.planned;
  return (
    <div onClick={() => onSelect(convoy)}
      className={"border rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-[1.01] mb-3 " + sc.border + (selected ? " ring-2 ring-gold/40" : "")}>
      <div className={"px-4 py-2.5 flex items-center justify-between " + sc.header}>
        <span className={"text-[9px] font-mono font-bold tracking-widest " + sc.color}>{convoy.name}</span>
        <span className={"text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border " + (priorityColors[convoy.priority] || priorityColors.medium)}>
          {convoy.priority?.toUpperCase()}
        </span>
      </div>
      <div className={"px-4 py-3 " + sc.bg}>
        <div className="flex items-center gap-1.5 text-sm text-slate-300 mb-2">
          <Navigation size={11} className="text-slate-500 flex-shrink-0" />
          <span className="truncate">{convoy.route_origin} → {convoy.route_destination}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
              <MapPin size={9} />{convoy.region}
            </span>
            {convoy.vehicle_count > 0 && (
              <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                <Truck size={9} />{convoy.vehicle_count}
              </span>
            )}
          </div>
          <RiskBadge convoyId={convoy.id} inline />
        </div>
        {convoy.status === "active" && (
          <div className="mt-2 pt-2 border-t border-white/5">
            <ETACountdown estimatedArrival={convoy.estimated_arrival} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConvoyDetailPanel({ convoy, onClose, onRefresh }) {
  const [tab, setTab] = useState("overview");
  const [vehicles, setVehicles] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [docs, setDocs] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  useEffect(() => {
    setTab("overview");
    setLoadingVehicles(true);
    Promise.all([
      api.get("/vehicles", { params: { convoy_id: convoy.id, limit: 20 } }).catch(() => ({ data: { data: [] } })),
      api.get("/alerts", { params: { limit: 10, resolved: "false" } }).catch(() => ({ data: { data: [] } })),
      api.get("/documents", { params: { convoy_id: convoy.id } }).catch(() => ({ data: { data: [] } })),
      convoysAPI.getReports(convoy.id).catch(() => ({ data: { data: [] } })),
    ]).then(([v, a, d, r]) => {
      setVehicles(v.data.data || []);
      setAlerts((a.data.data || []).filter(al => al.convoy_id === convoy.id));
      setDocs(d.data.data || []);
      setReports(r.data.data || []);
    }).finally(() => setLoadingVehicles(false));
  }, [convoy.id]);

  const changeStatus = async (status) => {
    try {
      await convoysAPI.updateStatus(convoy.id, status);
      toast.success("Status → " + status);
      onRefresh();
    } catch { toast.error("Failed"); }
  };

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "vehicles", label: "Vehicles (" + vehicles.length + ")" },
    { key: "alerts",   label: "Alerts (" + alerts.length + ")" },
    { key: "docs",     label: "Docs (" + docs.length + ")" },
    { key: "reports",  label: "Reports (" + reports.length + ")" },
  ];

  const STATUS_TRANSITIONS = {
    planned:   ["active", "aborted"],
    active:    ["completed", "aborted"],
    completed: [],
    aborted:   ["planned"],
  };

  return (
    <div className="w-96 flex-shrink-0 bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col" style={{maxHeight:"calc(100vh - 140px)"}}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] bg-navy-800/50">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-display font-bold text-gold text-base">{convoy.name}</p>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Navigation size={10} />{convoy.route_origin} → {convoy.route_destination}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X size={14} />
          </button>
        </div>
        <RiskBadge convoyId={convoy.id} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] px-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={"px-3 py-2.5 text-[10px] font-mono font-bold tracking-wider transition-colors border-b-2 " +
              (tab === t.key ? "text-gold border-gold" : "text-slate-600 border-transparent hover:text-slate-400")}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Status + Priority */}
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Status", convoy.status?.toUpperCase(), "text-slate-200"],
                ["Priority", convoy.priority?.toUpperCase(), priorityColors[convoy.priority]?.split(" ")[0] || "text-slate-200"],
                ["Region", convoy.region, "text-slate-200"],
                ["Vehicles", vehicles.length, "text-gold"],
              ].map(([label, value, color]) => (
                <div key={label} className="bg-navy-800 rounded-xl p-3 border border-white/5">
                  <p className="text-[9px] font-mono text-slate-500 tracking-wider mb-1">{label.toUpperCase()}</p>
                  <p className={"text-sm font-bold " + color}>{value}</p>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
              <p className="text-[9px] font-mono text-slate-500 tracking-wider mb-3">TIMELINE</p>
              <div className="space-y-2">
                {[
                  ["Created", convoy.created_at],
                  ["Departure", convoy.departure_time],
                  ["Est. Arrival", convoy.estimated_arrival],
                  ["Actual Arrival", convoy.arrival_time],
                ].map(([label, val]) => val && (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-mono text-slate-300">{formatDate(val)}</span>
                  </div>
                ))}
              </div>
              {convoy.status === "active" && convoy.estimated_arrival && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <ETACountdown estimatedArrival={convoy.estimated_arrival} />
                </div>
              )}
            </div>

            {/* Description */}
            {convoy.description && (
              <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
                <p className="text-[9px] font-mono text-slate-500 tracking-wider mb-2">MISSION BRIEF</p>
                <p className="text-xs text-slate-300 leading-relaxed">{convoy.description}</p>
              </div>
            )}

            {/* Status transitions */}
            {(STATUS_TRANSITIONS[convoy.status] || []).length > 0 && (
              <div>
                <p className="text-[9px] font-mono text-slate-600 mb-2">CHANGE STATUS</p>
                <div className="grid grid-cols-2 gap-2">
                  {(STATUS_TRANSITIONS[convoy.status] || []).map(s => (
                    <button key={s} onClick={() => changeStatus(s)}
                      className={"py-2 text-[10px] font-mono font-bold border rounded-lg transition-colors " +
                        (s === "aborted" ? "border-red-500/30 text-red-400 hover:bg-red-500/10" :
                         s === "active" ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" :
                         "border-blue-500/30 text-blue-400 hover:bg-blue-500/10")}>
                      → {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "vehicles" && (
          <div className="space-y-2">
            {loadingVehicles ? <div className="flex justify-center py-8"><Spinner /></div>
              : vehicles.length === 0
                ? <div className="text-center py-8 text-slate-600 text-sm">No vehicles assigned</div>
                : vehicles.map(v => (
                  <div key={v.id} className="bg-navy-800 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                    <div className={"w-2 h-2 rounded-full flex-shrink-0 " +
                      (v.status === "active" ? "bg-emerald-400" : v.status === "offline" ? "bg-red-400" : "bg-slate-500")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-bold text-slate-200">{v.registration}</p>
                      <p className="text-[10px] text-slate-500">{v.type} · {v.driver_name || "No driver"}</p>
                    </div>
                    <div className="text-right">
                      {v.fuel_level != null && (
                        <p className={"text-[10px] font-mono font-bold " + (v.fuel_level < 25 ? "text-red-400" : v.fuel_level < 50 ? "text-amber-400" : "text-emerald-400")}>
                          {parseFloat(v.fuel_level).toFixed(0)}% fuel
                        </p>
                      )}
                      {v.speed > 0 && <p className="text-[10px] text-slate-500">{v.speed} km/h</p>}
                    </div>
                  </div>
                ))}
          </div>
        )}

        {tab === "alerts" && (
          <div className="space-y-2">
            {alerts.length === 0
              ? <div className="text-center py-8 text-slate-600 text-sm flex flex-col items-center gap-2">
                  <CheckCircle size={24} className="text-emerald-500/50" />
                  No open alerts for this convoy
                </div>
              : alerts.map(a => (
                <div key={a.id} className={"rounded-xl p-3 border " +
                  (a.severity === "critical" ? "bg-red-900/20 border-red-500/20" :
                   a.severity === "high" ? "bg-orange-900/20 border-orange-500/20" :
                   "bg-navy-800 border-white/5")}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={"text-[9px] font-mono font-bold " +
                      (a.severity === "critical" ? "text-red-400" : a.severity === "high" ? "text-orange-400" : "text-amber-400")}>
                      {a.severity?.toUpperCase()}
                    </span>
                    <span className="text-[9px] text-slate-500">{a.type}</span>
                  </div>
                  <p className="text-xs text-slate-300">{a.message}</p>
                </div>
              ))}
          </div>
        )}

        {tab === "docs" && (
          <div className="space-y-2">
            {docs.length === 0
              ? <p className="text-center py-8 text-slate-600 text-sm">No documents attached</p>
              : docs.map(d => (
                <div key={d.id} className="bg-navy-800 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                  <FileText size={13} className="text-slate-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 truncate">{d.title}</p>
                    <p className="text-[10px] text-slate-600">{d.type?.replace(/_/g, " ")}</p>
                  </div>
                  {d.valid_until && new Date(d.valid_until) < new Date(Date.now() + 7*86400000) && (
                    <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                  )}
                </div>
              ))}
            <button onClick={async () => {
              try {
                await api.post("/documents", { convoy_id: convoy.id, type: "manifest", title: "Manifest — " + convoy.name });
                const r = await api.get("/documents", { params: { convoy_id: convoy.id } });
                setDocs(r.data.data || []);
                toast.success("Document added");
              } catch { toast.error("Failed"); }
            }} className="w-full py-2.5 border border-dashed border-white/10 hover:border-white/20 text-slate-600 hover:text-slate-400 rounded-xl text-xs font-mono transition-colors">
              + ADD DOCUMENT
            </button>
          </div>
        )}

        {tab === "reports" && (
          <div className="space-y-2">
            {reports.length === 0
              ? <p className="text-center py-8 text-slate-600 text-sm">No CFO daily reports yet</p>
              : reports.map(r => {
                  const pct = r.required_photo_count > 0
                    ? Math.round((r.received_photo_count / r.required_photo_count) * 100)
                    : 0;
                  const statusColor = { complete: "text-emerald-400", generated: "text-blue-400", failed: "text-red-400", partial: "text-amber-400" }[r.status] || "text-slate-400";
                  return (
                    <div key={r.id} className="bg-navy-800 rounded-xl p-3 border border-white/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-slate-300">{r.report_date}</span>
                        <span className={"text-[10px] font-mono font-bold " + statusColor}>{r.status.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                          <div className="h-full bg-gold rounded-full" style={{ width: pct + "%" }} />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono w-14 text-right">{r.received_photo_count}/{r.required_photo_count}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.pdf_url && (
                          <a href={r.pdf_url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1">
                            <FileText size={10} /> PDF
                          </a>
                        )}
                        <button onClick={async () => {
                          try {
                            await convoysAPI.regenerateReport(convoy.id, r.report_date);
                            toast.success("Regeneration queued");
                          } catch { toast.error("Failed"); }
                        }} className="text-[10px] font-mono text-slate-500 hover:text-slate-300 flex items-center gap-1 ml-auto">
                          <RefreshCw size={9} /> REGENERATE
                        </button>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConvoysPage() {
  const { convoys, loading, fetchConvoys, createConvoy } = useConvoyStore();
  const [showForm, setShowForm] = useState(false);
  const [cfoMode, setCfoMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("board"); // board | list

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { priority: "medium", region: "Kenya" },
  });

  useEffect(() => { fetchConvoys(); }, []);

  const onSubmit = async (data) => {
    try {
      await createConvoy(data);
      toast.success("Convoy created");
      reset();
      setShowForm(false);
    } catch (e) { toast.error(e.response?.data?.error || "Failed"); }
  };

  const byStatus = (s) => convoys.filter(c => c.status === s);

  const STATUS_COLS = [
    { key: "planned",   label: "Planned",   count: byStatus("planned").length },
    { key: "active",    label: "Active",    count: byStatus("active").length  },
    { key: "completed", label: "Completed", count: byStatus("completed").length },
    { key: "aborted",   label: "Aborted",   count: byStatus("aborted").length  },
  ];

  // Summary stats
  const totalVehicles = convoys.reduce((s, c) => s + (c.vehicle_count || 0), 0);
  const criticalCount = convoys.filter(c => c.priority === "critical" && c.status === "active").length;

  return (
    <div className="space-y-5 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">CONVOY OPERATIONS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">
            {convoys.length} missions · {byStatus("active").length} active · {totalVehicles} vehicles deployed
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
            {showForm ? <><X size={13} /> CANCEL</> : <><Plus size={13} /> NEW CONVOY</>}
          </button>
          {showForm && (
            <button type="button" onClick={() => setCfoMode(m => !m)}
              className={"flex items-center gap-1.5 px-3 py-2.5 border rounded-xl text-xs font-mono font-bold transition-colors " +
                (cfoMode ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "bg-white/5 border-white/10 text-slate-500 hover:text-slate-300")}>
              <Truck size={11} />{cfoMode ? "CFO MODE ON" : "CFO MODE"}
          </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          ["PLANNED",   byStatus("planned").length,   "text-slate-300"],
          ["ACTIVE",    byStatus("active").length,    "text-emerald-400"],
          ["COMPLETED", byStatus("completed").length, "text-blue-400"],
          ["CRITICAL",  criticalCount,                "text-red-400"],
        ].map(([label, val, color]) => (
          <div key={label} className="bg-navy-900 border border-white/5 rounded-xl p-4 text-center">
            <p className={"font-display text-3xl font-bold " + color}>{val}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && cfoMode && (
        <CfoConvoyForm
          onCreated={(convoy) => { setShowForm(false); setCfoMode(false); fetchConvoys(); setSelected(convoy); }}
          onCancel={() => { setShowForm(false); setCfoMode(false); }}
        />
      )}

      {showForm && !cfoMode && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">CREATE CONVOY</p>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Convoy Name *</label>
              <input {...register("name")} placeholder="Operation Alpha" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
              {errors.name && <p className="text-[10px] text-red-400">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Region *</label>
              <select {...register("region")} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Priority *</label>
              <select {...register("priority")} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {["low","medium","high","critical"].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Departure Time</label>
              <input {...register("departure_time")} type="datetime-local" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Origin *</label>
              <input {...register("route_origin")} placeholder="Nairobi" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Destination *</label>
              <input {...register("route_destination")} placeholder="Mombasa" className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Mission Brief</label>
              <input {...register("description")} placeholder="Mission objectives and security notes..." className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 transition-colors disabled:opacity-50">
                <Route size={13} />{isSubmitting ? "CREATING..." : "CREATE MISSION"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main content */}
      <div className="flex gap-5">
        {/* Kanban board */}
        <div className={"grid gap-4 flex-1 min-w-0 " + (selected ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-2 xl:grid-cols-4")}>
          {STATUS_COLS.map(({ key, label, count }) => {
            const sc = statusConfig[key] || statusConfig.planned;
            const items = byStatus(key);
            return (
              <div key={key} className={"border rounded-xl overflow-hidden " + sc.border}>
                <div className={"px-4 py-2.5 flex items-center justify-between " + sc.header}>
                  <span className={"text-[9px] font-mono font-bold tracking-widest " + sc.color}>{label.toUpperCase()}</span>
                  <span className={"w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold " + sc.color + " " + sc.bg}>{count}</span>
                </div>
                <div className="p-3">
                  {loading ? <div className="flex justify-center py-8"><Spinner /></div>
                    : items.length === 0
                      ? <p className="text-center text-[10px] text-slate-700 py-8 font-mono">— EMPTY —</p>
                      : items.map(c => (
                        <ConvoyCard key={c.id} convoy={c} onSelect={setSelected} selected={selected?.id === c.id} />
                      ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <ConvoyDetailPanel
            convoy={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => { fetchConvoys(); }}
          />
        )}
      </div>
    </div>
  );
}