import type { LoginInput, PublicUser, SignupInput } from "@connect-create/shared";

export class ApiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new ApiRequestError(res.status, message);
  }
  return body as T;
}

export function signup(input: SignupInput): Promise<{ user: PublicUser }> {
  return request("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: LoginInput): Promise<{ user: PublicUser }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: boolean }> {
  return request("/auth/logout", { method: "POST" });
}

export function getMe(): Promise<{ user: PublicUser; progress: number }> {
  return request("/me");
}
