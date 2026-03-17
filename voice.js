// ===== VOICE.JS — Narrador de señales =====

const Voice = (() => {

  const synth = window.speechSynthesis;
  let enabled        = false;
  let lastSignalType = '';
  let bestVoice      = null;

  // ── Elegir la voz más natural disponible ─────────────────────────────────
  function loadVoice() {
    const voices = synth.getVoices();

    // Preferencia: voces "Neural" o "Natural" > Google > Microsoft > resto
    // En español priorizamos voces femeninas que suelen sonar más suaves
    const ranked = voices
      .filter(v => v.lang.startsWith('es'))
      .sort((a, b) => {
        const score = v => {
          let s = 0;
          const n = v.name.toLowerCase();
          if (n.includes('neural') || n.includes('natural')) s += 40;
          if (n.includes('google'))     s += 20;
          if (n.includes('microsoft'))  s += 15;
          if (n.includes('paulina') || n.includes('mónica') ||
              n.includes('monica')  || n.includes('laura')  ||
              n.includes('lucia')   || n.includes('sofia')  ||
              n.includes('camila')  || n.includes('valentina')) s += 30;
          if (v.lang === 'es-US') s += 10;
          if (v.lang === 'es-MX') s += 8;
          if (v.lang === 'es-ES') s += 5;
          return s;
        };
        return score(b) - score(a);
      });

    bestVoice = ranked[0] || null;
  }

  loadVoice();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoice;

  // ── Hablar ────────────────────────────────────────────────────────────────
  function say(text, interrupt = false) {
    if (!enabled || !text) return;
    if (interrupt) synth.cancel();

    const utt    = new SpeechSynthesisUtterance(text);
    utt.voice    = bestVoice || null;
    utt.lang     = bestVoice?.lang || 'es-ES';
    utt.rate     = 0.88;   // más lento = más calmado y claro
    utt.pitch    = 1.15;   // un poco más agudo = más suave al oído
    utt.volume   = 1.0;
    synth.speak(utt);
  }

  // ── Tipo de señal ─────────────────────────────────────────────────────────
  function getType(css) {
    if (css.includes('extreme'))                                    return 'extreme';
    if (css.includes('trap') || css.includes('manipulation'))       return 'trap';
    if (css.includes('buy')  || css.includes('accumulation') ||
        css.includes('reversal'))                                   return 'buy';
    if (css.includes('sell') || css.includes('distribution'))       return 'sell';
    if (css.includes('conflict'))                                   return 'conflict';
    return 'wait';
  }

  // ── Mensajes — pausas con comas para ritmo más natural ───────────────────
  const MESSAGES = {
    buy:      'Señal de compra.',
    sell:     'Señal de venta.',
    wait:     'Espera.',
    trap:     'Cuidado... posible trampa.',
    extreme:  'Alerta extrema. No operes todavía.',
    conflict: 'Señal conflictiva. Espera confirmación.',
  };

  // ── Hook desde update() ───────────────────────────────────────────────────
  function onUpdate(cssClass) {
    if (!enabled) return;
    const type = getType(cssClass);
    if (type === lastSignalType) return;
    lastSignalType = type;
    say(MESSAGES[type], type === 'extreme' || type === 'trap');
  }

  // ── Toggle ────────────────────────────────────────────────────────────────
  function toggle() {
    enabled = !enabled;
    synth.cancel();
    lastSignalType = '';

    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.classList.toggle('voice-on', enabled);
      btn.innerHTML = enabled ? '🔊 VOZ' : '🔇 VOZ';
      btn.title     = enabled ? 'Desactivar voz' : 'Activar voz';
    }

    if (enabled) {
      const el = document.getElementById('main-signal');
      if (el) {
        const type     = getType(el.className || '');
        lastSignalType = type;
        say(MESSAGES[type] || 'Espera.');
      }
    }
  }

  return { toggle, onUpdate };

})();

// ── Hook en update() ─────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  if (typeof update === 'function') {
    const _orig = update;
    window.update = function () {
      _orig.apply(this, arguments);
      const el = document.getElementById('main-signal');
      if (el) Voice.onUpdate(el.className || '');
    };
  }
});
