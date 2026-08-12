export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly suggestions?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `Request failed (${response.status})`;
    const rawSuggestions = payload && typeof payload === 'object' && Array.isArray((payload as { suggestions?: unknown }).suggestions)
      ? (payload as { suggestions: unknown[] }).suggestions
      : undefined;
    const suggestions = rawSuggestions?.filter((item): item is string => typeof item === 'string');
    throw new ApiError(response.status, message, suggestions);
  }
  return payload as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
