import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
// Render Free cold starts can outlast the default 10s request timeout.
// Only staging Preview opts in; invalid values retain the safe 10s default.
const API_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000 && configuredTimeout <= 120000
  ? configuredTimeout
  : 10000;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: API_TIMEOUT_MS,
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('acm_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('acm_token');
      localStorage.removeItem('acm_user');
      // If not already on login page, redirect
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
