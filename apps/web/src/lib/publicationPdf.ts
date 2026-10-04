import { api } from './api.js';

export type PublicationPdfMode = 'preview' | 'download';

export async function openPublicationPdf(publicationId: string, mode: PublicationPdfMode): Promise<void> {
  const encodedId = encodeURIComponent(publicationId);
  const popup = mode === 'preview' ? window.open('', '_blank') : null;

  try {
    const response = await api.get(
      `/admin/communications/publications/${encodedId}/pdf`,
      {
        responseType: 'blob',
        headers: { Accept: 'application/pdf' },
      },
    );

    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    if (mode === 'preview') {
      if (popup) {
        popup.opener = null;
        popup.location.replace(blobUrl);
      } else {
        window.location.assign(blobUrl);
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `sonalit-${publicationId}.pdf`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}
