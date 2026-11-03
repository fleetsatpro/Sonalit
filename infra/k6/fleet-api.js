import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, AUTH_TOKEN, commonHeaders } from './config.js';

export const options = {
  vus: 300,
  duration: '15m',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.005'],
  },
};

const authHeaders = { ...commonHeaders, Authorization: `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' };

export default function () {
  const rnd = Math.random();
  if (rnd < 0.60) {
    const page = Math.ceil(Math.random() * 10);
    const res = http.get(`${BASE_URL}/vehicles?page=${page}&limit=20`, { headers: authHeaders });
    check(res, { 'vehicles 200': (r) => r.status === 200 });
  } else if (rnd < 0.90) {
    const res = http.get(`${BASE_URL}/drivers?page=1&limit=20`, { headers: authHeaders });
    check(res, { 'drivers 200': (r) => r.status === 200 });
  } else {
    const res = http.get(`${BASE_URL}/gps/track`, { headers: authHeaders });
    check(res, { 'gps 200': (r) => r.status === 200 });
  }
  sleep(0.05);
}
