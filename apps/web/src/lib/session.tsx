import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
} from './auth';

/**
 * Session state (ZYV-116).
 *
 * Holds nothing secret — the session is an HttpOnly cookie the browser sends
 * on its own. What lives here is only what the UI needs to render: who is
 * signed in, and whether that is still being determined.
 *
 * `status` is explicit because "not known yet" and "known to be signed out"
 * are different states. Collapsing them into a nullable user makes the header
 * flash a signed-out menu on every refresh, and makes a protected route bounce
 * a signed-in user to /login before the session resolves.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  user: AuthUser | null;
  status: SessionStatus;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const refresh = useCallback(async () => {
    try {
      const current = await fetchCurrentUser();
      setUser(current);
      setStatus(current ? 'authenticated' : 'anonymous');
    } catch {
      // The API being unreachable is not evidence of being signed out, but it
      // is certainly not evidence of being signed in. Anonymous is the safe
      // rendering — protected routes stay closed.
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const next = await loginRequest(input);
    setUser(next);
    setStatus('authenticated');
    return next;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const next = await registerRequest(input);
    setUser(next);
    setStatus('authenticated');
    return next;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Clear locally even if the request failed: the cookie is the server's
      // to drop, but leaving a stale user rendered is worse than the inverse.
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout, refresh }),
    [user, status, login, register, logout, refresh],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside a <SessionProvider>');
  }
  return ctx;
}
