import React, { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../api/auth';
import { setAccessToken } from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sync state and in-memory client
  const updateAuthCredentials = (newToken, newUser) => {
    setAccessToken(newToken);
    setTokenState(newToken);
    setUser(newUser);
  };

  // Hydrate user profile on initial mount via HttpOnly refresh cookie
  useEffect(() => {
    let isMounted = true;
    let authChannel = null;

    try {
      authChannel = new BroadcastChannel('miljor_auth_channel');
      authChannel.onmessage = (event) => {
        if (!isMounted) return;
        if (event.data?.type === 'LOGOUT') {
          updateAuthCredentials(null, null);
        } else if (event.data?.type === 'LOGIN' && event.data?.user) {
          setUser(event.data.user);
        }
      };
    } catch {
      // BroadcastChannel not available in all environments
    }

    const restoreSession = async () => {
      try {
        // Attempt silent session restoration using the HttpOnly cookie
        const res = await authApi.refreshToken();
        if (isMounted && res.success && res.data?.token) {
          updateAuthCredentials(res.data.token, res.data.user);
          localStorage.removeItem('miljor_token'); // Purge legacy token
          if (isMounted) setLoading(false);
          return;
        }
      } catch {
        // Refresh token not present or expired
      }

      // Gate 3: Legacy JWT Purge — Unconditionally clear vulnerable localStorage tokens
      localStorage.removeItem('miljor_token');
      localStorage.removeItem('miljor_user');
      if (isMounted) updateAuthCredentials(null, null);

      if (isMounted) setLoading(false);
    };

    restoreSession();

    // Listen to 401 unauthenticated event
    const handleAuthExpired = () => {
      updateAuthCredentials(null, null);
    };

    window.addEventListener('miljor:auth-expired', handleAuthExpired);
    return () => {
      isMounted = false;
      window.removeEventListener('miljor:auth-expired', handleAuthExpired);
      if (authChannel) {
        authChannel.close();
      }
    };
  }, []);

  // A reload performed while offline can fail the initial cookie refresh.
  // Restore the same HttpOnly session automatically when connectivity returns.
  // Do not persist access tokens or manufacture a logged-in identity.
  useEffect(() => {
    if (token) return undefined;
    let disposed = false;
    let inFlight = false;
    const restoreOnReconnect = async () => {
      if (inFlight || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      inFlight = true;
      try {
        const res = await authApi.refreshToken();
        if (!disposed && res.success && res.data?.token && res.data?.user) {
          updateAuthCredentials(res.data.token, res.data.user);
        }
      } catch {
        // Stay unauthenticated if the browser has no valid refresh cookie.
      } finally {
        inFlight = false;
      }
    };
    window.addEventListener('online', restoreOnReconnect);
    return () => {
      disposed = true;
      window.removeEventListener('online', restoreOnReconnect);
    };
  }, [token]);

  // Login handler with persistent session flag
  const login = async ({ identifier, password, rememberMe = false }) => {
    const response = await authApi.login({ identifier, password, rememberMe });
    if (response.success && response.data?.token) {
      const newToken = response.data.token;
      const newUser = response.data.user;

      updateAuthCredentials(newToken, newUser);
      localStorage.removeItem('miljor_token'); // Ensure not in localStorage

      try {
        const authChannel = new BroadcastChannel('miljor_auth_channel');
        authChannel.postMessage({ type: 'LOGIN', user: newUser });
        authChannel.close();
      } catch {
        // Ignore channel errors
      }

      return { success: true, user: newUser };
    }
    throw new Error(response.error?.message || 'Login failed');
  };

  // Register handler
  const register = async (formData) => {
    const response = await authApi.register(formData);
    if (response.success) {
      if (response.data?.token) {
        const newToken = response.data.token;
        const newUser = response.data.user;
        updateAuthCredentials(newToken, newUser);
      }
      return response;
    }
    throw new Error(response.error?.message || 'Registration failed');
  };

  // Verify Email OTP handler
  const verifyEmail = async ({ email, otp }) => {
    const response = await authApi.verifyEmail({ email, otp });
    if (response.success && response.data?.token) {
      const newToken = response.data.token;
      const newUser = response.data.user;
      updateAuthCredentials(newToken, newUser);
      return { success: true, user: newUser };
    }
    throw new Error(response.error?.message || 'Verification failed');
  };

  // Resend OTP handler
  const resendOtp = async ({ email }) => {
    return await authApi.resendOtp({ email });
  };

  // Update user base cluster
  const updateBaseCluster = async (baseClusterId) => {
    const response = await authApi.updateBaseCluster(baseClusterId);
    if (response.success && response.data?.user) {
      setUser(response.data.user);
      return response.data.user;
    }
    throw new Error(response.error?.message || 'Failed to update base cluster');
  };

  // Logout handler
  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore network errors
    } finally {
      updateAuthCredentials(null, null);
      try {
        const authChannel = new BroadcastChannel('miljor_auth_channel');
        authChannel.postMessage({ type: 'LOGOUT' });
        authChannel.close();
      } catch {
        // Ignore channel errors
      }
    }
  };

  const value = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    role: user?.role || null,
    isVerified: Boolean(user?.is_verified),
    loading,
    login,
    register,
    verifyEmail,
    resendOtp,
    updateBaseCluster,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
