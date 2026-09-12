import { Link } from '@tanstack/react-router';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-slate-400">Page not found.</p>
      <Link to="/" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium">
        Back to sonalit.com
      </Link>
    </div>
  );
}
