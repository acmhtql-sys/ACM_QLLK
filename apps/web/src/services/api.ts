import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
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
      // If not already on login page, record expired notice and redirect
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        const msg =
          error.response?.data?.message ||
          'Phiên làm việc của bạn đã hết hạn hoặc tài khoản bị khóa/thay đổi quyền. Vui lòng đăng nhập lại.';
        sessionStorage.setItem('acm_session_expired', msg);
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
