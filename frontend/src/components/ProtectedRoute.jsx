import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { Spinner } from './UI';

export default function ProtectedRoute({ children, roles }) {
  const { user, token } = useAuthStore();
  const location = useLocation();

  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-950 text-center px-4">
        <div>
          <p className="font-display text-gold text-xl mb-2">Access Denied</p>
          <p className="text-slate-400 text-sm">Your role <span className="font-mono text-slate-200">{user.role}</span> does not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return children;
}
