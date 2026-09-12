// Flashes the browser tab title between its normal text and an alert
// message while the tab is hidden — the "you weren't looking at this tab
// but something happened" cue this app didn't have anywhere before (no
// favicon swap or Notification API usage existed either — see
// useDashboardRealtime.ts's guardian_voice_message handler, the first
// caller). Auto-stops the moment the tab regains visibility, since the
// flash only means anything while you're not looking at it.
let flashInterval: ReturnType<typeof setInterval> | null = null;
let originalTitle: string | null = null;
let visibilityHandler: (() => void) | null = null;

export function startTabTitleFlash(message: string): void {
  if (!document.hidden) return; // no point flashing a tab that's already visible
  if (flashInterval) return; // already flashing — let it keep alternating

  originalTitle = document.title;
  let showingAlert = false;
  flashInterval = setInterval(() => {
    showingAlert = !showingAlert;
    document.title = showingAlert ? message : (originalTitle as string);
  }, 1000);

  visibilityHandler = () => { if (!document.hidden) stopTabTitleFlash(); };
  document.addEventListener('visibilitychange', visibilityHandler);
}

export function stopTabTitleFlash(): void {
  if (flashInterval) { clearInterval(flashInterval); flashInterval = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
  if (originalTitle != null) { document.title = originalTitle; originalTitle = null; }
}

/** Fires a native OS notification if the tab is hidden and permission was
 *  already granted — never prompts here (that needs a user gesture; see
 *  VoiceNoteAlertToast's "Enable notifications" button). */
export function notifyIfHidden(title: string, body: string): void {
  if (!document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: 'sonalit-voice-note', silent: true });
  } catch { /* some browsers restrict this in certain contexts — non-critical, ignore */ }
}
