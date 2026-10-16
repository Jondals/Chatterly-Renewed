/**
 * src/app/core/services/api.service.ts
 * HTTP client of the API: adds the access token, renews the session when it expires and turns failures
 * into ApiError objects.
 */
import { Injectable } from '@angular/core';
import { API_BASE } from '../config';

/** A failed API call: the HTTP status, the error code sent by the server and the whole answer. */
export class ApiError extends Error {
  /** Creates the error from the status and the answer of the server. */
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Thin fetch wrapper. The auth layer plugs in `tokenProvider` (it returns a fresh access token), so this
 * class never depends on AuthService and the two avoid a circular injection.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  tokenProvider: ((forceRefresh: boolean) => Promise<string | null>) | null = null;
  onSessionExpired: (() => void) | null = null;

  /** GET request. */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** POST request with a JSON body. */
  post<T>(path: string, body?: unknown, auth = true): Promise<T> {
    return this.request<T>('POST', path, body, auth);
  }

  /** PATCH request with a JSON body. */
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** PUT request with a JSON body. `keepalive`: the request goes on even if the page is closed meanwhile. */
  put<T>(path: string, body: unknown, keepalive = false): Promise<T> {
    return this.request<T>('PUT', path, body, true, 'application/json', keepalive);
  }

  /** DELETE request. */
  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Uploads bytes that are already encrypted. */
  upload<T>(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<T> {
    return this.request<T>('POST', path, bytes, true, 'application/octet-stream');
  }

  /** Downloads a binary answer (an encrypted file). */
  async download(path: string): Promise<ArrayBuffer> {
    const response = await this.send('GET', path, undefined, true);
    return response.arrayBuffer();
  }

  /** Sends a request and reads the JSON answer (nothing for "204 No Content"). */
  private async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    auth = true,
    contentType = 'application/json',
    keepalive = false,
  ): Promise<T> {
    const response = await this.send(method, path, body, auth, contentType, keepalive);
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  /** Makes one fetch call, optionally with a freshly renewed token. */
  private async attempt(
    method: Method,
    path: string,
    body: unknown,
    auth: boolean,
    contentType: string,
    forceRefresh: boolean,
    keepalive = false,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = contentType;
    }
    if (auth && this.tokenProvider) {
      const token = await this.tokenProvider(forceRefresh);
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
    }
    let payload: Uint8Array<ArrayBuffer> | string | undefined;
    if (body instanceof Uint8Array) {
      payload = body as Uint8Array<ArrayBuffer>;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
    }
    return fetch(API_BASE + path, {
      method,
      headers,
      body: payload,
      cache: 'no-store',
      credentials: 'omit',
      // ! A request that outlives the page can carry at most 64 KB.
      keepalive: keepalive && typeof payload === 'string' && payload.length < 60_000,
    });
  }

  /** Sends a request; on "401 Unauthorized" it renews the token once and tries again before giving up. */
  private async send(
    method: Method,
    path: string,
    body: unknown,
    auth: boolean,
    contentType = 'application/json',
    keepalive = false,
  ): Promise<Response> {
    let response = await this.attempt(method, path, body, auth, contentType, false, keepalive);
    if (response.status === 401 && auth && this.tokenProvider) {
      response = await this.attempt(method, path, body, auth, contentType, true, keepalive);
      if (response.status === 401) {
        this.onSessionExpired?.();
      }
    }
    if (!response.ok) {
      const payload = (await response.json().catch(this.emptyBody)) as Record<string, unknown>;
      throw new ApiError(response.status, String(payload['error'] ?? 'request_failed'), payload);
    }
    return response;
  }

  /** Body used when an error answer has no readable JSON. */
  private emptyBody(): Record<string, unknown> {
    return {};
  }
}
