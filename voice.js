// ===== VOICE.JS — Narrador natural de señales =====

const Voice = (() => {

  const synth = window.speechSynthesis;
  let enabled       = false;
  let lastSignalKey = '';
  let bestVoice     = null;
  let voiceReady    = false;

  // ── Selección de voz ─────────────────────────────────────────────────────
  // Estrategia: intentar varias veces hasta tener voces cargadas,
  // luego elegir la mejor femenina/natural disponible.
  function loadVoice() {
    const all    = synth.getVoices();
    const esVoices = all.filter(v => v.lang.startsWith('es'));

    // Si no hay voces españolas, intentar con cualquier voz
    const pool = esVoices.length > 0 ? esVoices : all;
    if (pool.length === 0) return; // aún cargando

    const scored = pool.map(v => {
      let s = 0;
      const n = v.name.toLowerCase();

      // ── Calidad de síntesis (lo más importante) ──────────────────────────
      if (n.includes('neural'))              s += 100;
      if (n.includes('natural'))             s += 90;
      if (n.includes('premium'))             s += 80;
      if (n.includes('enhanced'))            s += 70;
      if (n.includes('wavenet'))             s += 85;  // Google WaveNet
      if (n.includes('studio'))             s += 75;

      // ── Motor de síntesis ────────────────────────────────────────────────
      if (n.includes('google'))              s += 30;
      if (n.includes('amazon'))              s += 25;
      if (n.includes('microsoft'))           s += 20;
      if (n.includes('apple'))               s += 18;

      // ── Nombres femeninos en español ─────────────────────────────────────
      const femNames = [
        'paulina','mónica','monica','laura','valentina','camila',
        'sofia','sofía','lucia','lucía','elena','sara','maria','maría',
        'isabela','isabella','fernanda','andrea','alejandra','carolina',
        'diana','gabriela','paloma','conchita','esperanza','lupe',
        'marisol','rocío','rocio','pilar','penelope','penélope',
      ];
      if (femNames.some(name => n.includes(name))) s += 50;

      // ── Excluir voces masculinas conocidas ───────────────────────────────
      const maleNames = [
        'jorge','carlos','miguel','juan','pedro','antonio','rafael',
        'diego','pablo','alberto','mario','roberto','sergio','jorge',
        'enrique','rodrigo','francisco','alejandro','felipe','daniel',
      ];
      if (maleNames.some(name => n.includes(name))) s -= 80;

      // ── Región ───────────────────────────────────────────────────────────
      if (v.lang === 'es-US') s += 12;
      if (v.lang === 'es-MX') s += 11;
      if (v.lang === 'es-CO') s += 10;
      if (v.lang === 'es-CL') s += 9;
      if (v.lang === 'es-AR') s += 8;
      if (v.lang === 'es-ES') s += 6;

      return { voice: v, score: s };
    });

    scored.sort((a, b) => b.score - a.score);
    bestVoice  = scored[0]?.voice || null;
    voiceReady = true;

    if (bestVoice) {
      console.log('🎙 Voz:', bestVoice.name, '|', bestVoice.lang, '| Score:', scored[0].score);
    }

    // Log de todas las voces en español para debug
    const esLog = scored.filter(x => x.voice.lang.startsWith('es'));
    if (esLog.length > 0) {
      console.log('📋 Voces ES disponibles:');
      esLog.forEach(x => console.log(' ', x.score, x.voice.name, x.voice.lang));
    }
  }

  // Intentar cargar inmediatamente y en onvoiceschanged
  loadVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoice;
  }
  // Algunos browsers (Safari, Firefox) necesitan un delay
  setTimeout(loadVoice, 500);
  setTimeout(loadVoice, 1500);

  // ── Hablar ────────────────────────────────────────────────────────────────
  // Parámetros calibrados para sonar más humano:
  // - rate 0.80: pausado, como quien habla con calma
  // - pitch 1.08: ligeramente femenino sin exagerar
  // - Las comas y puntos en el texto crean pausas naturales de respiración
  function say(text, interrupt = false, rateOverride = null) {
    if (!enabled || !text) return;
    if (interrupt) synth.cancel();

    // Si las voces aún no cargaron, esperar y reintentar
    if (!voiceReady) {
      setTimeout(() => say(text, interrupt, rateOverride), 600);
      return;
    }

    const utt    = new SpeechSynthesisUtterance(text);
    utt.voice    = bestVoice || null;
    utt.lang     = bestVoice?.lang || 'es-MX';
    utt.rate     = rateOverride ?? 0.80;
    utt.pitch    = 1.08;
    utt.volume   = 1.0;

    // Workaround para bug de Chrome donde la voz se cuelga después de ~15s
    utt.onend = () => { /* noop */ };
    synth.speak(utt);
  }

  // ── Mensajes naturales — como una analista hablando ─────────────────────
  // Frases con comas = pausas naturales al hablar
  // Evitar imperativos secos. Usar descripciones de lo que está pasando.
  const MESSAGES = {
    // ── Compra ────────────────────────────────────────────────────────────
    'signal-extreme-buy':
      'Atención. Sobreventa extrema. El mercado está en mínimos, con señal de rebote confirmada.',
    'signal-strong-reversal-buy':
      'Reversión alcista fuerte. Hay velas rojas previas y ahora una verde poderosa. Buena entrada.',
    'signal-accumulation':
      'Acumulación detectada. Las ballenas están comprando. Señal de compra con alta confianza.',
    'signal-buy':
      'Señal de compra. Dos condiciones alineadas hacia arriba.',
    'signal-buy-weak':
      'Posible compra, pero con confianza media. Verifica el contexto antes de entrar.',

    // ── Venta ─────────────────────────────────────────────────────────────
    'signal-extreme-sell':
      'Atención. Sobrecompra extrema. El mercado está en máximos, con señal de caída confirmada.',
    'signal-strong-reversal-sell':
      'Reversión bajista fuerte. Hay velas verdes previas y ahora una roja poderosa. Señal de salida.',
    'signal-distribution':
      'Distribución detectada. Las ballenas están vendiendo. Señal de venta con alta confianza.',
    'signal-sell':
      'Señal de venta. Dos condiciones alineadas hacia abajo.',
    'signal-sell-weak':
      'Posible venta, pero con confianza media. Verifica el contexto antes de entrar.',

    // ── Esperar ───────────────────────────────────────────────────────────
    'signal-extreme-wait':
      'El mercado está sobreextendido. No entres en esta dirección. Espera la corrección.',
    'signal-caution':
      'Precaución. Estás cerca de un límite del rango. Hay poco recorrido en esa dirección.',
    'signal-conflict':
      'Señales contradictorias. El sistema no tiene claridad. Es mejor esperar.',
    'signal-manipulation':
      'Posible manipulación. Este movimiento puede ser una trampa institucional. No entres.',
    'signal-trap':
      'Cuidado. Este movimiento parece una trampa. Espera la siguiente vela para confirmar.',
    'signal-wait':
      'Sin señal por ahora. Esperando.',
  };

  // ── Resolver texto a leer ────────────────────────────────────────────────
  function resolveText(el) {
    const css = el.className || '';
    const dv  = (el.getAttribute('data-voice') || '').trim();
    const dvL = dv.toLowerCase();

    // Si data-voice tiene una frase larga y específica, usarla
    // (viene de logic.js con el contexto exacto del momento)
    if (dv.length > 25 &&
        !dv.includes('confirmado') &&
        !dv.includes('Esperar.') &&
        !dv.includes('Esperando')) {
      return dv;
    }

    // Mapear clase → clave de mensaje
    if (css.includes('signal-extreme')) {
      if (dvL.includes('comprar') || dvL.includes('sobreventa') || dvL.includes('rebote'))
        return MESSAGES['signal-extreme-buy'];
      if (dvL.includes('vender') || dvL.includes('sobrecompra') || dvL.includes('caída'))
        return MESSAGES['signal-extreme-sell'];
      return MESSAGES['signal-extreme-wait'];
    }
    if (css.includes('signal-strong-reversal')) {
      return (dvL.includes('vender') || dvL.includes('bajista'))
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

  // ── Urgencia ─────────────────────────────────────────────────────────────
  function isUrgent(css) {
    return css.includes('extreme') ||
           css.includes('trap')    ||
           css.includes('manipulation');
  }

  // ── Clave para detectar cambios reales de señal ──────────────────────────
  function signalKey(el) {
    const cls   = (el.className || '').replace('main-signal', '').trim();
    const voice = el.getAttribute('data-voice') || '';
    return cls + '||' + voice;
  }

  // ── onUpdate: llamado en cada ciclo de update() ──────────────────────────
  function onUpdate(el) {
    if (!enabled || !el) return;
    const key = signalKey(el);
    if (key === lastSignalKey) return;
    lastSignalKey = key;
    say(resolveText(el), isUrgent(el.className || ''));
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
        // Delay para que el sintetizador esté listo
        setTimeout(() => say(resolveText(el)), 400);
      }
    }
  }

  // ── API pública ───────────────────────────────────────────────────────────
  // listVoices(): para diagnosticar qué voces están disponibles
  function listVoices() {
    const voices = synth.getVoices().filter(v => v.lang.startsWith('es'));
    console.table(voices.map(v => ({ name: v.name, lang: v.lang, local: v.localService })));
    return voices.map(v => v.name);
  }

  return { toggle, onUpdate, listVoices };

})();

// ── Sincronización con update() de logic.js ──────────────────────────────────
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
