import { context, propagation, trace } from '@opentelemetry/api';
import axios from 'axios';
import { useAuthStore, getAccessToken, setAccessToken } from '../stores/auth.js';
import { getCsrfToken } from './csrf.js';
import { reportRequestOutcome } from './offline/connectivity.js';
import type { AuthUser } from '../stores/auth.js';
const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
export const api = axios.create({ baseURL: API_BASE, timeout: 15_000, withCredentials: true });
api.interceptors.request.use((config) => {
  if (config.url === '/communications/recipients' && config.data && typeof config.data === 'object' && !Array.isArray(config.data)) {
    const { phone: _unsupportedPhone, ...recipientPayload } = config.data as Record<string, unknown>; config.data = recipientPayload;
  }
  const token = getAccessToken(); if (token) config.headers['Authorization'] = `Bearer ${token}`;
  const method = (config.method ?? 'get').toLowerCase(); if (!['get','head','options'].includes(method)) { const csrf=getCsrfToken(); if (csrf) config.headers['X-CSRF-Token']=csrf; }
  const span = trace.getActiveSpan(); if (span) { const carrier:Record<string,string>={}; propagation.inject(context.active(),carrier); for(const[key,value]of Object.entries(carrier))config.headers[key]=value; }
  return config;
});
let refreshPromise:Promise<string>|null=null;
async function refreshAccessToken():Promise<string>{const csrf=getCsrfToken();const{data}=await axios.post<{token:string;user:AuthUser}>(`${API_BASE}/auth/refresh`,{},{withCredentials:true,headers:csrf?{'X-CSRF-Token':csrf}:{}});setAccessToken(data.token);useAuthStore.getState().setAuth(data.token,data.user);return data.token;}
export function attachRefreshInterceptor(instance:typeof api,{redirectOnFailure=true}:{redirectOnFailure?:boolean}={}):void{instance.interceptors.response.use((res)=>res,async(err)=>{const original=err.config as typeof err.config&{_retry?:boolean};if(err.response?.status===401&&original&&!original._retry){original._retry=true;try{if(!refreshPromise)refreshPromise=refreshAccessToken().finally(()=>{refreshPromise=null});const token=await refreshPromise;original.headers['Authorization']=`Bearer ${token}`;return instance(original)}catch{if(redirectOnFailure){useAuthStore.getState().clearAuth();window.location.href='/login'}throw err}}throw err})}
export function attachConnectivityReporter(instance:typeof api):void{instance.interceptors.request.use((config)=>{(config as typeof config&{_startedAt?:number})._startedAt=Date.now();return config});instance.interceptors.response.use((res)=>{const started=(res.config as typeof res.config&{_startedAt?:number})._startedAt;reportRequestOutcome(true,started?Date.now()-started:undefined);return res},(err)=>{const status=err?.response?.status as number|undefined;const started=(err?.config as{_startedAt?:number}|undefined)?._startedAt;reportRequestOutcome(status!=null&&status<500,status!=null&&started?Date.now()-started:undefined);throw err})}
const validMapPoint=(p:unknown)=>{if(!p||typeof p!=='object')return false;const x=p as{lat?:unknown;lng?:unknown};const lat=Number(x.lat),lng=Number(x.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(Math.abs(lat)<0.000001&&Math.abs(lng)<0.000001)};
api.interceptors.response.use((res)=>{const url=String(res.config.url??'');if(url==='/dashboard/map'||url.endsWith('/dashboard/map')||url.includes('/dashboard/map?')){const body=res.data;if(body&&typeof body==='object'){if(Array.isArray(body.vehicles))body.vehicles=body.vehicles.filter((v:unknown)=>validMapPoint(v)&&String((v as{status?:string}).status??'').toLowerCase()!=='offline');if(Array.isArray(body.convoys))body.convoys=body.convoys.filter((c:unknown)=>validMapPoint(c));}}return res;});
export const rulesAPI = {
  list:       () => api.get('/rules'),
  stats:      () => api.get('/rules/stats'),
  get:        (id:string) => api.get(`/rules/${id}`),
  create:     (data:unknown) => api.post('/rules', data),
  update:     (id:string, data:unknown) => api.patch(`/rules/${id}`, data),
  toggle:     (id:string, enabled:boolean) => api.patch(`/rules/${id}`, { enabled, status: enabled ? 'active' : 'paused' }),
  remove:     (id:string) => api.delete(`/rules/${id}`),
  executions: (id:string, limit=50) => api.get(`/rules/${id}/executions`, { params: { limit } }),
  test:       (id:string, data:unknown) => api.post(`/rules/${id}/test`, data),
};
attachRefreshInterceptor(api);
attachConnectivityReporter(api);
