import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

export default function CDSRedirect() {
  const router = useRouter();
  const path = router.state.location.pathname;

  useEffect(() => {
    const port = import.meta.env.DEV ? ':5174' : '';
    window.location.replace(`${window.location.protocol}//${window.location.hostname}${port}${path}`);
  }, [path]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#080a10', color: '#aab' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>Loading Container Delivery System…</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>Redirecting to CDS application</div>
      </div>
    </div>
  );
}
