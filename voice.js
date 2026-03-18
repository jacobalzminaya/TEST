// ===== VOICE.JS — Narrador natural de señales =====

const Voice = (() => {

  const synth = window.speechSynthesis;
  let enabled       = false;
  let lastSignalKey = '';
  let bestVoice     = null;

  // ── Selección de voz femenina natural ────────────────────────────────────
  // Orden de preferencia: Neural/Natural > Google > Microsoft > sistema
  // Nombres femeninos conocidos tienen bonus extra
  function loadVoice() {
    const voices = synth.getVoices();
    const ranked = voices
      .filter(v => v.lang.startsWith('es'))
      .sort((a, b) => {
        const score = v => {
          let s = 0;
          const n = v.name.toLowerCase();
          // Calidad de síntesis
          if (n.includes('neural'))     s += 50;
          if (n.includes('natural'))    s += 45;
          if (n.includes('premium'))    s += 40;
          if (n.includes('enhanced'))   s += 35;
          if (n.includes('google'))     s += 25;
          if (n.includes('microsoft'))  s += 18;
          // Nombres femeninos en español — suenan más cálidos
          if (n.includes('paulina'))    s += 40;
          if (n.includes('mónica') || n.includes('monica'))  s += 38;
          if (n.includes('laura'))      s += 36;
          if (n.includes('valentina'))  s += 35;
          if (n.includes('camila'))     s += 34;
          if (n.includes('sofia') || n.includes('sofía'))    s += 33;
          if (n.includes('lucia') || n.includes('lucía'))    s += 32;
          if (n.includes('elena'))      s += 31;
          if (n.includes('sara'))       s += 30;
          if (n.includes('maria') || n.includes('maría'))    s += 29;
          if (n.includes('isabela') || n.includes('isabella')) s += 28;
          if (n.includes('fernanda'))   s += 28;
          // Región — preferir América Latina (más neutral)
          if (v.lang === 'es-US') s += 12;
          if (v.lang === 'es-MX') s += 10;
          if (v.lang === 'es-CO') s += 9;
          if (v.lang === 'es-AR') s += 8;
          if (v.lang === 'es-ES') s += 5;
          return s;
        };
        return score(b) - score(a);
      });
    bestVoice = ranked[0] || null;
    if (bestVoice) console.log('🎙 Voz seleccionada:', bestVoice.name, bestVoice.lang);
  }

  loadVoice();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoice;

  // ── Hablar ────────────────────────────────────────────────────────────────
  // rate  0.82 = más pausado, más humano (0.88 era un poco acelerado)
  // pitch 1.10 = ligeramente agudo, femenino sin sonar artificial
  // Las comas y puntos en el texto crean pausas naturales
  function say(text, interrupt = false) {
    if (!enabled || !text) return;
    if (interrupt) synth.cancel();
    const utt    = new SpeechSynthesisUtterance(text);
    utt.voice    = bestVoice || null;
    utt.lang     = bestVoice?.lang || 'es-MX';
    utt.rate     = 0.82;
    utt.pitch    = 1.10;
    utt.volume   = 1.0;
    synth.speak(utt);
  }

  // ── Tabla de mensajes — frases naturales, como una analista real ─────────
  // Cada clase tiene su frase. Las comas crean pausas de respiración.
  // Evitar imperativos secos ("Compra") — usar frases descriptivas.
  const MESSAGES = {
    // Señales de compra — de mayor a menor confianza
    'signal-extreme-buy':
      'Atención. Sobreventa extrema confirmada. El mercado está listo para rebotar.',
    'signal-strong-reversal-buy':
      'Reversión alcista fuerte. Dos o más rojas previas y ahora verde con fuerza. Señal de entrada.',
    'signal-accumulation':
      'Acumulación institucional detectada. El dinero inteligente está comprando. Señal de compra.',
    'signal-buy':
      'Señal de compra confirmada. Dos condiciones alineadas.',
    'signal-buy-weak':
      'Posible compra, pero confianza media. Verifica el contexto antes de entrar.',

    // Señales de venta — de mayor a menor confianza
    'signal-extreme-sell':
      'Atención. Sobrecompra extrema confirmada. El mercado está listo para caer.',
    'signal-strong-reversal-sell':
      'Reversión bajista fuerte. Dos o más verdes previas y ahora roja con fuerza. Señal de salida.',
    'signal-distribution':
      'Distribución institucional detectada. El dinero inteligente está vendiendo. Señal de venta.',
    'signal-sell':
      'Señal de venta confirmada. Dos condiciones alineadas.',
    'signal-sell-weak':
      'Posible venta, pero confianza media. Verifica el contexto antes de entrar.',

    // Esperar
    'signal-extreme-wait':
      'Mercado en extremo. No operes todavía. Espera la corrección.',
    'signal-caution':
      'Precaución. Estás en una zona límite. Poco recorrido en esa dirección.',
    'signal-conflict':
      'Señales contradictorias. El mercado no es claro. Espera confirmación.',
    'signal-manipulation':
      'Posible manipulación detectada. El movimiento puede ser una trampa. No entres.',
    'signal-trap':
      'Cuidado. Este movimiento parece una trampa. Espera la siguiente vela.',
    'signal-wait':
      'Sin señal clara. Espera.',
  };

  // ── Resolver qué mensaje leer ────────────────────────────────────────────
  // 1. Leer data-voice si existe (texto específico del logic.js)
  // 2. Si no, usar la tabla de mensajes naturales por clase
  // 3. Fallback: limpiar el signalText visible
  function resolveText(el) {
    const css       = el.className || '';
    const dataVoice = el.getAttribute('data-voice');

    // data-voice existe y no es genérico → usarlo directamente
    if (dataVoice && dataVoice.trim() &&
        !dataVoice.includes('confirmado') &&   // evitar los genéricos cortos
        dataVoice.length > 20) {
      return dataVoice.trim();
    }

    // Mapear clase CSS → clave del mensaje
    if (css.includes('signal-extreme')) {
      // Distinguir si la señal es de compra, venta o espera según data-voice
      const dv = (dataVoice || '').toLowerCase();
      if (dv.includes('comprar') || dv.includes('sobreventa'))
        return MESSAGES['signal-extreme-buy'];
      if (dv.includes('vender') || dv.includes('sobrecompra'))
        return MESSAGES['signal-extreme-sell'];
      return MESSAGES['signal-extreme-wait'];
    }
    if (css.includes('signal-strong-reversal')) {
      const dv = (dataVoice || '').toLowerCase();
      return dv.includes('vender') || dv.includes('bajista')
        ? MESSAGES['signal-strong-reversal-sell']
        : MESSAGES['signal-strong-reversal-buy'];
    }
    if (css.includes('signal-accumulation'))  return MESSAGES['signal-accumulation'];
    if (css.includes('signal-distribution'))  return MESSAGES['signal-distribution'];
    if (css.includes('signal-buy-weak'))      return MESSAGES['signal-buy-weak'];
    if (css.includes('signal-sell-weak'))     return MESSAGES['signal-sell-weak'];
    if (css.includes('signal-buy'))           return MESSAGES['signal-buy'];
    if (css.includes('signal-sell'))          return MESSAGES['signal-sell'];
    if (css.includes('signal-caution'))       return MESSAGES['signal-caution'];
    if (css.includes('signal-manipulation'))  return MESSAGES['signal-manipulation'];
    if (css.includes('signal-trap'))          return MESSAGES['signal-trap'];
    if (css.includes('signal-conflict'))      return MESSAGES['signal-conflict'];

    return MESSAGES['signal-wait'];
  }

  // ── Urgencia: interrumpir lo que se esté diciendo ────────────────────────
  function isUrgent(css) {
    return css.includes('extreme') ||
           css.includes('trap')    ||
           css.includes('manipulation');
  }

  // ── Clave única: clase + data-voice para detectar cambios reales ─────────
  function signalKey(el) {
    const cls   = (el.className || '').replace('main-signal', '').trim();
    const voice = el.getAttribute('data-voice') || '';
    return cls + '||' + voice;
  }

  // ── Llamado en cada update() ─────────────────────────────────────────────
  function onUpdate(el) {
    if (!enabled || !el) return;
    const key = signalKey(el);
    if (key === lastSignalKey) return;
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
      // Al activar, leer la señal actual inmediatamente
      const el = document.getElementById('main-signal');
      if (el) {
        lastSignalKey = signalKey(el);
        // Pequeño delay para que el browser inicialice el sintetizador
        setTimeout(() => say(resolveText(el)), 300);
      }
    }
  }

  return { toggle, onUpdate };

})();

// ── Sincronización con update() ──────────────────────────────────────────────
// Espera a que logic.js cargue y parchea update() para pasar el elemento completo
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
