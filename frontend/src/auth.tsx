import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setToken, getToken, ApiError } from './api';

interface User { id: string; email: string; name: string; }
interface AuthCtx {
  user: User | null;
  loading: boolean;
  serverError: string;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { user } = await api.get('/auth/me');
          setUser(user);
        } catch (e) {
          // Only a real "not logged in" answer clears the token. A down/slow server must not log you out.
          if (e instanceof ApiError && e.status === 401) setToken(null);
          else setServerError(e instanceof Error ? e.message : 'Cannot reach the server');
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user } = await api.post('/auth/login', { email, password });
    setToken(token);
    setUser(user);
  };
  const register = async (email: string, password: string, name?: string) => {
    const body: any = { email, password };
    if (name) body.name = name;
    const { token, user } = await api.post('/auth/register', body);
    setToken(token);
    setUser(user);
  };
  const logout = () => { setToken(null); setUser(null); };

  return <Ctx.Provider value={{ user, loading, serverError, login, register, logout }}>{children}</Ctx.Provider>;
}
