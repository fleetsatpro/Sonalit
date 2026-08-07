import axios from 'axios';
import { getAccessToken } from '../../stores/auth.js';
import { getCsrfToken } from '../../lib/csrf.js';

const cdsApi = axios.create({
  baseURL: '/api/v1/cds',
});

cdsApi.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const method = (config.method ?? 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

export default cdsApi;
