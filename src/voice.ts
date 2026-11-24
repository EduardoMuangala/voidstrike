let micTrack: MediaStreamTrack | null = null;
let micPromise: Promise<MediaStreamTrack | null> | null = null;
let micDenied = false;

/**
 * Lazily asks for the microphone the first time push-to-talk is pressed (never
 * before — no point prompting for a permission a guest/bot match will never use),
 * then reuses the same track for the rest of the session.
 */
export function getMicTrack(): Promise<MediaStreamTrack | null> {
  if (micTrack) return Promise.resolve(micTrack);
  if (micDenied) return Promise.resolve(null);
  if (micPromise) return micPromise;
  micPromise = navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    .then((stream) => {
      micTrack = stream.getAudioTracks()[0] || null;
      micTrack.enabled = true;
      return micTrack;
    })
    .catch(() => {
      micDenied = true;
      return null;
    });
  return micPromise;
}

export function micAvailable() {
  return !micDenied;
}
