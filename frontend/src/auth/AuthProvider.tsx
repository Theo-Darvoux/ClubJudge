import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTH_EXPIRED_EVENT, api } from '../api';
import type { User } from '../api';
import { AuthContext } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login(email, password));
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      setUser(await api.register(email, password, displayName));
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
