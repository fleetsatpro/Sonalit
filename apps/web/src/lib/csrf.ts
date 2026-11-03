const CSRF_COOKIE = import.meta.env.PROD ? '__Host-csrf' : 'csrf';

export function getCsrfToken(): string | null {
  const prefix = CSRF_COOKIE + '=';
  for (const part of document.cookie.split(';')) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}
