// ===== VOICE.JS — Narrador de señales en Español =====
// Lee en voz alta cada señal, lógica y alerta del detector.
// Se activa/desactiva con el botón 🔊 de la top-bar.

const Voice = (() => {

  // ── Estado interno ──────────────────────────────────────────────────────
  let enabled       = false;
  let lastSpoken    = '';       // evita repetir exactamente el mismo texto
  let lastSignal    = '';       // última señal (buy/sell/wait/etc.)
  let synth         = window.speechSynthesis;
  let spanishVoice  = null;
  let speakQueue    = [];
  let isSpeaking    = false;

  // ── Cargar voz española ─────────────────────────────────────────────────
  function loadVoice() {
    const voices = synth.getVoices();
    // Prioridad: es-MX > es-ES > cualquier es-*
    spanishVoice =
      voices.find(v => v.lang === 'es-MX') ||
      voices.find(v => v.lang === 'es-ES') ||
      voices.find(v => v.lang.startsWith('es')) ||
      null;
  }

  // Las voces pueden cargarse tarde en algunos navegadores
  loadVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoice;
  }

  // ── Limpiar emojis y símbolos para que no se lean ───────────────────────
  function cleanText(text) {
    return text
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')   // emojis
      .replace(/[⬆⬇🔥🎯📥🏦🔄⚠❓🪤✅🚫📊🎭🔻⏸]/gu, '')
      .replace(/[★☆►▼▲◆]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ── Convertir señal técnica a frase natural ─────────────────────────────
  function buildSpeech(signalType, signalText, logicText) {
    const clean = t => cleanText(t || '');

    // Frase principal según tipo de señal
    const prefixes = {
      'buy':      '¡Atención! Señal de COMPRA.',
      'sell':     '¡Atención! Señal de VENTA.',
      'wait':     'Esperar. Sin señal clara.',
      'trap':     '¡Cuidado! Posible trampa detectada.',
      'extreme':  '¡Alerta extrema!',
      'conflict': 'Conflicto de señales. Esperar.',
    };

    // Detectar tipo de señal por clase CSS o texto
    let tipo = 'wait';
    if (signalType.includes('buy')  || signalType.includes('accumulation') || signalType.includes('reversal')) tipo = 'buy';
    if (signalType.includes('sell') || signalType.includes('distribution')) tipo = 'sell';
    if (signalType.includes('trap') || signalType.includes('manipulation')) tipo = 'trap';
    if (signalType.includes('extreme')) tipo = 'extreme';
    if (signalType.includes('conflict')) tipo = 'conflict';

    const prefix  = prefixes[tipo] || prefixes['wait'];
    const sigClean = clean(signalText);
    const logClean = clean(logicText);

    // Frase completa
    let speech = prefix;
    if (sigClean && !sigClean.toLowerCase().includes('esperar')) {
      speech += ' ' + sigClean + '.';
    }
    if (logClean) {
      // Acortar si es muy largo (max 150 chars para no aburrir)
      const shortLogic = logClean.length > 150
        ? logClean.substring(0, 147) + '...'
        : logClean;
      speech += ' ' + shortLogic;
    }

    return speech;
  }

  // ── Cola de habla (evita solapamiento) ──────────────────────────────────
  function processQueue() {
    if (isSpeaking || speakQueue.length === 0) return;
    const text = speakQueue.shift();
    isSpeaking = true;

    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'es-MX';
    utt.rate   = 1.0;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    if (spanishVoice) utt.voice = spanishVoice;

    utt.onend = () => {
      isSpeaking = false;
      processQueue();
    };
    utt.onerror = () => {
      isSpeaking = false;
      processQueue();
    };

    synth.speak(utt);
  }

  function enqueue(text) {
    if (!text) return;
    speakQueue.push(text);
    processQueue();
  }

  // ── API pública ──────────────────────────────────────────────────────────

  /** Activar o desactivar el narrador */
  function toggle() {
    enabled = !enabled;
    updateButton();

    if (enabled) {
      enqueue('Narrador activado. Escucharás las señales en voz alta.');
      // Leer el estado actual inmediatamente
      readCurrentSignal();
    } else {
      synth.cancel();
      speakQueue  = [];
      isSpeaking  = false;
      enqueue('Narrador desactivado.');
    }
  }

  /** Llamado desde logic.js al final de update() — solo si hay cambio */
  function onSignalUpdate(signalClass, signalText, logicText) {
    if (!enabled) return;

    const key = signalClass + '|' + signalText + '|' + logicText;
    if (key === lastSpoken) return;   // sin cambios, no repetir
    lastSpoken = key;

    const speech = buildSpeech(signalClass, signalText, logicText);
    // Cancelar lo que se esté diciendo y decir lo nuevo (urgencia)
    synth.cancel();
    speakQueue  = [];
    isSpeaking  = false;
    enqueue(speech);
  }

  /** Lee la señal que esté en pantalla ahora mismo */
  function readCurrentSignal() {
    const mainSignalEl = document.getElementById('main-signal');
    const logicEl      = document.getElementById('logic-text');
    if (!mainSignalEl) return;

    const cls    = mainSignalEl.className || '';
    const sigTxt = mainSignalEl.innerText  || mainSignalEl.textContent || '';
    const logTxt = logicEl ? (logicEl.textContent || '') : '';

    const speech = buildSpeech(cls, sigTxt, logTxt);
    enqueue(speech);
  }

  /** Leer un texto libre (ej: alertas de trampa, CMD, etc.) */
  function speak(text) {
    if (!enabled || !text) return;
    enqueue(cleanText(text));
  }

  /** Actualiza el botón de la UI */
  function updateButton() {
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.toggle('voice-on', enabled);
    btn.title = enabled ? 'Desactivar narrador de voz' : 'Activar narrador de voz';
    btn.innerHTML = enabled ? '🔊 VOZ' : '🔇 VOZ';
  }

  /** ¿Está activo? */
  function isEnabled() { return enabled; }

  return { toggle, onSignalUpdate, speak, readCurrentSignal, isEnabled };

})();

// ── Hook automático en update() ──────────────────────────────────────────────
// Esperamos a que logic.js defina update(), luego lo envolvemos.
window.addEventListener('load', () => {
  // Parchear update() para que llame al narrador en cada ciclo
  if (typeof update === 'function') {
    const _origUpdate = update;
    window.update = function() {
      _origUpdate.apply(this, arguments);

      // Leer señal actualizada
      const mainEl  = document.getElementById('main-signal');
      const logicEl = document.getElementById('logic-text');
      if (mainEl && Voice.isEnabled()) {
        Voice.onSignalUpdate(
          mainEl.className || '',
          mainEl.innerText || mainEl.textContent || '',
          logicEl ? (logicEl.textContent || '') : ''
        );
      }
    };
  }

  // Parchear addCandle para anunciar cada vela agregada
  if (typeof addCandle === 'function') {
    const _origAdd = addCandle;
    window.addCandle = function(color) {
      _origAdd.apply(this, arguments);
      if (Voice.isEnabled()) {
        Voice.speak('Vela ' + (color === 'G' ? 'verde' : 'roja') + ' registrada.');
      }
    };
  }
});
