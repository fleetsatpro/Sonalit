import { useState } from 'react';
import TopBar       from './components/TopBar.jsx';
import Sidebar      from './components/Sidebar.jsx';
import ChatArea     from './components/ChatArea.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import BottomNav    from './components/BottomNav.jsx';
import Settings     from './components/Settings.jsx';

export default function App() {
  const [activeModule,  setActiveModule]  = useState('overview');
  const [autonomyLevel, setAutonomyLevel] = useState(1);
  const [userClass,     setUserClass]     = useState('operator');
  const [mobileTab,     setMobileTab]     = useState('chat');

  const selectModule = (mod) => {
    setActiveModule(mod);
    setMobileTab('chat');
  };

  return (
    <div className="app-shell">
      <TopBar
        incidents={2}
        autonomyLevel={autonomyLevel}
        setAutonomyLevel={setAutonomyLevel}
        userClass={userClass}
        setUserClass={setUserClass}
      />

      <div className="app-main">
        <Sidebar
          activeModule={activeModule}
          setActiveModule={selectModule}
          mobileActive={mobileTab === 'modules'}
        />
        <ChatArea
          activeModule={activeModule}
          userClass={userClass}
          autonomyLevel={autonomyLevel}
          mobileActive={mobileTab === 'chat'}
        />
        <MetricsPanel
          mobileActive={mobileTab === 'metrics'}
        />
        <Settings
          autonomyLevel={autonomyLevel}
          setAutonomyLevel={setAutonomyLevel}
          userClass={userClass}
          setUserClass={setUserClass}
          mobileActive={mobileTab === 'settings'}
        />
      </div>

      <BottomNav active={mobileTab} setActive={setMobileTab} />
    </div>
  );
}
