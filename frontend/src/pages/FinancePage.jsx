import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { DollarSign, TrendingUp, TrendingDown, FileText, Plus, X, Download, Filter, RefreshCw, CreditCard, Fuel, Wrench, ChevronRight, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { formatDate } from '../utils/helpers';
import { Spinner } from '../components/UI';

const CHART = { content:{background:'#0D1321',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,fontSize:11,color:'#e2e8f0',padding:'8px 12px'},cursor:{fill:'rgba(240,180,41,0.03)'} };

const STATUS_COLORS = { draft:'text-slate-400', sent:'text-blue-400', paid:'text-success', overdue:'text-danger', cancelled:'text-slate-600' };
const STATUS_BG = { draft:'bg-slate-500/10 border-slate-500/20', sent:'bg-blue-500/10 border-blue-500/20', paid:'bg-success/10 border-success/20', overdue:'bg-danger/10 border-danger/20', cancelled:'bg-slate-600/10 border-slate-600/20' };

const EXPENSE_COLORS = { fuel:'#F97316', maintenance:'#F59E0B', toll:'#3B82F6', driver_allowance:'#8B5CF6', other:'#64748b' };

export default function FinancePage() {
  const [tab, setTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [profitability, setProfitability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [form, setForm] = useState({ customer_name:'', line_items:[{description:'Transport service',quantity:1,unit_price:0}] });
  const [expenseForm, setExpenseForm] = useState({ category:'fuel', amount:'', description:'', currency:'USD' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, inv, exp, prof] = await Promise.allSettled([
        api.get('/finance/dashboard'),
        api.get('/finance/invoices', { params: { limit:50, ...(statusFilter ? {status:statusFilter} : {}) } }),
        api.get('/finance/expenses', { params: { limit:50 } }),
        api.get('/finance/profitability'),
      ]);
      if (dash.status==='fulfilled') setDashboard(dash.value.data.data);
      if (inv.status==='fulfilled') setInvoices(inv.value.data.data||[]);
      if (exp.status==='fulfilled') setExpenses(exp.value.data.data||[]);
      if (prof.status==='fulfilled') setProfitability(prof.value.data.data||[]);
    } catch {} finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const expensePieData = expenses.reduce((acc, e) => {
    const key = e.category;
    const existing = acc.find(a => a.name === key);
    if (existing) existing.value += parseFloat(e.amount);
    else acc.push({ name: key, value: parseFloat(e.amount) });
    return acc;
  }, []);

  const submitInvoice = async () => {
    if (!form.customer_name) { toast.error('Customer name required'); return; }
    setSubmitting(true);
    try {
      await api.post('/finance/invoices', form);
      toast.success('Invoice created');
      setShowInvoiceForm(false);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const submitExpense = async () => {
    if (!expenseForm.amount) { toast.error('Amount required'); return; }
    setSubmitting(true);
    try {
      await api.post('/finance/expenses', expenseForm);
      toast.success('Expense recorded');
      setShowExpenseForm(false);
      setExpenseForm({ category:'fuel', amount:'', description:'', currency:'USD' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const fmtUSD = (v) => v != null ? `$${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}` : '$0';

  return (
    <div className="space-y-5 max-w-[1800px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">FINANCIAL OPERATIONS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">Revenue, expenses, invoicing & profitability</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowExpenseForm(f=>!f)} className="flex items-center gap-2 px-4 py-2.5 bg-navy-900 border border-white/10 text-slate-300 rounded-xl text-sm font-mono hover:border-white/20 transition-colors">
            <Plus size={13}/>Record Expense
          </button>
          <button onClick={() => setShowInvoiceForm(f=>!f)} className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
            <FileText size={13}/>New Invoice
          </button>
        </div>
      </div>

      {/* KPI strip */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {[
            ['Revenue Collected', fmtUSD(dashboard.invoices?.revenue_collected), 'text-success', DollarSign],
            ['Revenue Pending', fmtUSD(dashboard.invoices?.revenue_pending), 'text-amber-400', TrendingUp],
            ['Overdue', fmtUSD(dashboard.invoices?.revenue_overdue), 'text-danger', AlertTriangle],
            ['Fuel Costs (30d)', fmtUSD(dashboard.expenses?.fuel_costs), 'text-orange-400', Fuel],
            ['Maint. Costs (30d)', fmtUSD(dashboard.expenses?.maintenance_costs), 'text-yellow-400', Wrench],
            ['Total Expenses (30d)', fmtUSD(dashboard.expenses?.total_expenses), 'text-slate-400', CreditCard],
          ].map(([label, val, color, Icon]) => (
            <div key={label} className="bg-navy-900 border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className={color} />
                <p className="text-[9px] font-mono text-slate-500 tracking-wider">{label.toUpperCase()}</p>
              </div>
              <p className={`font-display text-xl font-bold ${color}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-navy-900 border border-white/5 rounded-xl p-1">
        {[['dashboard','Overview'],['invoices','Invoices'],['expenses','Expenses'],['profitability','Profitability']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-2 text-xs font-mono font-bold rounded-lg transition-colors ${tab===k ? 'bg-gold/10 text-gold border border-gold/20' : 'text-slate-500 hover:text-slate-300'}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Invoice form */}
      {showInvoiceForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">CREATE INVOICE</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Customer Name *</label>
              <input value={form.customer_name} onChange={e=>setForm(f=>({...f,customer_name:e.target.value}))} placeholder="Client name"
                className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Due Date</label>
              <input type="date" onChange={e=>setForm(f=>({...f,due_date:e.target.value}))}
                className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Line Items</p>
            {form.line_items.map((item, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <input value={item.description} onChange={e=>{const items=[...form.line_items];items[i]={...items[i],description:e.target.value};setForm(f=>({...f,line_items:items}));}} placeholder="Description"
                  className="col-span-1 bg-navy-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none" />
                <input type="number" value={item.quantity} onChange={e=>{const items=[...form.line_items];items[i]={...items[i],quantity:+e.target.value};setForm(f=>({...f,line_items:items}));}} placeholder="Qty"
                  className="bg-navy-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none" />
                <input type="number" value={item.unit_price} onChange={e=>{const items=[...form.line_items];items[i]={...items[i],unit_price:+e.target.value};setForm(f=>({...f,line_items:items}));}} placeholder="Unit price"
                  className="bg-navy-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none" />
              </div>
            ))}
            <button onClick={()=>setForm(f=>({...f,line_items:[...f.line_items,{description:'',quantity:1,unit_price:0}]}))} className="text-xs text-gold hover:underline">+ Add item</button>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={()=>setShowInvoiceForm(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
            <button onClick={submitInvoice} disabled={submitting} className="px-5 py-2 bg-gold text-navy-950 rounded-lg text-sm font-bold disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Invoice'}
            </button>
          </div>
        </div>
      )}

      {/* Expense form */}
      {showExpenseForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">RECORD EXPENSE</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">CATEGORY</label>
              <select value={expenseForm.category} onChange={e=>setExpenseForm(f=>({...f,category:e.target.value}))} className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {['fuel','maintenance','toll','permit','driver_allowance','other'].map(c => <option key={c} value={c}>{c.replace('_',' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">AMOUNT *</label>
              <input type="number" value={expenseForm.amount} onChange={e=>setExpenseForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"
                className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">DESCRIPTION</label>
              <input value={expenseForm.description} onChange={e=>setExpenseForm(f=>({...f,description:e.target.value}))} placeholder="Details"
                className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
            <div className="flex items-end">
              <button onClick={submitExpense} disabled={submitting} className="w-full py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold disabled:opacity-50">
                {submitting ? 'SAVING…' : 'RECORD'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-20"><Spinner/></div> : (
        <>
          {/* Dashboard tab */}
          {tab === 'dashboard' && dashboard && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              <div className="xl:col-span-2 space-y-5">
                {/* Expense breakdown chart */}
                <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
                  <p className="text-sm font-semibold text-slate-200 mb-1">Expense Breakdown</p>
                  <p className="text-[10px] font-mono text-slate-500 mb-4">Last 30 days by category</p>
                  {expensePieData.length > 0 ? (
                    <div className="flex items-center gap-6">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie data={expensePieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                            {expensePieData.map((e,i) => <Cell key={i} fill={EXPENSE_COLORS[e.name] || '#64748b'} />)}
                          </Pie>
                          <Tooltip contentStyle={CHART.content} formatter={v=>[fmtUSD(v),'Amount']} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-2">
                        {expensePieData.map(e => (
                          <div key={e.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{background:EXPENSE_COLORS[e.name]||'#64748b'}} />
                              <span className="text-xs text-slate-400 capitalize">{e.name.replace('_',' ')}</span>
                            </div>
                            <span className="text-xs font-mono font-bold text-slate-300">{fmtUSD(e.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <p className="text-center py-8 text-slate-600 text-sm">No expense data</p>}
                </div>

                {/* Profitability by vehicle */}
                <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
                  <p className="text-sm font-semibold text-slate-200 mb-1">Vehicle Profitability</p>
                  <p className="text-[10px] font-mono text-slate-500 mb-4">Revenue vs Cost per vehicle</p>
                  {profitability.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={profitability.slice(0,8)} margin={{top:5,right:5,bottom:5,left:-20}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="registration" tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={CHART.content} cursor={CHART.cursor} formatter={v=>[fmtUSD(v)]} />
                        <Bar dataKey="total_revenue" name="Revenue" fill="#22D3A0" radius={[2,2,0,0]} />
                        <Bar dataKey="total_cost" name="Cost" fill="#F25252" radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center py-8 text-slate-600 text-sm">No profitability data yet</p>}
                </div>
              </div>

              {/* Recent invoices */}
              <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06]">
                  <p className="text-sm font-semibold text-slate-200">Recent Invoices</p>
                  <p className="text-[10px] font-mono text-slate-500">{dashboard.invoices?.total_invoices || 0} total</p>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {invoices.slice(0,8).map(inv => (
                    <div key={inv.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-mono font-bold text-slate-200">{inv.invoice_number}</p>
                        <p className="text-[10px] text-slate-500">{inv.customer_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-200">{fmtUSD(inv.total)}</p>
                        <span className={`text-[9px] font-mono font-bold ${STATUS_COLORS[inv.status]}`}>{inv.status?.toUpperCase()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Invoices tab */}
          {tab === 'invoices' && (
            <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-3">
                <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="bg-navy-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none">
                  <option value="">All statuses</option>
                  {['draft','sent','paid','overdue','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {invoices.map(inv => (
                  <div key={inv.id} className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.01]">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-sm font-bold text-slate-200">{inv.invoice_number}</p>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${STATUS_BG[inv.status]} ${STATUS_COLORS[inv.status]}`}>{inv.status?.toUpperCase()}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{inv.customer_name} · {formatDate(inv.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-200">{fmtUSD(inv.total)}</p>
                      {inv.due_date && <p className="text-[10px] text-slate-500">Due {formatDate(inv.due_date)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expenses tab */}
          {tab === 'expenses' && (
            <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                {expenses.map(e => (
                  <div key={e.id} className="px-5 py-3 flex items-center gap-4">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:EXPENSE_COLORS[e.category]||'#64748b'}} />
                    <div className="flex-1">
                      <p className="text-sm text-slate-200">{e.description || e.category.replace('_',' ')}</p>
                      <p className="text-[10px] font-mono text-slate-500">{e.category.replace('_',' ').toUpperCase()} · {e.registration || '—'} · {formatDate(e.expense_date)}</p>
                    </div>
                    <p className="font-mono font-bold text-slate-200">{fmtUSD(e.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Profitability tab */}
          {tab === 'profitability' && (
            <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                <div className="px-5 py-3 grid grid-cols-6 text-[9px] font-mono text-slate-500 uppercase tracking-wider">
                  <span>Vehicle</span><span>Region</span><span>Trips</span><span>Revenue</span><span>Costs</span><span>Profit</span>
                </div>
                {profitability.map(v => {
                  const profit = parseFloat(v.profit || 0);
                  return (
                    <div key={v.registration} className="px-5 py-3 grid grid-cols-6 text-sm hover:bg-white/[0.01]">
                      <span className="font-mono font-bold text-slate-200">{v.registration}</span>
                      <span className="text-slate-400">{v.region}</span>
                      <span className="text-slate-400">{v.trips || 0}</span>
                      <span className="text-success">{fmtUSD(v.total_revenue)}</span>
                      <span className="text-danger">{fmtUSD((parseFloat(v.total_cost||0) + parseFloat(v.total_expenses||0)))}</span>
                      <span className={`font-bold ${profit >= 0 ? 'text-success' : 'text-danger'}`}>{fmtUSD(profit)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
