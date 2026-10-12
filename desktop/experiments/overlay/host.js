// The "call window": a live video (a moving canvas, 30 frames a second) sent to the overlay over a local loopback.
const canvas = document.getElementById('c');
const context = canvas.getContext('2d');
let frame = 0;
function draw() {
  frame++;
  context.fillStyle = '#10131c';
  context.fillRect(0, 0, 640, 360);
  context.fillStyle = 'hsl(' + ((frame * 4) % 360) + ' 80% 60%)';
  context.beginPath();
  context.arc(
    320 + Math.sin(frame / 20) * 200,
    180 + Math.cos(frame / 15) * 100,
    60,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillStyle = '#fff';
  context.font = '28px sans-serif';
  context.fillText('frame ' + frame, 20, 40);
  requestAnimationFrame(draw);
}
draw();

// Local only: no STUN, no TURN. (The real call keeps its relay-only policy; this connection never leaves the computer.)
const pc = new RTCPeerConnection({ iceServers: [] });
const stream = canvas.captureStream(30);
for (const track of stream.getTracks()) pc.addTrack(track, stream);
pc.onicecandidate = function onCandidate(event) {
  if (event.candidate) window.poc.signal({ candidate: event.candidate.toJSON() });
};
window.poc.onSignal(async function onSignal(message) {
  if (message.answer) await pc.setRemoteDescription(message.answer);
  if (message.candidate) await pc.addIceCandidate(message.candidate);
});
(async function offer() {
  // A small picture is enough for a tile of an overlay: it costs far less to encode and decode.
  const sender = pc.getSenders()[0];
  const parameters = sender.getParameters();
  if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
  parameters.encodings[0].scaleResolutionDownBy = 2;
  parameters.encodings[0].maxBitrate = 600000;
  await sender.setParameters(parameters);
  await pc.setLocalDescription(await pc.createOffer());
  window.poc.signal({ offer: pc.localDescription.toJSON() });
})();
