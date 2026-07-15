import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store';

export default function ProtectedRoute({ children }) {
  const { token, user } = useAuthStore();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
