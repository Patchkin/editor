/** Settings and addresses shared by the extension's commands, kept free of the VS Code API so they can be tested. */

export const DEFAULT_HUB_URL = 'https://blue.patchkin.io';
export const MIN_POLL_SECONDS = 15;
export const REQUEST_TIMEOUT_MS = 20_000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The hub address as the client should use it: an origin, no trailing slash, no credentials.
 * A hub that is not on this machine has to use https; plain http is allowed only for a local one.
 */
export function normalizeHubUrl(input: string | undefined | null): string {
  const text = String(input ?? '').trim();
  if (!text) return DEFAULT_HUB_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Enter the hub address, for example https://blue.patchkin.io');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The hub address must start with https://');
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Use https:// for a hub that is not on this machine');
  }
  if (url.username || url.password) {
    throw new Error('Do not put a username or password in the hub address');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Use the address of the hub itself, without a path');
  }
  return url.origin;
}

/** The poll interval in seconds, never faster than the minimum. */
export function pollSeconds(value: number | string | undefined | null): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < MIN_POLL_SECONDS) return MIN_POLL_SECONDS;
  return Math.min(n, 3600);
}

/** Where "Open in Patchkin" takes a person: the Products screen, which holds the runs list. */
export function webUrlFor(hubUrl: string): string {
  return `${normalizeHubUrl(hubUrl)}/?tab=projects`;
}
