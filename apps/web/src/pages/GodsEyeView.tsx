import GPS from './GPS.js'

/**
 * First-class global God's Eye View surface.
 * The underlying operational map remains canonical; this surface makes the
 * spatial signal fabric discoverable without introducing a parallel map stack.
 */
export default function GodsEyeView() {
  return <GPS surface="gev" />
}
