import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Navigation, Loader2, AlertTriangle, ChevronDown, ChevronUp, Clock, Route, ShieldAlert, CheckCircle2, } from 'lucide-react';
import { api } from '../lib/api.js';
// ── Helpers ────────────────────────────────────────────────────────────────────
function riskColor(score) {
    if (score >= 70)
        return 'text-red-400';
    if (score >= 40)
        return 'text-yellow-400';
    return 'text-green-400';
}
function riskBg(score) {
    if (score >= 70)
        return 'bg-red-500';
    if (score >= 40)
        return 'bg-yellow-500';
    return 'bg-green-500';
}
function riskLabel(score) {
    if (score >= 70)
        return 'HIGH RISK';
    if (score >= 40)
        return 'MODERATE';
    return 'LOW RISK';
}
function RiskGauge({ score }) {
    return (<div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${riskBg(score)}`} style={{ width: `${score}%` }}/>
      </div>
      <span className={`text-sm font-bold tabular-nums w-8 text-right ${riskColor(score)}`}>
        {Math.round(score)}
      </span>
    </div>);
}
const FACTOR_LABELS = {
    armed_robbery: 'Armed Robbery',
    carjacking: 'Carjacking',
    road_condition: 'Road Condition',
    weather: 'Weather',
    civil_unrest: 'Civil Unrest',
    border_delay: 'Border Delay',
    fuel_scarcity: 'Fuel Scarcity',
    night_travel: 'Night Travel',
    other: 'Other',
};
function FactorBadge({ factor }) {
    const isDangerous = ['armed_robbery', 'carjacking', 'civil_unrest'].includes(factor);
    return (<span className={`text-xs px-2 py-0.5 rounded border ${isDangerous ? 'bg-red-900/50 text-red-300 border-red-700/50' : 'bg-amber-900/40 text-amber-300 border-amber-700/40'}`}>
      {FACTOR_LABELS[factor] ?? factor}
    </span>);
}
function RouteCard({ route, recommended = false }) {
    const [open, setOpen] = useState(false);
    return (<div className={`rounded-lg border p-3 ${recommended ? 'border-green-700/50 bg-green-900/10' : 'border-gray-700 bg-gray-800/50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {recommended && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0"/>}
          <span className="text-sm font-medium text-white">{route.label}</span>
        </div>
        <span className={`text-xs font-bold ${riskColor(route.risk_score)}`}>
          {riskLabel(route.risk_score)} ({Math.round(route.risk_score)})
        </span>
      </div>

      <div className="mt-2 flex gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><Route className="w-3 h-3"/>{route.distance_km.toFixed(0)} km</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3"/>{route.estimated_duration_minutes} min</span>
      </div>

      {route.risk_factors.length > 0 && (<div className="mt-2 flex flex-wrap gap-1">
          {route.risk_factors.map((f) => <FactorBadge key={f} factor={f}/>)}
        </div>)}

      {route.notes && (<button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 mt-1.5">
          {open ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
          Notes
        </button>)}
      {open && route.notes && (<p className="text-xs text-gray-400 mt-1 leading-relaxed">{route.notes}</p>)}
    </div>);
}
function AnalysisCard({ analysis }) {
    const [expanded, setExpanded] = useState(false);
    return (<div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500 font-mono">
            {analysis.origin_lat.toFixed(4)},{analysis.origin_lng.toFixed(4)}
            {' → '}
            {analysis.destination_lat.toFixed(4)},{analysis.destination_lng.toFixed(4)}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            {new Date(analysis.analysed_at).toLocaleString()}
            {analysis.requested_by_name ? ` · ${analysis.requested_by_name}` : ''}
          </p>
        </div>
        <span className={`text-sm font-bold ${riskColor(analysis.overall_risk_score)} flex-shrink-0`}>
          {riskLabel(analysis.overall_risk_score)}
        </span>
      </div>

      <RiskGauge score={analysis.overall_risk_score}/>

      {analysis.primary_risk_factors.length > 0 && (<div className="flex flex-wrap gap-1">
          {analysis.primary_risk_factors.map((f) => <FactorBadge key={f} factor={f}/>)}
        </div>)}

      {analysis.ai_summary && (<p className="text-sm text-gray-300 leading-relaxed">{analysis.ai_summary}</p>)}

      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
        {expanded ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
        {expanded ? 'Hide routes' : 'Show routes'}
      </button>

      {expanded && (<div className="space-y-2 pt-1">
          {analysis.recommended_route?.label && (<RouteCard route={analysis.recommended_route} recommended/>)}
          {analysis.alternate_routes?.map((r, i) => (<RouteCard key={i} route={r}/>))}
        </div>)}
    </div>);
}
const EMPTY_FORM = {
    origin_lat: '', origin_lng: '', dest_lat: '', dest_lng: '',
    departure_time: '', avoid_night: false,
};
export default function RouteAnalysis() {
    const [form, setForm] = useState(EMPTY_FORM);
    const [latestResult, setLatestResult] = useState(null);
    const { data: history, refetch: refetchHistory } = useQuery({
        queryKey: ['route-analyses'],
        queryFn: () => api.get('/routes/analyses').then((r) => r.data),
    });
    const analyse = useMutation({
        mutationFn: () => api.post('/routes/analyse', {
            origin: { lat: parseFloat(form.origin_lat), lng: parseFloat(form.origin_lng) },
            destination: { lat: parseFloat(form.dest_lat), lng: parseFloat(form.dest_lng) },
            ...(form.departure_time ? { departure_time: form.departure_time } : {}),
            preferences: { avoid_night_travel: form.avoid_night },
        }).then((r) => r.data),
        onSuccess: (res) => {
            setLatestResult(res.data);
            void refetchHistory();
        },
    });
    const field = (key, label, type = 'text') => (<div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder={type === 'number' ? '0.00000' : undefined}/>
    </div>);
    const canSubmit = form.origin_lat && form.origin_lng && form.dest_lat && form.dest_lng &&
        !isNaN(parseFloat(form.origin_lat)) && !isNaN(parseFloat(form.origin_lng)) &&
        !isNaN(parseFloat(form.dest_lat)) && !isNaN(parseFloat(form.dest_lng));
    return (<div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-orange-400"/>
        <h1 className="text-xl font-bold text-white">Route Safety Analysis</h1>
      </div>

      {/* Analysis form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-1.5">
          <Navigation className="w-4 h-4 text-gray-400"/> New Analysis
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {field('origin_lat', 'Origin lat')}
          {field('origin_lng', 'Origin lng')}
          {field('dest_lat', 'Destination lat')}
          {field('dest_lng', 'Destination lng')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {field('departure_time', 'Departure time (optional)', 'datetime-local')}
          <div className="flex items-center gap-2 pt-5">
            <input id="avoid-night" type="checkbox" checked={form.avoid_night} onChange={(e) => setForm((f) => ({ ...f, avoid_night: e.target.checked }))} className="accent-orange-500"/>
            <label htmlFor="avoid-night" className="text-sm text-gray-300">Avoid night travel</label>
          </div>
        </div>

        {analyse.isError && (<div className="flex items-center gap-2 text-red-400 text-sm mb-3">
            <AlertTriangle className="w-4 h-4"/>
            <span>{analyse.error.message}</span>
          </div>)}

        <button type="button" disabled={!canSubmit || analyse.isPending} onClick={() => analyse.mutate()} className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {analyse.isPending && <Loader2 className="w-4 h-4 animate-spin"/>}
          {analyse.isPending ? 'Analysing…' : 'Analyse Route'}
        </button>
      </div>

      {/* Latest result */}
      {latestResult && (<div>
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Latest result</h2>
          <AnalysisCard analysis={latestResult}/>
        </div>)}

      {/* History */}
      {(history?.data.length ?? 0) > 0 && (<div>
          <h2 className="text-sm font-semibold text-gray-400 mb-2">
            Analysis history ({history?.total ?? 0})
          </h2>
          <div className="space-y-3">
            {history?.data
                .filter((a) => a.id !== latestResult?.id)
                .map((a) => <AnalysisCard key={a.id} analysis={a}/>)}
          </div>
        </div>)}

      {!latestResult && !history?.data.length && (<div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-40"/>
          <p className="text-sm">No analyses yet. Enter a route above to get an AI-powered safety score.</p>
        </div>)}
    </div>);
}
