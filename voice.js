
// ===== VOICE.JS — Narrador de señales con contexto =====

const Voice = (() => {

  const synth = window.speechSynthesis;
  let enabled         = false;
  let lastSignalKey   = '';   // ahora compara texto+clase, no solo clase
  let bestVoice       = null;

  // ── Elegir la voz más natural disponible ─────────────────────────────────
  function loadVoice() {
    const voices = synth.getVoices();
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
    utt.rate     = 0.88;
    utt.pitch    = 1.15;
    utt.volume   = 1.0;
    synth.speak(utt);
  }

  // ── Extraer texto de voz del elemento ────────────────────────────────────
  // Primero lee data-voice (puesto por logic.js con el mensaje exacto).
  // Si no existe, cae al mapa de fallback por clase CSS.
  function resolveText(el) {
    const dataVoice = el.getAttribute('data-voice');
    if (dataVoice && dataVoice.trim()) return dataVoice.trim();
    return fallbackText(el.className || '');
  }

  // ── Fallback por clase CSS (para compatibilidad hacia atrás) ─────────────
  function fallbackText(css) {
    if (css.includes('signal-extreme'))
      return 'Alerta extrema. No operes todavía.';
    if (css.includes('signal-trap') || css.includes('signal-manipulation'))
      return 'Cuidado, posible trampa.';
    if (css.includes('signal-buy-weak') || css.includes('signal-sell-weak'))
      return 'Señal débil. Confianza media. Verifica antes de entrar.';
    if (css.includes('signal-caution'))
      return 'Precaución. Zona límite. No operes todavía.';
    if (css.includes('signal-strong-reversal'))
      return css.includes('buy')
        ? 'Comprar. Reversión fuerte confirmada.'
        : 'Vender. Reversión fuerte confirmada.';
    if (css.includes('signal-accumulation'))
      return 'Comprar. Acumulación institucional detectada.';
    if (css.includes('signal-distribution'))
      return 'Vender. Distribución institucional detectada.';
    if (css.includes('signal-buy'))
      return 'Señal de compra confirmada.';
    if (css.includes('signal-sell'))
      return 'Señal de venta confirmada.';
    if (css.includes('signal-conflict'))
      return 'Señal conflictiva. Espera confirmación.';
    return 'Espera.';
  }

  // ── Determinar si la señal requiere interrupción inmediata ───────────────
  function isUrgent(css) {
    return css.includes('extreme') || css.includes('trap') ||
           css.includes('manipulation');
  }

  // ── Clave única para detectar cambio real de señal ───────────────────────
  // Combina clase + texto de voz para que "COMPRAR confirmado" y
  // "COMPRAR débil" no se traten como la misma señal.
  function signalKey(el) {
    const css   = el.className || '';
    const voice = el.getAttribute('data-voice') || '';
    const cls   = css.replace('main-signal', '').trim();
    return cls + '||' + voice;
  }

  // ── Hook llamado desde update() ───────────────────────────────────────────
  function onUpdate(el) {
    if (!enabled || !el) return;
    const key = signalKey(el);
    if (key === lastSignalKey) return;   // misma señal exacta — no repetir
    lastSignalKey = key;
    const text = resolveText(el);
    say(text, isUrgent(el.className || ''));
  }

  // ── Toggle ────────────────────────────────────────────────────────────────
  function toggle() {
    enabled = !enabled;
    synth.cancel();
    lastSignalKey = '';

    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.classList.toggle('voice-on', enabled);
      btn.innerHTML = enabled ? '🔊 VOZ' : '🔇 VOZ';
      btn.title     = enabled ? 'Desactivar voz' : 'Activar voz';
    }

    if (enabled) {
      const el = document.getElementById('main-signal');
      if (el) {
        lastSignalKey = signalKey(el);
        say(resolveText(el));
      }
    }
  }

  return { toggle, onUpdate };

})();

// ── Hook en update() ─────────────────────────────────────────────────────────
// Pasa el elemento completo (no solo la clase) para poder leer data-voice.
window.addEventListener('load', () => {
  if (typeof update === 'function') {
    const _orig = update;
    window.update = function () {
      _orig.apply(this, arguments);
      const el = document.getElementById('main-signal');
      if (el) Voice.onUpdate(el);
    };
  }
});
