import axios from 'axios';
import { getAccessToken } from '../../stores/auth.js';

const cdsApi = axios.create({
  baseURL: '/api/v1/cds',
});

cdsApi.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default cdsApi;
