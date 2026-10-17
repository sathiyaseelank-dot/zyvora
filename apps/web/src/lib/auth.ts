import { request, resetCsrfToken } from './api';

/**
 * The only two roles the API will issue (`isRoleName` in apps/api/src/auth/jwt.ts
 * rejects anything else, so a token cannot smuggle in a third).
 *
 * Declared here rather than imported because @zyvora/types does not model
 * identity yet. Worth promoting into the shared package when the first
 * authenticated route needs it in more than one place.
 */
export type RoleName = 'customer' | 'admin';

/**
 * Authentication client (ZYV-116).
 *
 * The session itself is an HttpOnly cookie, so there is nothing for this
 * module to store: "am I signed in?" is answered by asking the API, and every
 * screen that needs to know re-reads `/api/auth/me`. That is deliberate — a
 * token in localStorage would be readable by any script on the page and would
 * survive the server-side revocation the API already implements.
 */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export async function login(
  input: LoginInput,
  signal?: AbortSignal,
): Promise<AuthUser> {
  const response = await request<{ data: { user: AuthUser } }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: input,
      signal,
    },
  );
  // Login rotates the CSRF cookie; the cached token is stale from here on.
  resetCsrfToken();
  return response.data.user;
}

export async function register(
  input: RegisterInput,
  signal?: AbortSignal,
): Promise<AuthUser> {
  const response = await request<{ data: { user: AuthUser } }>(
    '/api/auth/register',
    { method: 'POST', body: input, signal },
  );
  resetCsrfToken();
  return response.data.user;
}

export async function logout(): Promise<void> {
  try {
    await request<undefined>('/api/auth/logout', { method: 'POST' });
  } finally {
    // The cookie is cleared server-side, but the cached token must go even if
    // the call failed — otherwise the next screen reuses a dead CSRF value.
    resetCsrfToken();
  }
}

/**
 * The current user, or null when signed out.
 *
 * A 401 is the expected answer for an anonymous visitor, not a failure, so it
 * resolves to null rather than rejecting. Any other error propagates: a 500
 * must not be silently reported as "signed out", or a broken API would look
 * like a logged-in session everywhere.
 */
export async function fetchCurrentUser(
  signal?: AbortSignal,
): Promise<AuthUser | null> {
  try {
    const response = await request<{ data: { user: AuthUser } }>(
      '/api/auth/me',
      {
        signal,
      },
    );
    return response.data.user;
  } catch (err) {
    if (err instanceof Error && 'status' in err && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export interface ForgotPasswordResult {
  /**
   * Present only when the API is running with DEV_EXPOSE_RESET_TOKEN. The
   * field does not exist in production, so the screen checks for it rather
   * than assuming.
   */
  devResetToken?: string;
}

export async function requestPasswordReset(
  email: string,
  signal?: AbortSignal,
): Promise<ForgotPasswordResult> {
  const response = await request<{
    data: { message: string; devResetToken?: string };
  }>('/api/auth/forgot-password', {
    method: 'POST',
    body: { email },
    signal,
  });
  return { devResetToken: response.data.devResetToken };
}

export async function resetPassword(
  input: { token: string; password: string; confirmPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  await request<{ data: { message: string } }>('/api/auth/reset-password', {
    method: 'POST',
    body: input,
    signal,
  });
  resetCsrfToken();
}
