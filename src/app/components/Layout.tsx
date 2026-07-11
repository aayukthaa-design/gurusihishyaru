import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { AppErrorBoundary } from './AppErrorBoundary';

export function Layout() {
  return (
    <div className="flex min-h-screen bg-background transition-colors duration-200">
      <Sidebar />
      {/* sidebar is w-60 = 240px */}
      <div className="ml-60 flex-1 min-w-0">
        <AppErrorBoundary fallbackTitle="This page encountered an error">
          <Outlet />
        </AppErrorBoundary>
      </div>
      {/* Floating WhatsApp button removed per request */}
    </div>
  );
}
