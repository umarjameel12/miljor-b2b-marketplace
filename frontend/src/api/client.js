import axios from 'axios';

// MilJor Base API Client (Phase 6C: In-Memory Access Token & Silent Refresh Interceptor)
let inMemoryAccessToken = null;

export const setAccessToken = (token) => {
  inMemoryAccessToken = token;
};

export const getAccessToken = () => inMemoryAccessToken;

const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  withCredentials: true, // Always include cookies for session persistence
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach in-memory access token strictly
apiClient.interceptors.request.use(
  (config) => {
    if (inMemoryAccessToken) {
      config.headers.Authorization = `Bearer ${inMemoryAccessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Concurrency refresh queue state
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor: automatically refresh on 401 and retry once
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (!error.response || error.response.status !== 401) {
      return Promise.reject(error);
    }

    // Do not attempt refresh on auth/recovery endpoints themselves
    const url = originalRequest.url || '';
    if (
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/logout') ||
      url.includes('/auth/register') ||
      url.includes('/auth/request-password-reset') ||
      url.includes('/auth/reset-password') ||
      url.includes('/auth/verify-email') ||
      url.includes('/auth/resend-otp')
    ) {
      return Promise.reject(error);
    }

    if (originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        })
        .catch((err) => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Call refresh endpoint with HttpOnly cookie
      const refreshRes = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });

      if (refreshRes.data?.success && refreshRes.data?.data?.token) {
        const newToken = refreshRes.data.data.token;
        setAccessToken(newToken);

        // Clean up legacy localStorage storage
        localStorage.removeItem('miljor_token');

        processQueue(null, newToken);

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } else {
        throw new Error('Refresh response invalid');
      }
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      setAccessToken(null);
      localStorage.removeItem('miljor_token');
      localStorage.removeItem('miljor_user');
      window.dispatchEvent(new Event('miljor:auth-expired'));
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

export default apiClient;
