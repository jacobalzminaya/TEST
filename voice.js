// ===== VOICE.JS — Narrador inteligente de señales =====
// Solo habla cuando la señal CAMBIA de tipo. Mensajes cortos y directos.

const Voice = (() => {

  const synth = window.speechSynthesis;
  let enabled        = false;
  let lastSignalType = '';   // buy | sell | wait | trap | extreme
  let spanishVoice   = null;

  // ── Voces ────────────────────────────────────────────────────────────────
  function loadVoice() {
    const voices = synth.getVoices();
    spanishVoice =
      voices.find(v => v.lang === 'es-US') ||
      voices.find(v => v.lang === 'es-MX') ||
      voices.find(v => v.lang === 'es-ES') ||
      voices.find(v => v.lang.startsWith('es')) ||
      null;
  }
  loadVoice();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoice;

  // ── Hablar ───────────────────────────────────────────────────────────────
  function say(text, interrupt = false) {
    if (!enabled || !text) return;
    if (interrupt) synth.cancel();

    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = spanishVoice?.lang || 'es-ES';
    utt.voice  = spanishVoice || null;
    utt.rate   = 0.95;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    synth.speak(utt);
  }

  // ── Detectar tipo de señal desde la clase CSS ────────────────────────────
  function getType(cssClass) {
    if (cssClass.includes('extreme'))                                   return 'extreme';
    if (cssClass.includes('trap') || cssClass.includes('manipulation')) return 'trap';
    if (cssClass.includes('buy')  || cssClass.includes('accumulation') || cssClass.includes('reversal')) return 'buy';
    if (cssClass.includes('sell') || cssClass.includes('distribution')) return 'sell';
    if (cssClass.includes('conflict'))                                  return 'conflict';
    return 'wait';
  }

  // ── Mensajes — cortos, directos, como un trader ──────────────────────────
  const MESSAGES = {
    buy:      '¡Compra!',
    sell:     '¡Venta!',
    wait:     'Espera.',
    trap:     '¡Cuidado, posible trampa!',
    extreme:  '¡Alerta extrema! No operes todavía.',
    conflict: 'Señal conflictiva. Espera confirmación.',
  };

  // ── Llamado en cada update() ─────────────────────────────────────────────
  function onUpdate(cssClass) {
    if (!enabled) return;
    const type = getType(cssClass);

    // Solo habla si el tipo de señal CAMBIÓ
    if (type === lastSignalType) return;
    lastSignalType = type;

    const urgent = type === 'extreme' || type === 'trap';
    say(MESSAGES[type] || 'Espera.', urgent);
  }

  // ── Botón toggle ─────────────────────────────────────────────────────────
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
