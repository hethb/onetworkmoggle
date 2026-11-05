const $ = (id) => document.getElementById(id);
const MAX_INDUSTRIES = 3;
const LOW_TIME_SECONDS = 30;

const state = {
  config: null,
  token: sessionStorage.getItem('token'),
  selectedIndustries: [],
  socket: null,
  localStream: null,
  match: null, // { matchId, polite, peer, ended }
  pc: null,
  makingOffer: false,
  ignoreOffer: false,
  timer: null,
  lobbyTimers: [],
};

/* ---------- Helpers ---------- */

const SCREENS = ['upload', 'review', 'lobby', 'call'];
function show(name) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo(0, 0);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showError(id, message) {
  $(id).textContent = message ?? '';
  $(id).hidden = !message;
}

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

/* ---------- Upload ---------- */

async function uploadResume(file) {
  showError('upload-error');
  const dz = $('dropzone');
  dz.classList.add('busy');
  $('drop-title').textContent = 'Reading your resume…';
  $('drop-sub').textContent = file.name;
  try {
    const body = new FormData();
    body.append('resume', file);
    const res = await fetch('/api/resume', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed. Please try again.');
    openReview(data.profile, "Here's what we found. Fix anything we got wrong, because your matches depend on it.");
  } catch (err) {
    showError('upload-error', err.message);
  } finally {
    dz.classList.remove('busy');
    $('drop-title').textContent = 'Drop your resume here';
    $('drop-sub').textContent = 'PDF, DOCX or TXT, up to 5 MB. Or click to browse.';
    $('file').value = '';
  }
}

$('file').addEventListener('change', (e) => { if (e.target.files[0]) uploadResume(e.target.files[0]); });
$('dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
for (const type of ['dragenter', 'dragover']) {
  $('dropzone').addEventListener(type, (e) => { e.preventDefault(); $('dropzone').classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  $('dropzone').addEventListener(type, (e) => { e.preventDefault(); $('dropzone').classList.remove('over'); });
}
$('dropzone').addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) uploadResume(e.dataTransfer.files[0]); });
$('manual').addEventListener('click', () => openReview({}, 'Tell us about your work so we can find the right people.'));

/* ---------- Review ---------- */

const ROWS = {
  jobs: { a: 'title', b: 'company', pa: 'Title', pb: 'Company' },
  schools: { a: 'name', b: 'field', pa: 'School', pb: 'Field of study' },
};

function addRow(kind, value = {}) {
  const { a, b, pa, pb } = ROWS[kind];
  const row = el('div', { className: 'row' },
    el('input', { value: value[a] ?? '', placeholder: pa, ariaLabel: pa, maxLength: 100 }),
    el('input', { value: value[b] ?? '', placeholder: pb, ariaLabel: pb, maxLength: 100 }),
    el('button', { type: 'button', textContent: '×', ariaLabel: `Remove ${pa.toLowerCase()}`, onclick: () => row.remove() }),
  );
  $(kind).append(row);
}

function readRows(kind) {
  const { a, b } = ROWS[kind];
  return [...$(kind).querySelectorAll('.row')]
    .map((row) => {
      const [x, y] = row.querySelectorAll('input');
      return { [a]: x.value.trim(), [b]: y.value.trim() };
    })
    .filter((row) => row[a]);
}

function renderIndustries() {
  $('industries').replaceChildren(...state.config.industries.map((name) => {
    const on = state.selectedIndustries.includes(name);
    return el('button', {
      type: 'button',
      className: 'chip',
      textContent: on ? `${state.selectedIndustries.indexOf(name) + 1}. ${name}` : name,
      ariaPressed: String(on),
      onclick: () => {
        if (on) state.selectedIndustries = state.selectedIndustries.filter((i) => i !== name);
        else if (state.selectedIndustries.length < MAX_INDUSTRIES) state.selectedIndustries.push(name);
        else return toast(`Pick up to ${MAX_INDUSTRIES}. Remove one first.`);
        renderIndustries();
      },
    });
  }));
}

function openReview(profile, note) {
  const form = $('profile-form');
  form.reset();
  $('review-note').textContent = note;
  form.elements.name.value = profile.name ?? '';
  form.elements.headline.value = profile.headline ?? '';
  form.elements.skills.value = (profile.skills ?? []).join(', ');
  state.selectedIndustries = (profile.industries ?? []).slice(0, MAX_INDUSTRIES);
  renderIndustries();
  for (const kind of Object.keys(ROWS)) {
    $(kind).replaceChildren();
    const items = profile[kind] ?? [];
    items.slice(0, 8).forEach((item) => addRow(kind, item));
    if (!items.length) addRow(kind);
  }
  showError('review-error');
  show('review');
}

for (const button of document.querySelectorAll('[data-add]')) {
  button.addEventListener('click', () => addRow(button.dataset.add));
}
$('back').addEventListener('click', () => show('upload'));

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  showError('review-error');
  if (!form.elements.adult.checked) return showError('review-error', 'Please confirm you are 18 or older.');
  const profile = {
    name: form.elements.name.value,
    headline: form.elements.headline.value,
    industries: state.selectedIndustries,
    jobs: readRows('jobs').slice(0, 8),
    schools: readRows('schools').slice(0, 5),
    skills: form.elements.skills.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
    contact: form.elements.contact.value,
  };
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adult: true, profile }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    state.token = data.token;
    sessionStorage.setItem('token', data.token);
    state.lastIndustries = profile.industries;
    await enterLobby();
  } catch (err) {
    showError('review-error', err.message);
  }
});

/* ---------- Media ---------- */

async function ensureMedia() {
  if (state.localStream) return;
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    state.localStream = null;
  }
  const hasCamera = Boolean(state.localStream);
  $('preview').srcObject = state.localStream;
  $('local').srcObject = state.localStream;
  $('local').hidden = !hasCamera;
  $('preview-off').hidden = hasCamera;
  $('mic').disabled = !hasCamera;
  $('cam').disabled = !hasCamera;
}

function toggleTrack(button, tracks, onLabel, offLabel) {
  const enabled = !tracks[0]?.enabled;
  tracks.forEach((t) => { t.enabled = enabled; });
  button.textContent = enabled ? onLabel : offLabel;
  button.setAttribute('aria-pressed', String(!enabled));
}
$('mic').addEventListener('click', () => toggleTrack($('mic'), state.localStream.getAudioTracks(), 'Mute', 'Unmute'));
$('cam').addEventListener('click', () => toggleTrack($('cam'), state.localStream.getVideoTracks(), 'Camera off', 'Camera on'));

/* ---------- Lobby ---------- */

function clearLobbyTimers() {
  state.lobbyTimers.forEach(clearTimeout);
  state.lobbyTimers = [];
}

function joinQueue(note) {
  clearLobbyTimers();
  state.match = null;
  show('lobby');
  $('lobby-title').textContent = 'Finding someone in your field…';
  $('lobby-sub').textContent = state.lastIndustries?.length ? `Looking in ${state.lastIndustries.join(', ')}` : '';
  $('lobby-note').textContent = note ?? '';
  $('lobby-note').hidden = !note;
  state.lobbyTimers.push(
    setTimeout(() => { $('lobby-title').textContent = 'Widening to related fields…'; }, 15_000),
    setTimeout(() => { $('lobby-title').textContent = 'Few people online. Next match could be from any field…'; }, 60_000),
  );
  state.socket.emit('queue:join');
}

async function enterLobby() {
  show('lobby');
  $('lobby-title').textContent = 'Turning on your camera…';
  await ensureMedia();
  connectSocket();
}

function connectSocket() {
  if (state.socket) {
    joinQueue();
    return;
  }
  const socket = io({ auth: { token: state.token } });
  state.socket = socket;

  socket.on('connect', () => {
    if (!state.match) joinQueue();
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'no-session' || err.message === 'removed') {
      resetSession(err.message === 'removed'
        ? 'Your profile was removed after multiple reports.'
        : 'Your session expired. Please set up your profile again.');
    }
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return;
    // The server ends the match when a connection drops, and can't tell us, so end it here.
    if (state.match) endCallUi();
    state.match = null;
    show('lobby');
    $('lobby-title').textContent = 'Reconnecting…';
  });
  socket.on('stats', ({ online, waiting }) => {
    $('stats').hidden = false;
    $('stats').textContent = `${online} online · ${waiting} waiting`;
  });
  socket.on('matched', startCall);
  socket.on('signal', onSignal);
  socket.on('chat', ({ matchId, text }) => {
    if (state.match?.matchId === matchId) addMessage(state.match.peer.name, text);
  });
  socket.on('match:ended', onMatchEnded);
  socket.on('connect:pending', ({ matchId }) => {
    if (state.match?.matchId !== matchId) return;
    setConnectLabel('Waiting for them…', true);
    if (state.match.ended) $('wrap-sub').textContent = `We'll share details if ${state.match.peer.name} connects too.`;
  });
  socket.on('connect:requested', ({ matchId }) => {
    if (state.match?.matchId !== matchId) return;
    addSystem(`${state.match.peer.name} wants to connect.`);
    $('connect').classList.add('requested');
    if (state.match.ended) $('wrap-sub').textContent = `${state.match.peer.name} wants to connect with you.`;
  });
  socket.on('connect:mutual', onMutual);
  socket.on('removed', () => resetSession('Your profile was removed after multiple reports.'));
}

function resetSession(message) {
  stopCall();
  clearLobbyTimers();
  state.socket?.disconnect();
  state.socket = null;
  state.token = null;
  state.match = null;
  sessionStorage.removeItem('token');
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  $('stats').hidden = true;
  show('upload');
  renderConnections();
  if (message) showError('upload-error', message);
}

$('stop').addEventListener('click', () => {
  state.socket?.emit('queue:leave');
  resetSession();
});

/* ---------- Call ---------- */

function setConnectLabel(label, disabled) {
  for (const id of ['connect', 'wrap-connect']) {
    $(id).textContent = label;
    $(id).disabled = disabled;
  }
}

function renderPeer(peer) {
  const lines = [
    el('h3', { textContent: peer.name }),
    el('p', { className: 'headline', textContent: peer.headline || peer.industries.join(', ') }),
  ];
  for (const job of peer.jobs) lines.push(el('p', { textContent: [job.title, job.company].filter(Boolean).join(' · ') }));
  for (const school of peer.schools) lines.push(el('p', { textContent: [school.name, school.field].filter(Boolean).join(' · ') }));
  if (peer.skills.length) lines.push(el('p', { textContent: peer.skills.join(', ') }));
  $('peer').replaceChildren(...lines);
}

function renderTimer(seconds) {
  $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('low', seconds <= LOW_TIME_SECONDS);
}

function addMessage(who, text) {
  $('messages').append(el('p', {}, el('b', { textContent: `${who}: ` }), text));
  $('messages').scrollTop = $('messages').scrollHeight;
}

function addSystem(text) {
  $('messages').append(el('p', { className: 'sys', textContent: text }));
  $('messages').scrollTop = $('messages').scrollHeight;
}

function startCall(match) {
  clearLobbyTimers();
  stopCall();
  state.match = { ...match, ended: false };
  show('call');

  renderPeer(match.peer);
  $('reasons').replaceChildren(
    ...(match.reasons.length ? match.reasons : ['Different fields: ask what they work on']).map((r) => el('span', { textContent: r })),
  );
  $('messages').replaceChildren();
  const length = match.seconds < 60 ? `${match.seconds} seconds`
    : match.seconds < 120 ? '1 minute' : `${Math.round(match.seconds / 60)} minutes`;
  addSystem(`You have ${length} with ${match.peer.name}.`);
  $('wrap').hidden = true;
  $('wrap-contact').hidden = true;
  $('connect').classList.remove('requested');
  setConnectLabel('Connect', false);
  $('chat-input').disabled = false;
  $('remote').srcObject = null;
  $('remote-off').hidden = false;
  $('remote-off').textContent = 'Connecting video…';

  const endsAt = Date.now() + match.seconds * 1000;
  const tick = () => renderTimer(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
  tick();
  state.timer = setInterval(tick, 500);

  startPeerConnection(match);
}

function startPeerConnection(match) {
  const pc = new RTCPeerConnection({ iceServers: match.iceServers });
  state.pc = pc;
  state.makingOffer = false;
  state.ignoreOffer = false;
  const { matchId } = match;

  state.localStream?.getTracks().forEach((track) => pc.addTrack(track, state.localStream));

  pc.ontrack = ({ streams }) => {
    $('remote').srcObject = streams[0];
    $('remote-off').hidden = true;
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) state.socket.emit('signal', { matchId, data: { candidate } });
  };
  pc.onnegotiationneeded = async () => {
    try {
      state.makingOffer = true;
      await pc.setLocalDescription();
      state.socket.emit('signal', { matchId, data: { description: pc.localDescription } });
    } catch (err) {
      console.error('Could not create offer', err);
    } finally {
      state.makingOffer = false;
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc !== state.pc) return;
    if (pc.connectionState === 'failed') {
      pc.restartIce();
      $('remote-off').hidden = false;
      $('remote-off').textContent = "Video couldn't connect on this network. Text chat still works.";
    } else if (pc.connectionState === 'connected' && $('remote').srcObject) {
      $('remote-off').hidden = true;
    }
  };
  // If the other person has no camera, nothing ever arrives on the video track.
  setTimeout(() => {
    if (pc === state.pc && !$('remote').srcObject) $('remote-off').textContent = 'No video from them. Text chat still works.';
  }, 8000);
}

// WebRTC "perfect negotiation": either side can offer, even someone joining without a camera.
async function onSignal({ matchId, data }) {
  const pc = state.pc;
  if (!pc || state.match?.matchId !== matchId) return;
  try {
    if (data.description) {
      const collision = data.description.type === 'offer' && (state.makingOffer || pc.signalingState !== 'stable');
      state.ignoreOffer = !state.match.polite && collision;
      if (state.ignoreOffer) return;
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription();
        state.socket.emit('signal', { matchId, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!state.ignoreOffer) throw err;
      }
    }
  } catch (err) {
    console.error('Signaling error', err);
  }
}

function stopCall() {
  clearInterval(state.timer);
  state.pc?.close();
  state.pc = null;
  $('remote').srcObject = null;
}

function endCallUi() {
  stopCall();
  $('chat-input').disabled = true;
}

function onMatchEnded({ matchId, reason, byYou }) {
  if (state.match?.matchId !== matchId) return;
  const { peer } = state.match;
  endCallUi();
  if (reason === 'time') {
    state.match.ended = true;
    renderTimer(0);
    $('wrap').hidden = false;
    $('wrap-title').textContent = "Time's up";
    if ($('wrap-connect').disabled) {
      $('wrap-sub').textContent = `We'll share details if ${peer.name} connects too.`;
    } else if ($('connect').classList.contains('requested')) {
      $('wrap-sub').textContent = `${peer.name} wants to connect with you.`;
    } else {
      $('wrap-sub').textContent = `Want to stay in touch with ${peer.name}? Details are shared only if you both connect.`;
    }
    return;
  }
  if (reason === 'reported') return joinQueue(`Reported. You won't be matched with ${peer.name} again.`);
  joinQueue(byYou ? undefined : `${peer.name} moved on. Finding your next match.`);
}

function saveConnection(person) {
  const list = JSON.parse(localStorage.getItem('connections') ?? '[]');
  list.unshift(person);
  localStorage.setItem('connections', JSON.stringify(list.slice(0, 100)));
}

function onMutual({ matchId, name, headline, contact }) {
  saveConnection({ name, headline, contact });
  const text = contact ? `${name}: ${contact}` : `${name} didn't leave contact details.`;
  if (state.match?.matchId !== matchId) return toast(`You connected! ${text}`);
  setConnectLabel('Connected', true);
  $('connect').classList.remove('requested');
  addSystem(`You connected! ${text}`);
  if (state.match.ended) {
    $('wrap-title').textContent = 'You connected!';
    $('wrap-sub').textContent = '';
    $('wrap-contact').textContent = text;
    $('wrap-contact').hidden = false;
  } else {
    toast(`You connected! ${text}`);
  }
}

function requestConnect() {
  if (state.match) state.socket.emit('match:connect', { matchId: state.match.matchId });
}
$('connect').addEventListener('click', requestConnect);
$('wrap-connect').addEventListener('click', requestConnect);
$('wrap-next').addEventListener('click', () => joinQueue());
$('next').addEventListener('click', () => {
  if (state.match) state.socket.emit('match:skip', { matchId: state.match.matchId });
});

$('chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text || !state.match || state.match.ended) return;
  state.socket.emit('chat', { matchId: state.match.matchId, text });
  addMessage('You', text);
  $('chat-input').value = '';
});

function openReport() {
  // Remember who is being reported: the match may end while the dialog is open.
  state.reporting = { matchId: state.match.matchId, name: state.match.peer.name };
  $('report-reason').value = '';
  $('report-dialog').showModal();
}
$('report').addEventListener('click', openReport);
$('wrap-report').addEventListener('click', openReport);
$('report-dialog').addEventListener('close', () => {
  if ($('report-dialog').returnValue !== 'report' || !state.reporting) return;
  const { matchId, name } = state.reporting;
  state.socket.emit('match:report', { matchId, reason: $('report-reason').value });
  const note = `Reported. You won't be matched with ${name} again.`;
  // A live call ends via match:ended. If it has already ended, nothing more will arrive.
  if (state.match?.matchId !== matchId) toast(note);
  else if (state.match.ended) joinQueue(note);
});

/* ---------- Start ---------- */

function renderConnections() {
  const list = JSON.parse(localStorage.getItem('connections') ?? '[]');
  const section = $('connections');
  section.hidden = !list.length;
  section.replaceChildren(
    el('h3', { textContent: 'Your connections' }),
    el('ul', {}, ...list.map((p) => el('li', {},
      el('b', { textContent: p.name }),
      el('span', { textContent: p.headline ?? '' }),
      el('span', { textContent: p.contact || 'No contact details shared' }),
    ))),
  );
}

async function init() {
  state.config = await (await fetch('/api/config')).json();
  $('privacy').textContent = state.config.parser === 'claude'
    ? "Your resume's text is sent to Anthropic's Claude API to read it. We don't save the file. Others see your first name and work history, never your email or phone number."
    : "We read your resume on our server and don't save the file. Others see your first name and work history, never your email or phone number.";
  renderConnections();
  if (state.token) await enterLobby();
}

init();
