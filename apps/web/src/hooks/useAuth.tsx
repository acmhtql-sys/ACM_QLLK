import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT';
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  login: (newToken: string, newUser: UserProfile) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  let queryClient: ReturnType<typeof useQueryClient> | null = null;
  try {
    queryClient = useQueryClient();
  } catch {
    queryClient = null;
  }

  const [token, setToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem('acm_token');
    // Revoke sessions created by the retired offline Phase 1 mock login flow.
    if (storedToken === 'mock-jwt-token-foundation-phase1') {
      localStorage.removeItem('acm_token');
      localStorage.removeItem('acm_user');
      return null;
    }
    return storedToken;
  });
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('acm_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (newToken: string, newUser: UserProfile) => {
    // Cancel any in-flight background requests to prevent late responses from populating cache
    queryClient?.cancelQueries();
    queryClient?.clear();
    localStorage.setItem('acm_token', newToken);
    localStorage.setItem('acm_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    // Cancel in-flight queries immediately on logout
    queryClient?.cancelQueries();
    queryClient?.clear();
    localStorage.removeItem('acm_token');
    localStorage.removeItem('acm_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
