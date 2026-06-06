import { useEffect } from 'react';

export default function ConvoyReports() {
  useEffect(() => {
    window.location.replace('/convoy.html');
  }, []);

  return (
    <div className="flex items-center justify-center h-screen text-slate-400 text-sm">
      Opening new report system…
    </div>
  );
}