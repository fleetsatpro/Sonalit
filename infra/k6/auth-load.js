import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, AUTH_TOKEN, commonHeaders } from './config.js';

export const options = {
  stages: [
    { duration: '2m', target: 500 },
    { duration: '5m', target: 1000 },
    { duration: '10m', target: 1000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(99)<500'],
    http_req_failed: ['rate<0.005'],
  },
};

export default function () {
  const rnd = Math.random();
  if (rnd < 0.70) {
    const res = http.post(`${BASE_URL}/auth/refresh`, null, {
      headers: { ...commonHeaders, Cookie: `refresh_token=test_refresh` },
    });
    check(res, { 'refresh 200|401': (r) => r.status === 200 || r.status === 401 });
  } else if (rnd < 0.90) {
    const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email: 'load@sonalit.io', password: 'LoadTest1234!' }), {
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
    });
    check(res, { 'login <=401': (r) => r.status <= 401 });
  } else {
    const res = http.get(`${BASE_URL}/auth/me`, { headers: { ...commonHeaders, Authorization: `Bearer ${AUTH_TOKEN}` } });
    check(res, { 'me 200|401': (r) => r.status === 200 || r.status === 401 });
  }
  sleep(0.1);
}
