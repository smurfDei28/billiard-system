import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { API_URL } from '../constants';

export const api = axios.create({ baseURL: API_URL });

// Shared by Axios and the one native-fetch multipart request. Keeping token
// retrieval here avoids a second storage/auth implementation in screens.
export const getAccessToken = () => SecureStore.getItemAsync('accessToken');

let authFailureHandler: null | (() => Promise<void>) = null;

const clearStoredAuth = async () => {
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
  await SecureStore.deleteItemAsync('userRole');
};

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 429) {
      if (__DEV__) {
        console.warn('[API] Request rate limited', {
          method: original?.method?.toUpperCase(),
          route: original?.url,
          retryAfter: error.response?.headers?.['retry-after'],
        });
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
        await SecureStore.setItemAsync('accessToken', data.accessToken);
        await SecureStore.setItemAsync('refreshToken', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        await clearStoredAuth();
        if (authFailureHandler) await authFailureHandler();
      }
    }

    return Promise.reject(error);
  }
);

interface User {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'STAFF' | 'MEMBER';
  membership?: any;
  gamifiedProfile?: any;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<any>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  email: string;
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  displayName?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authFailureHandler = async () => setUser(null);
    loadStoredAuth();
    return () => {
      authFailureHandler = null;
    };
  }, []);

  const loadStoredAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync('accessToken');
      if (token) {
        const { data } = await api.get('/api/auth/me');
        await SecureStore.setItemAsync('userRole', data.role);
        setUser(data);
      }
    } catch (error: any) {
      if ([401, 403].includes(error.response?.status)) {
        await clearStoredAuth();
        setUser(null);
      } else if (__DEV__) {
        console.warn('[Auth] Could not restore the stored session', { status: error.response?.status });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    await SecureStore.setItemAsync('accessToken', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    await SecureStore.setItemAsync('userRole', data.user.role);
    setUser(data.user);
  };

  const register = async (registerData: RegisterData) => {
    const { data } = await api.post('/api/auth/register', registerData);
    if (data.accessToken && data.refreshToken && data.user) {
      await SecureStore.setItemAsync('accessToken', data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);
      await SecureStore.setItemAsync('userRole', data.user.role);
      setUser(data.user);
    }
    return data;
  };

  const logout = async () => {
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    try { await api.post('/api/auth/logout', { refreshToken }); } catch {}
    await clearStoredAuth();
    setUser(null);
  };

  const refreshUser = async () => {
    const { data } = await api.get('/api/auth/me');
    await SecureStore.setItemAsync('userRole', data.role);
    setUser(data);
  };

  return (
    <AuthContext.Provider value={{
      user, isLoading,
      isAuthenticated: !!user,
      login, register, logout, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
