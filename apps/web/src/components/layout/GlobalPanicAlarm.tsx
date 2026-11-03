import { useAuthStore } from '../../stores/auth.js';
import { useDashboardRealtime } from '../../hooks/useDashboardRealtime.js';
import PanicAlarm from '../dashboard/PanicAlarm.js';
import VoiceNoteAlertToast from '../dashboard/VoiceNoteAlertToast.js';

// Previously the realtime subscription + full-screen alarm were only mounted
// inside Dashboard.tsx, so a panic triggered while the operator was on any
// other page (Fleet, Alerts, Panic Center, Guardian, ...) produced zero
// feedback until they navigated back to '/' — worst case a 15s silent gap
// via the REST poll fallback, perceived as "lag". Mounting this once per
// authenticated shell (AppShell + the fullscreen report shell) means the
// websocket subscription and the alarm live for the whole session instead
// of being torn down/rebuilt on every route change.
//
// No longer panic-only despite the name: it's the one place the org#<id>
// subscription is set up, so VoiceNoteAlertToast rides along on the same
// subscription rather than opening a second one.
export default function GlobalPanicAlarm() {
  const orgId = useAuthStore((s) => s.user?.org_id ?? '');
  useDashboardRealtime(orgId);
  return (
    <>
      <PanicAlarm />
      <VoiceNoteAlertToast />
    </>
  );
}
