import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, AUTH_TOKEN, commonHeaders } from './config.js';

export const options = { vus: 10, duration: '1m' };

const auth = { ...commonHeaders, Authorization: `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' };

const endpoints = [
  { method: 'GET', url: '/auth/me', expect: [200, 401] },
  { method: 'GET', url: '/vehicles?limit=5', expect: [200, 401] },
  { method: 'GET', url: '/drivers?limit=5', expect: [200, 401] },
  { method: 'GET', url: '/alerts?limit=5', expect: [200, 401] },
  { method: 'GET', url: '/convoys?limit=5', expect: [200, 401] },
  { method: 'GET', url: '/gps/track', expect: [200, 401] },
  { method: 'GET', url: '/reports?limit=5', expect: [200, 401] },
];

export default function () {
  for (const ep of endpoints) {
    const res = http[ep.method.toLowerCase()](`${BASE_URL}${ep.url}`, { headers: auth });
    check(res, { [`${ep.method} ${ep.url}`]: (r) => ep.expect.includes(r.status) });
  }
}
