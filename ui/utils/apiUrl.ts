/**
 * Helper to resolve backend API URL in browser.
 * Uses VITE_API_URL if configured, otherwise falls back to relative path.
 */
export function getApiUrl(path: string): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === "string") {
    const base = envUrl.endsWith("/") ? envUrl.slice(0, -1) : envUrl;
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
  return path;
}