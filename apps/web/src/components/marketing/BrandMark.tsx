/**
 * The Sonalit wordmark and emblem.
 *
 * Uses the real brand emblem (the same asset as the favicon, the PWA icon and
 * the OG card) inside the design's pulsing cyan ring, rather than a generic
 * placeholder glyph — the public site and the installed app should be
 * recognisably the same product.
 */
export default function BrandMark({ size = 30 }: { size?: number }): React.ReactElement {
  return (
    <>
      <span className="logo-mark" style={{ width: size, height: size }}>
        <img src="/icon-192.png" alt="" width={size} height={size} />
      </span>
      Sonalit
    </>
  );
}
