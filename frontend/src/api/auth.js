import apiClient, { setAccessToken, refreshSession } from './client';

export const authApi = {
  // Login with identifier, password, and persistent session flag
  login: async ({ identifier, password, rememberMe = false }) => {
    const res = await apiClient.post('/auth/login', { identifier, password, rememberMe });
    return res.data;
  },

  // Public registration (Buyer or Supplier)
  register: async (payload) => {
    const res = await apiClient.post('/auth/register', payload);
    return res.data;
  },

  // Silent session refresh via HttpOnly cookie
  refreshToken: async () => {
    return refreshSession();
  },

  // Hydrate authenticated user session profile
  getMe: async () => {
    const res = await apiClient.get('/auth/me');
    return res.data;
  },

  // Graceful session logout with server-side revocation
  logout: async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network failures on logout
    } finally {
      setAccessToken(null);
      localStorage.removeItem('miljor_token');
      localStorage.removeItem('miljor_user');
    }
  },

  // Verify email with OTP
  verifyEmail: async ({ email, otp }) => {
    const res = await apiClient.post('/auth/verify-email', { email, otp });
    return res.data;
  },

  // Resend OTP
  resendOtp: async ({ email }) => {
    const res = await apiClient.post('/auth/resend-otp', { email });
    return res.data;
  },

  // Google OIDC Authentication
  googleAuth: async (credential) => {
    const res = await apiClient.post('/auth/google', { credential });
    return res.data;
  },

  // Request password reset verification code
  requestPasswordReset: async ({ email }) => {
    const res = await apiClient.post('/auth/request-password-reset', { email });
    return res.data;
  },

  // Reset password with verified OTP
  resetPassword: async ({ email, otp, new_password }) => {
    const res = await apiClient.post('/auth/reset-password', { email, otp, new_password });
    return res.data;
  },

  // Update Buyer / User Discovery Base Cluster
  updateBaseCluster: async (baseClusterId) => {
    const res = await apiClient.patch('/auth/base-cluster', { base_cluster_id: Number(baseClusterId) });
    return res.data;
  },

  // Apply for supplier verification
  applySupplier: async (data) => {
    const res = await apiClient.post('/auth/supplier/apply', data);
    return res.data;
  },
};
