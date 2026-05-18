import { useEffect, useState } from "react";
import { UserCheck, Truck, Calendar, MapPin, Activity } from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { Spinner } from "../components/UI";

function statusDot(status) {
  const colors = { active: "bg-emerald-400", planned: "bg-slate-500", completed: "bg-blue-400", cancelled: "bg-red-400/60" };
  return <span className={"w-2 h-2 rounded-full inline-block mr-1.5 " + (colors[status] || "bg-slate-600")} />;
}

function CfoCard({ user, assignments }) {
  return (
    <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 bg-navy-800/50 border-b border-white/[0.06] flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
          <UserCheck size={14} className="text-blue-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-200">{user.name}</p>
          <p className="text-[10px] font-mono text-slate-500">{user.email}</p>
        </div>
        <span className="ml-auto text-[9px] font-mono text-slate-600 uppercase tracking-widest">CFO</span>
      </div>

      {assignments.length === 0 ? (
        <div className="px-5 py-6 text-center text-slate-600 text-xs">No convoy assignments</div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {assignments.map((a) => (
            <div key={a.convoy_cfo_id} className="px-5 py-3 space-y-2">
              <div className="flex items-center gap-2">
                {statusDot(a.convoy_status)}
                <span className="text-sm font-medium text-slate-200">{a.convoy_name}</span>
                <span className={"ml-auto text-[10px] font-mono font-bold " +
                  ({ active: "text-emerald-400", planned: "text-slate-400", completed: "text-blue-400" }[a.convoy_status] || "text-slate-500")}>
                  {a.convoy_status?.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-slate-500 font-mono">
                {a.start_date && (
                  <span className="flex items-center gap-1"><Calendar size={9} />{a.start_date} → {a.end_date || "?"}</span>
                )}
                {a.timezone && a.timezone !== "UTC" && <span className="flex items-center gap-1"><MapPin size={9} />{a.timezone}</span>}
              </div>
              {a.trucks && a.trucks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {a.trucks.map((t) => (
                    <span key={t.id} className="flex items-center gap-1 px-2 py-0.5 bg-navy-800 border border-white/5 rounded-lg text-[10px] text-slate-400 font-mono">
                      <Truck size={9} /> T{t.position} {t.driver_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FieldOfficersPage() {
  const [officers, setOfficers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    // Fetch CFO users and their convoy assignments in parallel
    Promise.all([
      api.get("/auth/users", { params: { role: "cfo", limit: 100 } }).catch(() => ({ data: { data: [] } })),
      api.get("/convoys", { params: { limit: 100 } }).catch(() => ({ data: { data: [] } })),
    ]).then(async ([usersRes, convoysRes]) => {
      const cfoUsers = usersRes.data.data || usersRes.data.users || [];
      const convoys = convoysRes.data.data || [];
      setOfficers(cfoUsers);

      // Fetch truck assignments from convoy details
      const assignMap = {};
      for (const cfo of cfoUsers) {
        assignMap[cfo.id] = [];
      }

      for (const convoy of convoys.filter(c => ["planned","active"].includes(c.status))) {
        try {
          const detail = await api.get(`/convoys/${convoy.id}`);
          const { cfos, cfo_truck_assignments, trucks } = detail.data.data || {};
          if (!cfos) continue;
          for (const cfoEntry of cfos) {
            if (!assignMap[cfoEntry.cfo_user_id]) assignMap[cfoEntry.cfo_user_id] = [];
            const cfoTrucks = (cfo_truck_assignments || [])
              .filter(a => a.cfo_user_id === cfoEntry.cfo_user_id)
              .map(a => (trucks || []).find(t => t.id === a.convoy_truck_id))
              .filter(Boolean);
            assignMap[cfoEntry.cfo_user_id].push({
              convoy_cfo_id: cfoEntry.id,
              convoy_name: convoy.name,
              convoy_status: convoy.status,
              start_date: convoy.start_date,
              end_date: convoy.end_date,
              timezone: convoy.timezone,
              trucks: cfoTrucks,
            });
          }
        } catch {}
      }
      setAssignments(assignMap);
    }).catch(() => toast.error("Failed to load field officers"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = officers.filter(o =>
    o.name?.toLowerCase().includes(search.toLowerCase()) ||
    o.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">FIELD OFFICERS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">
            {officers.length} CFO{officers.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search officers…"
          className="bg-navy-900 border border-white/10 focus:border-gold/40 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none placeholder-slate-600 w-48"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-600 font-mono text-sm">
          {search ? "No officers match the search" : "No CFO users registered yet"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(o => (
            <CfoCard key={o.id} user={o} assignments={assignments[o.id] || []} />
          ))}
        </div>
      )}
    </div>
  );
}
