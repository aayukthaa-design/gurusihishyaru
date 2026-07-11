import { AppErrorBoundary } from './components/AppErrorBoundary';
import { RouterProvider } from 'react-router';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './auth/AuthContext';
import { router } from './routes';
import BirthdayChecker from './components/BirthdayChecker';

export default function App() {
  return (
    <AppErrorBoundary fallbackTitle="Guru Shishyaru Tutorials — Application Error">
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <BirthdayChecker />
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
