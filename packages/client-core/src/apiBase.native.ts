import { APP_ORIGIN } from './appOrigins';

export const API_BASE = `${APP_ORIGIN}/api`;

// React Native's fetch polyfill turns cache: 'no-store' into an unsupported query parameter.
export const API_REQUEST_OPTIONS: { cache?: RequestCache; headers: Record<string, string> } = {
  headers: { 'Cache-Control': 'no-cache' },
};
