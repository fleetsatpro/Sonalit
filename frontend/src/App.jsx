import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from './store';

export default function App() {
  const { token } = useAuthStore();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<div style={{color:'white',padding:'40px'}}>Store OK, token: {token ? 'yes' : 'none'}</div>} />
      </Routes>
    </BrowserRouter>
  );
}
