import { useState } from 'react';
import type { AuthState } from './features/guardian-convoy/types/ConvoyReport';
import { LoginScreen } from './features/guardian-convoy/screens/LoginScreen';
import { HomeScreen } from './features/guardian-convoy/screens/HomeScreen';
import { SODUploadScreen } from './features/guardian-convoy/screens/SODUploadScreen';
import { EODUploadScreen } from './features/guardian-convoy/screens/EODUploadScreen';
import { SealRegisterScreen } from './features/guardian-convoy/screens/SealRegisterScreen';
import { SOSScreen } from './features/guardian-convoy/screens/SOSScreen';
import { HistoryScreen } from './features/guardian-convoy/screens/HistoryScreen';
import { DayPlanScreen } from './features/guardian-convoy/screens/DayPlanScreen';
import { WaypointPrompt } from './features/guardian-convoy/components/WaypointPrompt';

export type ScreenName = 'login' | 'home' | 'sod' | 'eod' | 'seals' | 'sos' | 'history' | 'dayplan';

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('login');
  const [auth, setAuth] = useState<AuthState | null>(null);

  const navigate = (s: string) => setScreen(s as ScreenName);

  const handleLogin = (a: AuthState) => {
    setAuth(a);
    setScreen('home');
  };

  const handleLogout = () => {
    setAuth(null);
    setScreen('login');
  };

  void handleLogout; // available for future use

  const sharedProps = { navigate, auth };

  function renderScreen() {
    switch (screen) {
      case 'login':
        return <LoginScreen navigate={navigate} onLogin={handleLogin} />;
      case 'home':
        return <HomeScreen {...sharedProps} />;
      case 'sod':
        return <SODUploadScreen {...sharedProps} />;
      case 'eod':
        return <EODUploadScreen {...sharedProps} />;
      case 'seals':
        return <SealRegisterScreen {...sharedProps} />;
      case 'sos':
        return <SOSScreen {...sharedProps} />;
      case 'history':
        return <HistoryScreen {...sharedProps} />;
      case 'dayplan':
        return <DayPlanScreen {...sharedProps} />;
      default:
        return <HomeScreen {...sharedProps} />;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#060a08' }}>
      {renderScreen()}
      {auth && screen !== 'login' && <WaypointPrompt auth={auth} />}
    </div>
  );
}
