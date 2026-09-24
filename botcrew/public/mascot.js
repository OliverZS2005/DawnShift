// Crewbot: BotCrew's little robot. It watches your cursor, blinks, nods when
// you give it work, scans while the team is busy, and cheers when a task is done.

const SVG = `
<svg viewBox="0 0 120 132" aria-hidden="true">
  <defs>
    <radialGradient id="cb-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--bot-glow)" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="var(--bot-glow)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse class="cb-shadow" cx="60" cy="126" rx="30" ry="4"/>
  <g class="cb-body">
    <rect x="36" y="94" width="48" height="28" rx="10" class="cb-shell"/>
    <rect x="52" y="102" width="16" height="8" rx="3" class="cb-chest"/>
    <rect x="26" y="98" width="10" height="18" rx="5" class="cb-shell cb-arm cb-arm-l"/>
    <rect x="84" y="98" width="10" height="18" rx="5" class="cb-shell cb-arm cb-arm-r"/>
  </g>
  <g class="cb-head">
    <line x1="60" y1="24" x2="60" y2="10" class="cb-stalk"/>
    <circle cx="60" cy="8" r="10" fill="url(#cb-glow)" class="cb-halo"/>
    <circle cx="60" cy="8" r="4.5" class="cb-tip"/>
    <rect x="12" y="46" width="8" height="20" rx="4" class="cb-shell"/>
    <rect x="100" y="46" width="8" height="20" rx="4" class="cb-shell"/>
    <rect x="18" y="24" width="84" height="68" rx="20" class="cb-shell"/>
    <rect x="27" y="35" width="66" height="44" rx="12" class="cb-screen"/>
    <g class="cb-face">
      <g class="cb-eyes">
        <rect x="41" y="46" width="9" height="15" rx="4.5" class="cb-eye"/>
        <rect x="70" y="46" width="9" height="15" rx="4.5" class="cb-eye"/>
      </g>
      <g class="cb-happy">
        <path d="M40 57 q5.5 -9 11 0" class="cb-line"/>
        <path d="M69 57 q5.5 -9 11 0" class="cb-line"/>
      </g>
      <path d="M53 68 q7 5 14 0" class="cb-line cb-mouth"/>
      <circle cx="36" cy="67" r="3.5" class="cb-cheek"/>
      <circle cx="84" cy="67" r="3.5" class="cb-cheek"/>
    </g>
  </g>
</svg>`;

const IDLE_LINES = [
  'Hi! Give me something to do.',
  'Ready when you are.',
  "I'm listening.",
  'Your team is standing by.',
  'Beep boop. Ready.',
];

export function createMascot() {
  const root = document.createElement('div');
  root.className = 'buddy';
  root.innerHTML = `
    <button class="buddy-bot" type="button" aria-label="Crewbot. Click to say hi.">${SVG}</button>
    <div class="buddy-bubble" role="status" aria-live="polite"></div>`;
  const bot = root.querySelector('.buddy-bot');
  const face = root.querySelector('.cb-face');
  const bubble = root.querySelector('.buddy-bubble');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let mood = 'idle';
  let sayTimer = null;

  // Play a one-shot animation class, restarting it if it's already playing.
  function play(cls, ms) {
    bot.classList.remove(cls);
    void bot.getBoundingClientRect();
    bot.classList.add(cls);
    setTimeout(() => bot.classList.remove(cls), ms);
  }

  function say(text, ms = 4000) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  }

  const api = {
    el: root,
    say,
    nod(text) {
      play('nod', 900);
      if (text) say(text);
    },
    cheer(text) {
      play('cheer', 1600);
      if (text) say(text, 5000);
    },
    shake(text) {
      play('shake', 700);
      if (text) say(text, 6000);
    },
    // idle | working | alert
    setMood(next) {
      if (next === mood) return;
      bot.classList.remove(`mood-${mood}`);
      mood = next;
      bot.classList.add(`mood-${mood}`);
    },
  };

  // Eyes (and a little head tilt) follow the cursor.
  if (!reduced) {
    let frame = 0;
    window.addEventListener('pointermove', (e) => {
      if (frame || mood === 'working') return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = bot.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.4);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / 400);
        face.style.transform = `translate(${((dx / dist) * 6 * reach).toFixed(2)}px, ${((dy / dist) * 4 * reach).toFixed(2)}px)`;
      });
    });
  }

  // Blink every few seconds, at slightly random times so it looks alive.
  (function blink() {
    setTimeout(() => {
      play('blink', 180);
      blink();
    }, 2500 + Math.random() * 3500);
  })();

  bot.addEventListener('click', () => api.nod(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]));
  bot.classList.add('mood-idle');
  return api;
}
