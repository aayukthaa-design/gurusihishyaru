// Reports uncaught client errors to the server so a "the button does nothing"
// bug report can be diagnosed from server logs — React's error boundary only
// catches render-phase errors, never a throw inside an onClick handler, which
// is exactly the class of bug that produces a silent, untraceable failure.
const ENDPOINT = '/api/client-errors';

function send(message: string, stack?: string) {
  try {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    const userId = token ? JSON.parse(atob(token.split('.')[1] || '')).sub : undefined;
    const body = JSON.stringify({ message, stack, url: window.location.href, userId });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never itself throw or loop back into the error handlers below.
  }
}

export function reportClientError(message: string, stack?: string): void {
  send(message, stack);
}

export function installGlobalErrorReporter(): void {
  window.addEventListener('error', (event) => {
    send(event.message, event.error?.stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send(reason?.message || String(reason), reason?.stack);
  });
}
