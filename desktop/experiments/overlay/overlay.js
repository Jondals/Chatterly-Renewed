// The overlay: shows what arrives over the loopback, and reports how it goes.
const video = document.getElementById('v');
const pc = new RTCPeerConnection({ iceServers: [] });
const started = performance.now();
let frames = 0;
let firstFrameAt = 0;
pc.ontrack = function onTrack(event) {
  video.srcObject = event.streams[0];
};
pc.onicecandidate = function onCandidate(event) {
  if (event.candidate) window.poc.signal({ candidate: event.candidate.toJSON() });
};
window.poc.onSignal(async function onSignal(message) {
  if (message.offer) {
    await pc.setRemoteDescription(message.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    window.poc.signal({ answer: pc.localDescription.toJSON() });
  }
  if (message.candidate) await pc.addIceCandidate(message.candidate);
});
function onFrame() {
  frames++;
  if (!firstFrameAt) firstFrameAt = performance.now() - started;
  video.requestVideoFrameCallback(onFrame);
}
video.requestVideoFrameCallback(onFrame);
setInterval(function send() {
  window.poc.report({
    frames,
    firstFrameMs: Math.round(firstFrameAt),
    width: video.videoWidth,
    height: video.videoHeight,
    connection: pc.connectionState,
  });
}, 500);
