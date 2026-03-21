// ===== CONFIGURACIÓN =====
const MA_CONFIG = {
  crosses: [
    { fast: 2, slow: 10, name: 'MA2/MA10', type: 'agresivo' },
    { fast: 6, slow: 20, name: 'MA6/MA20', type: 'estandar' },
    { fast: 10, slow: 20, name: 'MA10/MA20', type: 'confirmado' }
  ],
  trend: { period: 10, name: 'MA10' }
};

const EXTREME_THRESHOLDS = {
  overbought: 90,
  bullish: 70,
  neutralHigh: 55,
  neutralLow: 45,
  bearish: 30,
  oversold: 10
};

const CMD_CONFIG = {
  consolidation: { minPeriods: 8, maxRange: 15, minTouches: 3, volumeDrop: 0.6 },
  manipulation: { spikeThreshold: 2.5, fakeoutReversal: 0.7, wickRatio: 0.6, institutionalWick: 3 },
  distribution: { topThreshold: 75, volumePattern: 'climax', divergencePeriods: 5, weaknessSignals: 3 },
  accumulation: { bottomThreshold: 25, springDetection: true, absorption: true }
};

const STRENGTH_CONFIG = {
  LEVELS: {
    1:   { name: 'DÉBIL',   icon: '▰',     color: '#888',         desc: 'Doji o indecisión — sin dirección clara' },
    1.5: { name: 'DÉBIL+',  icon: '▰',     color: '#aaa',         desc: 'Pequeño sesgo — Spinning Top o Doji sesgado' },
    2:   { name: 'MEDIA',   icon: '▰▰',    color: 'var(--gold)',  desc: 'Vela normal — cuerpo con mechas cortas' },
    2.5: { name: 'MEDIA+',  icon: '▰▰',    color: '#ffcc00',      desc: 'Vela con presión — Momentum o Mecha larga' },
    3:   { name: 'FUERTE',  icon: '▰▰▰',   color: 'var(--green)', desc: 'Marubozu o Reversión clara — poca mecha' },
    4:   { name: 'EXTREMA', icon: '▰▰▰🔥', color: '#00ffcc',      desc: 'Engulfing o capitulación — cuerpo enorme' }
  },
  VISUAL_MAP: { 1: 1, 1.5: 1, 2: 2, 2.5: 2, 3: 3, 4: 3 }
};

// ===== VARIABLES GLOBALES =====
let history = [];
let manualStrengths = {};
let manualTrapIndex = null;
let pendingTrapIndex = null;
let originalTrendMA = null;
let editingIndex = null;
let monitorWindow = null;
let focusModeActive = false;

let autoSuggestedStrength = 2;
let confirmedStrength = null;
let strengthOrigin = 'pending';

let cmdState = { phase: 'none', probability: 0, details: {}, lastUpdate: null };

// ===== BROADCAST CHANNEL — solo emisor =====
let bc = null;
if (typeof BroadcastChannel !== 'undefined') {
  bc = new BroadcastChannel('cmd-detector-vp');
}

// ===== EDICIÓN DE VELAS =====

function openEditPanel(index) {
  if (index === history.length - 1 && strengthOrigin === 'pending') {
    alert('Esta es la vela actual. Usa el panel superior para confirmar su fuerza.');
    return;
  }
  editingIndex = index;
  const currentStrength = getCandleStrength(index);
  document.getElementById('edit-index').textContent = index + 1;
  document.getElementById('edit-current').textContent = `${getStrengthLabel(currentStrength)} (${currentStrength})`;
  document.querySelectorAll('#edit-panel .edit-btn').forEach((btn, i) => {
    btn.classList.remove('selected');
    if (currentStrength === [1, 1.5, 2, 2.5, 3, 4][i]) btn.classList.add('selected');
  });
  document.getElementById('edit-panel').classList.add('show');
}

function closeEditPanel() {
  document.getElementById('edit-panel').classList.remove('show');
  editingIndex = null;
}

function confirmEditFromIndex(newStrength) {
  if (editingIndex === null) return;
  manualStrengths[editingIndex] = { strength: newStrength, origin: 'corrected', editedAt: Date.now() };
  broadcastEdit();
  update();
  closeEditPanel();
}

// ===== FUERZA — función unificada =====
// inferStrength(index) reemplaza calculateAutoStrength + calculateHistoricalStrength.
// index === history.length → próxima vela (sugerencia automática)
// index < history.length  → vela ya registrada sin fuerza manual

function inferStrength(index) {
  // Si hay un tipo de vela seleccionado en el picker, usarlo primero
  if (index === history.length &&
      typeof pickerTypeId !== 'undefined' && pickerTypeId &&
      typeof CANDLE_TYPES !== 'undefined') {
    const sel = CANDLE_TYPES.find(t => t.id === pickerTypeId);
    if (sel) return sel.strength;
  }

  // Necesitamos al menos 2 velas anteriores
  if (index < 2) return 2;

  const current = history[index] || history[history.length - 1]; // próxima vela: usa última
  const lookAt  = Math.min(index, history.length - 1);

  // Velas consecutivas iguales al color actual
  let consecutiveSame = 0;
  for (let i = lookAt - 1; i >= 0 && history[i] === current; i--) consecutiveSame++;

  // Velas consecutivas opuestas antes del actual
  let consecutiveOpposite = 0;
  for (let i = lookAt - 1; i >= 0 && history[i] !== current; i--) {
    if (consecutiveSame === 0) consecutiveOpposite++;
    else break;
  }

  const trendMA   = calcMA(10, true);
  const prevTrend = calcPrevMA(10, true);
  const maDir     = prevTrend !== null ? trendMA - prevTrend : 0;

  // Spike reciente: vela fuerte seguida de vela débil
  const recentStr = [];
  for (let i = Math.max(0, lookAt - 3); i <= lookAt; i++) recentStr.push(getCandleStrength(i) || 2);
  const hasSpike = recentStr.length >= 2 &&
    recentStr[recentStr.length - 2] >= 3 &&
    recentStr[recentStr.length - 1] <= 1.5;

  // Patrón doji: alternaciones frecuentes
  let alternations = 0;
  for (let i = Math.max(0, lookAt - 3); i < lookAt; i++) {
    if (history[i] !== history[i + 1]) alternations++;
  }
  const isDojiPattern = alternations >= 3;

  // Capitulación extrema
  if (consecutiveOpposite >= 4 && trendMA !== null) {
    const isExtreme = (trendMA >= 90 && current === 'R') || (trendMA <= 10 && current === 'G');
    if (isExtreme) return 4;
  }

  if (consecutiveOpposite >= 3) return 3;
  if (consecutiveOpposite === 2 && Math.abs(maDir) > 3) return 3;
  if (hasSpike && trendMA !== null && (trendMA >= 85 || trendMA <= 15)) return 3;

  if (consecutiveSame >= 3 && Math.abs(maDir) > 5) return 2.5;
  if (consecutiveSame >= 2 && Math.abs(maDir) > 8) return 2.5;

  if (consecutiveSame >= 2) return 2;
  if (consecutiveOpposite === 2) return 2;

  // Contexto histórico: reversión después de 2 seguidas
  if (index < history.length) {
    const prev  = history[index - 1];
    const prev2 = history[index - 2];
    if ((current === 'G' && prev === 'R' && prev2 === 'R') ||
        (current === 'R' && prev === 'G' && prev2 === 'G')) return 3;
    if (consecutiveSame >= 4) return 4;
    if (consecutiveSame >= 3) return 2.5;
    if (current === prev) return 2;
  }

  if (isDojiPattern && consecutiveSame >= 1) return 1.5;
  if (isDojiPattern || consecutiveOpposite === 1) return 1;

  return 2;
}

function getCandleStrength(index) {
  if (manualStrengths[index]) return manualStrengths[index].strength;
  return inferStrength(index);
}

function getCandleOrigin(index) {
  if (manualStrengths[index]) {
    const origins = { confirmed: '✓ Auto', corrected: '✏️ Manual', auto: 'Auto' };
    return origins[manualStrengths[index].origin] || 'Auto';
  }
  return 'Auto';
}

// ===== TENDENCIA — función unificada =====
// analyzeTrend() reemplaza analyzeRecentTrend + analyzeSwingContext.
// Ventana dinámica: usa 10 velas para calcular impulseRatio en la misma pasada.

function analyzeTrend() {
  const winShort = Math.min(5, history.length);
  const winLong  = Math.min(10, history.length);

  if (winShort < 2) return {
    trend: 'neutral', sequence: [], strengths: [], strength: 0,
    reason: 'Sin datos suficientes', weightedScore: 0
  };

  // ── WeightedScore sobre ventana corta (5) ───────────────────────────────
  const recentSlice = [];
  const recentStr   = [];
  for (let i = history.length - winShort; i < history.length; i++) {
    recentSlice.push(history[i]);
    recentStr.push(getCandleStrength(i) || 2);
  }

  let weightedScore = 0;
  for (let i = 0; i < recentSlice.length; i++) {
    const w = (recentSlice[i] === 'G' ? 1 : -1) * (recentStr[i] || 2) * ((i + 1) / recentSlice.length);
    weightedScore += w;
  }

  // Consecutivas
  let consG = 0, consR = 0, consStr = 0;
  for (let i = recentSlice.length - 1; i >= 0; i--) {
    const s = recentStr[i] || 2;
    if (recentSlice[i] === 'G') {
      if (consR === 0) { consG++; consStr += s; } else break;
    } else {
      if (consG === 0) { consR++; consStr += s; } else break;
    }
  }

  const lastTwo     = recentSlice.slice(-2);
  const lastTwoRed  = lastTwo[0] === 'R' && lastTwo[1] === 'R';
  const lastTwoGreen = lastTwo[0] === 'G' && lastTwo[1] === 'G';
  const isExtremeBull = consG >= 3 && consStr >= 6;
  const isExtremeBear = consR >= 3 && consStr >= 6;

  // ── ImpulseRatio sobre ventana larga (10) en la misma pasada ───────────
  let swingDir = null, swingStr = 0, maxG = 0, maxR = 0;
  for (let i = history.length - winLong; i < history.length; i++) {
    const c = history[i];
    const s = getCandleStrength(i) || 2;
    if (swingDir === null) { swingDir = c; swingStr = s; }
    else if (c === swingDir) { swingStr += s; }
    else {
      if (swingDir === 'G' && swingStr > maxG) maxG = swingStr;
      if (swingDir === 'R' && swingStr > maxR) maxR = swingStr;
      swingDir = c; swingStr = s;
    }
  }
  if (swingDir === 'G' && swingStr > maxG) maxG = swingStr;
  if (swingDir === 'R' && swingStr > maxR) maxR = swingStr;

  const impulseRatio = (maxG > 0 && maxR > 0) ? Math.max(maxG, maxR) / Math.min(maxG, maxR) : 1;
  const dominantDir  = maxG >= maxR ? 'bullish' : 'bearish';

  // Corrección en contra del impulso dominante
  const corrDir = dominantDir === 'bullish' ? 'R' : 'G';
  let corrCount = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === corrDir; i--) corrCount++;

  // ── Construir resultado ─────────────────────────────────────────────────
  if (isExtremeBull) return {
    trend: 'bullish', sequence: recentSlice, strengths: recentStr,
    strength: consG, reason: `${consG} verdes fuertes seguidas (fuerza total: ${consStr})`,
    weightedScore, isExtreme: true
  };
  if (isExtremeBear) return {
    trend: 'bearish', sequence: recentSlice, strengths: recentStr,
    strength: consR, reason: `${consR} rojas fuertes seguidas (fuerza total: ${consStr})`,
    weightedScore, isExtreme: true
  };
  if (consG >= 3) return { trend: 'bullish', sequence: recentSlice, strengths: recentStr, strength: consG, reason: `${consG} verdes seguidas`, weightedScore };
  if (consR >= 3) return { trend: 'bearish', sequence: recentSlice, strengths: recentStr, strength: consR, reason: `${consR} rojas seguidas`, weightedScore };

  // Conflictos momentum
  if (lastTwoRed && weightedScore > 2) return {
    trend: 'neutral', sequence: recentSlice, strengths: recentStr, strength: consR,
    reason: `Conflicto: Score +${weightedScore.toFixed(1)} pero últimas 2 rojas`,
    weightedScore, warning: 'momentum_change', detail: 'Momentum alcista pero cambiando'
  };
  if (lastTwoGreen && weightedScore < -2) return {
    trend: 'neutral', sequence: recentSlice, strengths: recentStr, strength: consG,
    reason: `Conflicto: Score ${weightedScore.toFixed(1)} pero últimas 2 verdes`,
    weightedScore, warning: 'momentum_change', detail: 'Momentum bajista pero cambiando'
  };

  // Corrección dentro de impulso dominante (antes requería llamar swingContext aparte)
  if (weightedScore > 3) {
    if (dominantDir === 'bearish' && impulseRatio >= 1.5) return {
      trend: 'neutral', sequence: recentSlice, strengths: recentStr, strength: 0,
      reason: `Corrección alcista dentro de impulso bajista (${maxR.toFixed(1)} vs ${maxG.toFixed(1)})`,
      weightedScore, warning: 'momentum_change',
      detail: `Impulso rojo ${impulseRatio.toFixed(1)}x más fuerte — posible retroceso, no reversión`
    };
    return { trend: 'bullish', sequence: recentSlice, strengths: recentStr, strength: Math.abs(weightedScore), reason: `Mayoría verde ponderada (+${weightedScore.toFixed(1)})`, weightedScore };
  }
  if (weightedScore < -3) {
    if (dominantDir === 'bullish' && impulseRatio >= 1.5) return {
      trend: 'neutral', sequence: recentSlice, strengths: recentStr, strength: 0,
      reason: `Corrección bajista dentro de impulso alcista (${maxG.toFixed(1)} vs ${maxR.toFixed(1)})`,
      weightedScore, warning: 'momentum_change',
      detail: `Impulso verde ${impulseRatio.toFixed(1)}x más fuerte — posible retroceso, no reversión`
    };
    return { trend: 'bearish', sequence: recentSlice, strengths: recentStr, strength: Math.abs(weightedScore), reason: `Mayoría roja ponderada (${weightedScore.toFixed(1)})`, weightedScore };
  }

  return { trend: 'neutral', sequence: recentSlice, strengths: recentStr, strength: 0, reason: 'Equilibrio o conflicto de fuerzas', weightedScore };
}

// Alias para compatibilidad con cualquier llamada legacy
const analyzeRecentTrend = analyzeTrend;

// ===== DETECCIÓN DE REVERSIÓN UNIFICADA =====
// detectReversal() reemplaza detectManipulation + detectPostCapitulationExhaustion
// + detectWyckoffPattern + detectCandleTrap como punto de entrada centralizado.
// Internamente delega a subfunciones especializadas, pero la búsqueda de cap4
// y el cálculo de probabilidad ocurren UNA SOLA VEZ en cada subfunción.

function detectReversal() {
  return {
    manipulation:  _detectManipulation(),
    exhaustion:    _detectExhaustion(),
    wyckoff:       _detectWyckoff(),
    candleTrap:    _detectCandleTrap()
  };
}

// ── Sub-detector: Manipulación (spike, fakeout, aceleración) ────────────
function _detectManipulation() {
  if (history.length < 3) return { probability: 0, details: {} };

  const lastThree = history.slice(-3);
  const strengths = lastThree.map((_, i) => getCandleStrength(history.length - 3 + i));
  const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  const max = Math.max(...strengths);
  const min = Math.min(...strengths);

  const capitulation    = max === 4 || (max >= 3 && min <= 1 && avg < 2);
  const spike           = max >= 3 && avg < 2.3;
  const accelerated     = strengths.includes(2.5) && strengths.filter(s => s >= 2).length >= 2;
  const biasedDoji      = strengths.includes(1.5) && (strengths[2] === 1.5 || strengths[1] === 1.5);
  const longWick        = _detectLongWick();
  const hiddenInst      = (strengths.includes(2.5) && strengths.includes(1.5)) || strengths.filter(s => s === 2.5).length >= 2;

  const lastTwo  = history.slice(-2);
  const prevThree = history.slice(-4, -1);
  let fakeout = false, fakeType = '', fakeIntensity = 0;

  if (prevThree.every(h => h === 'G') && lastTwo[0] === 'G' && lastTwo[1] === 'R') {
    const ps = prevThree.map((_, i) => getCandleStrength(history.length - 4 + i));
    const ls = getCandleStrength(history.length - 1);
    if (ps.every(s => s >= 2) && ls >= 2) { fakeout = true; fakeType = 'bull_trap'; fakeIntensity = 1; }
    if (ps.some(s => s >= 3) && ls <= 1.5) { fakeout = true; fakeType = 'bull_trap_capitulation'; fakeIntensity = 2; }
  }
  if (prevThree.every(h => h === 'R') && lastTwo[0] === 'R' && lastTwo[1] === 'G') {
    const ps = prevThree.map((_, i) => getCandleStrength(history.length - 4 + i));
    const ls = getCandleStrength(history.length - 1);
    if (ps.every(s => s >= 2) && ls >= 2) { fakeout = true; fakeType = 'bear_trap'; fakeIntensity = 1; }
    if (ps.some(s => s >= 3) && ls <= 1.5) { fakeout = true; fakeType = 'bear_trap_capitulation'; fakeIntensity = 2; }
  }

  let prob = 0;
  if (capitulation) prob += 0.5; else if (spike) prob += 0.35;
  if (fakeIntensity === 2) prob += 0.5; else if (fakeout) prob += 0.4;
  if (accelerated)   prob += 0.25;
  if (biasedDoji)    prob += 0.20;
  if (longWick.detected) prob += 0.25;
  if (hiddenInst)    prob += 0.15;
  if (cmdState.phase === 'consolidation') prob += 0.15;
  if (capitulation && calcMA(10, true) !== null) {
    const ma = calcMA(10, true);
    const last = history[history.length - 1];
    if ((last === 'G' && ma <= 20) || (last === 'R' && ma >= 80)) prob += 0.1;
  }

  let description = 'Sin manipulación clara';
  if (fakeIntensity === 2)       description = `🔥 CAPITULACIÓN: ${fakeType === 'bull_trap_capitulation' ? 'Trampa Alcista EXTREMA' : 'Trampa Bajista EXTREMA'} - Liquidación de stops institucional`;
  else if (fakeout)              description = `🎭 FALSO QUIEBRE: ${fakeType === 'bull_trap' ? 'Trampa Alcista' : 'Trampa Bajista'}`;
  else if (capitulation)         description = `⚡ CAPITULACIÓN: Spike ${max}/4 seguido de colapso (${min}) - Reversión violenta inminente`;
  else if (accelerated)          description = `🚀 MOMENTUM FORZADO: Aceleración artificial detectada`;
  else if (hiddenInst)           description = `🏦 ACTIVIDAD OCULTA: ${cmdState.phase === 'distribution' ? 'Distribución' : 'Acumulación'} institucional disimulada`;
  else if (biasedDoji)           description = `🕯️ DOJI FORZADO: Indecisión con sesgo - Posible preparación`;
  else if (spike)                description = `⚡ SPIKE: Fuerza ${max}/4 vs media ${avg.toFixed(1)} - Volatilidad anormal`;
  else if (longWick.detected)    description = `📍 RECHAZO INSTITUCIONAL: Mechas largas en ${longWick.type}`;

  return {
    probability: Math.min(prob, 0.95),
    details: { capitulation, spike, accelerated, biasedDoji, fakeout, fakeType, fakeIntensity, longWick, hiddenInst, avg: avg.toFixed(1), max, min },
    description,
    severity: fakeIntensity === 2 || capitulation ? 'critical' : fakeout || accelerated ? 'high' : spike || hiddenInst ? 'medium' : 'low'
  };
}

function _detectLongWick() {
  if (history.length < 3) return { detected: false };
  const recent = history.slice(-3);
  const strengths = recent.map((_, i) => getCandleStrength(history.length - 3 + i));
  return {
    detected: (strengths[0] >= 3 && strengths[1] <= 1) || (strengths.every(s => s === 1) && recent[0] !== recent[1] && recent[1] !== recent[2]),
    type: strengths[0] >= 3 && strengths[1] <= 1 ? 'spike_rejection' : 'double_rejection'
  };
}

// ── Sub-detector: Agotamiento post-capitulación ──────────────────────────
function _detectExhaustion() {
  if (history.length < 4) return { detected: false };

  let capIdx = -1, capDir = null;
  for (let i = history.length - 2; i >= Math.max(0, history.length - 8); i--) {
    if ((getCandleStrength(i) || 2) >= 4) { capIdx = i; capDir = history[i]; break; }
  }
  if (capIdx === -1) return { detected: false };

  const postSlice = history.slice(capIdx + 1);
  if (postSlice.length < 2) return { detected: false };

  const postStr = [];
  for (let i = capIdx + 1; i < history.length; i++) postStr.push(getCandleStrength(i) || 2);

  let sameDirCount = 0, oppositeCount = 0, oppMaxStr = 0;
  postSlice.forEach((c, i) => {
    if (c === capDir) sameDirCount++;
    else { oppositeCount++; if (postStr[i] > oppMaxStr) oppMaxStr = postStr[i]; }
  });

  const toleratedAR = oppositeCount <= 1 && oppMaxStr < 2.5;
  if (sameDirCount < 2 || !toleratedAR) return { detected: false };

  const capDirStr = postSlice.map((c, i) => c === capDir ? postStr[i] : 0).filter(s => s > 0);
  const avgPost = capDirStr.reduce((a, b) => a + b, 0) / capDirStr.length;
  const capStr  = getCandleStrength(capIdx) || 4;
  if (!(avgPost < 2.5 && capStr >= 4 && sameDirCount >= 2)) return { detected: false };

  const direction = capDir === 'R' ? 'bearish' : 'bullish';
  const arNote    = oppositeCount > 0 ? ' (con rebote débil intermedio)' : '';
  return {
    detected: true, direction, capIdx, postCount: postSlice.length, avgPostStr: avgPost,
    reason: `Cap fuerza ${capStr} hace ${postSlice.length} velas + continuación débil${arNote} (media ${avgPost.toFixed(1)}) — momentum ${direction === 'bearish' ? 'bajista' : 'alcista'} agotándose`
  };
}

// ── Sub-detector: Patrón Wyckoff (SC→AR→ST) ─────────────────────────────
function _detectWyckoff() {
  if (history.length < 6) return { detected: false };

  const win = Math.min(12, history.length);
  const wSlice = history.slice(-win);
  const wStr = [];
  for (let i = history.length - win; i < history.length; i++) wStr.push(getCandleStrength(i) || 2);

  for (let scOff = win - 3; scOff >= 1; scOff--) {
    const scStr = wStr[scOff];
    if (scStr < 3) continue;
    const scDir = wSlice[scOff];
    const scAbsIdx = history.length - win + scOff;

    // FIX1: contexto MA10
    if (scAbsIdx >= 10) {
      const ma10 = (history.slice(scAbsIdx - 9, scAbsIdx + 1).filter(c => c === 'G').length / 10) * 100;
      if (scDir === 'G' && ma10 < 50) continue;
      if (scDir === 'R' && ma10 > 55) continue;
    }

    // FIX4: no cap4 opuesta reciente
    const oppDir = scDir === 'R' ? 'G' : 'R';
    let hasOppCap = false;
    for (let i = Math.max(0, scAbsIdx - 15); i < scAbsIdx; i++) {
      if (history[i] === oppDir && (getCandleStrength(i) || 2) >= 4) { hasOppCap = true; break; }
    }
    if (hasOppCap) continue;

    // Buscar AR
    let arEnd = -1, arMaxStr = 0;
    for (let j = scOff + 1; j < win; j++) {
      if (wSlice[j] !== scDir && wStr[j] < 2.5) {
        if (wStr[j] > arMaxStr) arMaxStr = wStr[j];
        arEnd = j; break;
      } else if (wSlice[j] !== scDir) break;
    }
    if (arEnd === -1 || arMaxStr < 1.5) continue;

    // Buscar ST/UT
    let stIdx = -1, stStr = 0;
    for (let j = arEnd + 1; j < win; j++) {
      if (wSlice[j] === scDir && wStr[j] >= 1.5 && wStr[j] < scStr) { stIdx = j; stStr = wStr[j]; break; }
    }
    if (stIdx === -1 || stIdx - arEnd < 2) continue;

    const postST    = wSlice.slice(stIdx + 1);
    const postSTStr = wStr.slice(stIdx + 1);
    if (postST.length === 0) continue;
    const avgPost = postSTStr.reduce((a, b) => a + b, 0) / postSTStr.length;
    if (!postST.some(c => c !== scDir) && avgPost >= 2.5) continue;

    let conf = 0.62;
    if (scStr >= 4)         conf += 0.10;
    if (stStr < scStr - 1)  conf += 0.08;
    if (postST.length >= 2) conf += 0.05;
    if (postST.some(c => c !== scDir)) conf += 0.07;
    if (arMaxStr >= 2)      conf += 0.04;
    if (stIdx - arEnd >= 3) conf += 0.03;

    return { detected: true, type: scDir === 'R' ? 'accumulation' : 'distribution', scStr, stStr, confidence: Math.min(conf, 0.88) };
  }
  return { detected: false };
}

// ── Sub-detector: Trampa de vela (Bear/Bull Trap) ────────────────────────
function _detectCandleTrap() {
  if (history.length < 3) return null;

  const idx     = history.length - 1;
  const current = history[idx];
  const currStr = getCandleStrength(idx) || 2;
  const trendMA = calcMA(10, false);
  const opp     = current === 'G' ? 'R' : 'G';

  let consecOpp = 0, totalOppStr = 0, maxOppStr = 0;
  for (let i = idx - 1; i >= 0 && history[i] === opp; i--) {
    consecOpp++;
    const s = getCandleStrength(i) || 2;
    totalOppStr += s;
    if (s > maxOppStr) maxOppStr = s;
  }
  if (consecOpp < 2) return null;

  let prob = 0;
  const reasons = [];
  if (consecOpp >= 2) { prob += 0.20; reasons.push(`${consecOpp} velas ${opp === 'R' ? 'rojas' : 'verdes'} previas`); }
  if (consecOpp >= 3) prob += 0.15;
  if (consecOpp >= 4) prob += 0.10;
  if (maxOppStr >= 4) { prob += 0.25; reasons.push('Capitulación previa (fuerza 4)'); }
  else if (maxOppStr >= 3) { prob += 0.15; reasons.push('Vela fuerte previa (fuerza 3)'); }
  if (currStr <= 1)   { prob += 0.20; reasons.push('Vela actual muy débil (Doji)'); }
  else if (currStr <= 1.5) { prob += 0.15; reasons.push('Vela actual débil'); }
  else if (currStr === 2)  { prob += 0.08; reasons.push('Vela actual media'); }
  else if (currStr >= 3)   prob -= 0.25;

  if (trendMA !== null) {
    if (current === 'G' && trendMA <= 15) { prob += 0.15; reasons.push(`MA10 en sobreventa (${trendMA.toFixed(0)}%) — posible spring falso`); }
    if (current === 'R' && trendMA >= 85) { prob += 0.15; reasons.push(`MA10 en sobrecompra (${trendMA.toFixed(0)}%) — posible upthrust falso`); }
    if (current === 'G' && trendMA <= 30 && consecOpp >= 3) prob += 0.10;
    if (current === 'R' && trendMA >= 70 && consecOpp >= 3) prob += 0.10;
  }

  if (cmdState.phase === 'manipulation' && cmdState.probability > 0.5) { prob += 0.15; reasons.push(`Fase CMD: Manipulación (${Math.round(cmdState.probability * 100)}%)`); }
  if (cmdState.phase === 'accumulation' && current === 'G') prob -= 0.15;
  if (cmdState.phase === 'distribution' && current === 'R') prob -= 0.15;

  const ratio = currStr / (totalOppStr / consecOpp);
  if (ratio < 0.5) { prob += 0.10; reasons.push(`Reversión débil vs tendencia previa (ratio ${ratio.toFixed(1)}x)`); }

  prob = Math.max(0, Math.min(prob, 0.97));
  if (prob < 0.35) return null;

  const isBearTrap = current === 'G';
  const patStart   = Math.max(0, idx - Math.min(consecOpp, 5));
  const patCandles = [];
  for (let i = patStart; i <= idx; i++) patCandles.push({ color: history[i], strength: getCandleStrength(i) || 2, isTrigger: i === idx });

  let threatLevel, threatColor;
  if (prob >= 0.75)      { threatLevel = 'MUY ALTO'; threatColor = '#ff4444'; }
  else if (prob >= 0.60) { threatLevel = 'ALTO';     threatColor = '#ff8800'; }
  else if (prob >= 0.45) { threatLevel = 'MODERADO'; threatColor = '#ffd700'; }
  else                   { threatLevel = 'BAJO';     threatColor = '#aaa'; }

  return {
    detected: true,
    type: isBearTrap ? 'bear-trap' : 'bull-trap',
    typeLabel: isBearTrap ? '🐻 BEAR TRAP' : '🐂 BULL TRAP',
    subtitle: isBearTrap
      ? `Verde débil después de ${consecOpp} rojas — posible trampa alcista`
      : `Roja débil después de ${consecOpp} verdes — posible trampa bajista`,
    probability: prob, threatLevel, threatColor,
    consecOpposite: consecOpp, maxOppStr, currStr, reasons, patternCandles: patCandles,
    action: isBearTrap
      ? 'NO COMPRAR aún — esperar confirmación con segunda vela verde fuerte'
      : 'NO VENDER aún — esperar confirmación con segunda vela roja fuerte'
  };
}

// Wrapper de compatibilidad — usado directamente en update() y signal logic
function detectCandleTrap() { return _detectCandleTrap(); }

// ===== FUNCIONES MA =====

function calcMA(period, useOriginal = false) {
  if (history.length < period) return null;
  let data = history;
  if (!useOriginal && manualTrapIndex !== null && manualTrapIndex < history.length) {
    data = history.filter((_, idx) => idx !== manualTrapIndex);
    if (data.length < period) return null;
  }
  const slice = data.slice(-period);
  return (slice.filter(h => h === 'G').length / period) * 100;
}

function calcPrevMA(period, useOriginal = false) {
  let data = history;
  if (!useOriginal && manualTrapIndex !== null) {
    data = history.filter((_, idx) => idx !== manualTrapIndex);
  }
  if (data.length <= period) return null;
  const slice = data.slice(-period - 1, -1);
  return (slice.filter(h => h === 'G').length / period) * 100;
}

function calcShortMA() {
  if (history.length < 3) return null;
  let data = history;
  if (manualTrapIndex !== null && manualTrapIndex < history.length) {
    data = history.filter((_, idx) => idx !== manualTrapIndex);
    if (data.length < 3) return null;
  }
  return (data.slice(-3).filter(h => h === 'G').length / 3) * 100;
}

// ===== DETECCIÓN DE EXTREMO =====

function detectExtreme(trendMA, recentTrend) {
  const exhaustion = _detectExhaustion();
  if (exhaustion.detected) {
    const ma = trendMA !== null ? trendMA : 50;
    if (exhaustion.direction === 'bearish') {
      if (ma <= 35) return { type: 'extreme_bearish', level: trendMA, message: `AGOTAMIENTO BAJISTA: ${exhaustion.reason}. Alta probabilidad de reversión alcista.`, action: 'wait_buy', confidence: 0.75 };
      if (ma <= 55) return { type: 'warning_bearish', level: trendMA, message: `PAUSA BAJISTA: ${exhaustion.reason}. Posible rebote técnico (MA10 ${ma.toFixed(0)}%).`, action: 'caution', confidence: 0.55 };
    } else {
      if (ma >= 65) return { type: 'extreme_bullish', level: trendMA, message: `AGOTAMIENTO ALCISTA: ${exhaustion.reason}. Alta probabilidad de reversión bajista.`, action: 'wait_sell', confidence: 0.75 };
      if (ma >= 45) return { type: 'warning_bullish', level: trendMA, message: `PAUSA ALCISTA: ${exhaustion.reason}. Posible corrección técnica (MA10 ${ma.toFixed(0)}%).`, action: 'caution', confidence: 0.55 };
    }
  }

  if (history.length < 10) {
    let cG = 0, cR = 0, sG = 0, sR = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const s = getCandleStrength(i) || 2;
      if (history[i] === 'G') { if (cR > 0) break; cG++; sG += s; }
      else { if (cG > 0) break; cR++; sR += s; }
    }
    if (cG >= 5 && sG >= 8) return { type: 'extreme_bullish', level: trendMA, message: `SOBREEXTENSIÓN ALCISTA: ${cG} verdes consecutivas (fuerza ${sG.toFixed(1)}).`, action: 'wait_sell', confidence: 0.78 };
    if (cR >= 5 && sR >= 8) return { type: 'extreme_bearish', level: trendMA, message: `SOBREEXTENSIÓN BAJISTA: ${cR} rojas consecutivas (fuerza ${sR.toFixed(1)}).`, action: 'wait_buy', confidence: 0.78 };
  }

  const wyckoff = _detectWyckoff();
  if (wyckoff.detected) {
    if (wyckoff.type === 'accumulation') return { type: 'extreme_bearish', level: trendMA, message: `ACUMULACIÓN WYCKOFF: SC(fuerza ${wyckoff.scStr}🔥) → rebote débil → ST(fuerza ${wyckoff.stStr}). Reversión alcista probable.`, action: 'wait_buy', confidence: wyckoff.confidence };
    return { type: 'extreme_bullish', level: trendMA, message: `DISTRIBUCIÓN WYCKOFF: BC(fuerza ${wyckoff.scStr}🔥) → rebote débil → UT(fuerza ${wyckoff.stStr}). Reversión bajista probable.`, action: 'wait_sell', confidence: wyckoff.confidence };
  }

  if (trendMA === null) return null;

  const isExtrBull = trendMA >= EXTREME_THRESHOLDS.overbought && recentTrend.strength >= 4 && recentTrend.trend === 'bullish';
  const isExtrBear = trendMA <= EXTREME_THRESHOLDS.oversold   && recentTrend.strength >= 4 && recentTrend.trend === 'bearish';
  const momBull    = recentTrend.isExtreme && recentTrend.trend === 'bullish' && trendMA >= 70;
  const momBear    = recentTrend.isExtreme && recentTrend.trend === 'bearish' && trendMA <= 30;

  if (isExtrBull || momBull) {
    const src = momBull && !isExtrBull ? `momentum extremo (${recentTrend.strength} verdes fuertes)` : `MA10 al ${trendMA.toFixed(0)}%`;
    return { type: 'extreme_bullish', level: trendMA, message: `SOBRECOMPRA EXTREMA: ${src} con ${recentTrend.strength} velas verdes seguidas. Reversión bajista inminente.`, action: 'wait_sell', confidence: 0.85 };
  }
  if (isExtrBear || momBear) {
    const src = momBear && !isExtrBear ? `momentum extremo (${recentTrend.strength} rojas fuertes)` : `MA10 al ${trendMA.toFixed(0)}%`;
    return { type: 'extreme_bearish', level: trendMA, message: `SOBREVENTA EXTREMA: ${src} con ${recentTrend.strength} velas rojas seguidas. Reversión alcista inminente.`, action: 'wait_buy', confidence: 0.85 };
  }
  if (trendMA >= 80 && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) return { type: 'warning_bullish', level: trendMA, message: `Sobrecompra: MA10 al ${trendMA.toFixed(0)}%. Precaución con compras.`, action: 'caution', confidence: 0.60 };
  if (trendMA <= 20 && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) return { type: 'warning_bearish', level: trendMA, message: `Sobreventa: MA10 al ${trendMA.toFixed(0)}%. Oportunidad de compra cercana.`, action: 'caution', confidence: 0.60 };
  return null;
}

// ===== FUNCIONES CMD =====

function detectCMDPhase() {
  if (history.length < 5) return { phase: 'none', probability: 0, details: {} };
  const trendMA    = calcMA(10, true);
  const recentTrend = analyzeTrend();
  const currentCandle = analyzeCurrentCandle();
  const consolidation = detectConsolidation(trendMA, recentTrend);
  const manipulation  = _detectManipulation();
  const distribution  = detectDistribution(trendMA, recentTrend, currentCandle);
  const accumulation  = detectAccumulation(trendMA, recentTrend, currentCandle);
  const phases = [
    { name: 'consolidation', ...consolidation },
    { name: 'manipulation',  ...manipulation  },
    { name: 'distribution',  ...distribution  },
    { name: 'accumulation',  ...accumulation  }
  ].sort((a, b) => b.probability - a.probability);
  const dominant = phases[0];
  return { phase: dominant.probability > 0.4 ? dominant.name : 'none', probability: dominant.probability, details: dominant.details, allPhases: phases };
}

function detectConsolidation(trendMA, recentTrend) {
  if (history.length < CMD_CONFIG.consolidation.minPeriods) return { probability: 0, details: {} };
  const maValues = [];
  for (let i = CMD_CONFIG.consolidation.minPeriods; i > 0; i--) {
    const slice = history.slice(-i - 10, -i);
    if (slice.length >= 10) maValues.push((slice.filter(h => h === 'G').length / 10) * 100);
  }
  if (maValues.length < 3) return { probability: 0, details: {} };
  const range = Math.max(...maValues) - Math.min(...maValues);
  let touches = 0, lastDir = 0;
  for (let i = 1; i < maValues.length; i++) {
    const d = Math.sign(maValues[i] - maValues[i-1]);
    if (d !== 0 && d !== lastDir) { touches++; lastDir = d; }
  }
  let prob = 0;
  if (range < CMD_CONFIG.consolidation.maxRange) prob += 0.4;
  if (touches >= CMD_CONFIG.consolidation.minTouches) prob += 0.3;
  if (recentTrend.trend === 'neutral') prob += 0.2;
  if (Math.abs(recentTrend.weightedScore) < 2) prob += 0.1;
  if (range < 10 && history.length > 15) prob += 0.2;
  return { probability: Math.min(prob, 0.95), details: { range: range.toFixed(1), touches, isNarrow: range < CMD_CONFIG.consolidation.maxRange }, description: range < CMD_CONFIG.consolidation.maxRange ? `Rango estrecho: ${range.toFixed(1)}% | ${touches} toques` : 'Rango amplio' };
}

function detectDistribution(trendMA, recentTrend, currentCandle) {
  if (trendMA === null) return { probability: 0, details: {} };
  const isHighLevel = trendMA >= CMD_CONFIG.distribution.topThreshold;
  const divergence  = detectDivergence('bearish');
  const weakness    = countWeaknessSignals();
  const recent      = history.slice(-CMD_CONFIG.distribution.divergencePeriods);
  const greenCount  = recent.filter(h => h === 'G').length;
  const redStrength = recent.map((h, i) => ({ h, i: history.length - CMD_CONFIG.distribution.divergencePeriods + i })).filter(x => x.h === 'R').map(x => getCandleStrength(x.i)).reduce((a, b) => a + b, 0);
  const pattern     = greenCount >= 3 && redStrength >= 6;
  let prob = 0;
  if (isHighLevel) prob += 0.3;
  if (divergence.detected) prob += 0.25;
  if (weakness >= CMD_CONFIG.distribution.weaknessSignals) prob += 0.25;
  if (pattern) prob += 0.2;
  if (cmdState.phase === 'consolidation' && isHighLevel) prob += 0.15;
  return { probability: Math.min(prob, 0.95), details: { isHighLevel, divergence, weakness, pattern, greenCount, redStrength }, description: pattern ? `🏦 DISTRIBUCIÓN: ${greenCount} verdes débiles → rojas fuertes` : isHighLevel && divergence.detected ? `📉 Divergencia bajista en nivel alto (${trendMA.toFixed(0)}%)` : weakness >= 2 ? `⚠️ ${weakness} señales de debilidad` : 'Sin distribución clara' };
}

function detectAccumulation(trendMA, recentTrend, currentCandle) {
  if (trendMA === null) return { probability: 0, details: {} };
  const isLowLevel = trendMA <= CMD_CONFIG.accumulation.bottomThreshold;
  const divergence = detectDivergence('bullish');
  const spring     = detectSpring();
  const recent     = history.slice(-5);
  const redCount   = recent.filter(h => h === 'R').length;
  const greenStr   = recent.map((h, i) => ({ h, i: history.length - 5 + i })).filter(x => x.h === 'G').map(x => getCandleStrength(x.i)).reduce((a, b) => a + b, 0);
  const absorption = redCount >= 3 && greenStr >= 6;
  let prob = 0;
  if (isLowLevel) prob += 0.3;
  if (divergence.detected) prob += 0.25;
  if (spring.detected) prob += 0.3;
  if (absorption) prob += 0.15;
  return { probability: Math.min(prob, 0.95), details: { isLowLevel, divergence, spring, absorption, redCount, greenStr }, description: spring.detected ? `🌱 SPRING detectado: Falso quiebre con recuperación` : absorption ? `📥 ACUMULACIÓN: ${redCount} rojas débiles → verdes fuertes` : isLowLevel && divergence.detected ? `📈 Divergencia alcista en nivel bajo (${trendMA.toFixed(0)}%)` : 'Sin acumulación clara' };
}

function detectDivergence(type) {
  if (history.length < 6) return { detected: false };
  const recentMA = [], recentMom = [];
  for (let i = 5; i > 0; i--) {
    const slice = history.slice(-i - 10, -i);
    if (slice.length >= 10) {
      recentMA.push((slice.filter(h => h === 'G').length / 10) * 100);
      let mom = 0;
      history.slice(-i - 3, -i).forEach((h, idx) => {
        mom += (h === 'G' ? 1 : -1) * (getCandleStrength(history.length - i - 3 + idx) || 2);
      });
      recentMom.push(mom);
    }
  }
  if (recentMA.length < 3) return { detected: false };
  const maTrend  = recentMA[recentMA.length - 1] - recentMA[0];
  const momTrend = recentMom[recentMom.length - 1] - recentMom[0];
  const detected = type === 'bearish' ? (maTrend > 2 && momTrend < -2) : (maTrend < -2 && momTrend > 2);
  return { detected, maTrend: maTrend.toFixed(1), momTrend: momTrend.toFixed(1), strength: Math.abs(maTrend) + Math.abs(momTrend) };
}

function detectSpring() {
  if (history.length < 4) return { detected: false };
  const recent = history.slice(-4);
  if (!(recent[0] === 'R' && recent[1] === 'R' && recent[2] === 'R' && recent[3] === 'G')) return { detected: false };
  const strengths = recent.map((_, i) => getCandleStrength(history.length - 4 + i));
  return { detected: strengths[3] >= 3 && strengths[2] <= 2, pattern: recent.join(''), strength: strengths[3] };
}

function countWeaknessSignals() {
  let signals = 0;
  history.slice(-5).forEach((h, i) => {
    const s = getCandleStrength(history.length - 5 + i);
    if (h === 'G' && s < 2) signals += 0.5;
    if (h === 'R' && s >= 2) signals += 1;
    if (i > 0 && h !== history[history.length - 5 + i - 1]) signals += 0.3;
  });
  return Math.floor(signals);
}

// ===== ANÁLISIS VELA ACTUAL =====

function analyzeCurrentCandle() {
  if (history.length === 0) return { strength: 0, type: 'neutral', isReversal: false, origin: '-' };
  const idx     = history.length - 1;
  const current = history[idx];
  let strength  = getCandleStrength(idx); if (!strength) strength = 2;
  const origin  = getCandleOrigin(idx);
  let isReversal = false, type = 'normal';
  if (strength >= 3) { isReversal = true; type = strength === 4 ? 'capitulation' : 'strong-reversal'; }
  else if (strength === 2.5) type = 'strong-continuation';
  else if (strength === 2)   type = 'continuation';
  else if (strength === 1.5) type = 'biased-doji';
  else                       type = 'pure-doji';
  if (history.length >= 3) {
    const prev = history[idx-1], prev2 = history[idx-2];
    if (prev !== current && prev2 !== current) {
      isReversal = true;
      if (strength < 2.5) type = 'weak-reversal';
    }
  }
  return { strength, type, isReversal: isReversal && strength >= 2, current, origin, isCapitulation: strength === 4, isAccelerated: strength === 2.5 };
}

// ===== CRUCES MA =====

function getCrossCreatorMetrics(crossType, fastPeriod) {
  const n = Math.min(fastPeriod, history.length);
  const creatorSlice = history.slice(-n);
  const strengthSlice = [];
  for (let i = history.length - n; i < history.length; i++) strengthSlice.push(getCandleStrength(i) || 2);
  const avgStr    = strengthSlice.reduce((a, b) => a + b, 0) / n;
  const maxStr    = Math.max(...strengthSlice);
  const allWeak   = strengthSlice.every(s => s < 2);
  const anyStrong = strengthSlice.some(s => s >= 3);
  const expColor  = crossType === 'golden' ? 'G' : 'R';
  const allCorrectDir = creatorSlice.every(c => c === expColor);
  const last5 = history.slice(-5), last5str = [];
  for (let i = history.length - 5; i < history.length; i++) { if (i >= 0) last5str.push(getCandleStrength(i) || 2); }
  const oppColor = crossType === 'golden' ? 'R' : 'G';
  let oppForce = 0, ownForce = 0;
  last5.forEach((c, i) => { const s = last5str[i] || 2; if (c === oppColor) oppForce += s; else ownForce += s; });
  const forceRatio = ownForce > 0 ? oppForce / ownForce : 99;
  let recentCap = false;
  for (let i = history.length - 5; i < history.length; i++) {
    if (i >= 0 && history[i] === oppColor && (getCandleStrength(i) || 2) >= 4) { recentCap = true; break; }
  }
  return { avgStr, maxStr, allWeak, anyStrong, allCorrectDir, forceRatio, oppositeForce: oppForce, ownForce, recentCapitulation: recentCap };
}

function isTrap(crossType, trendMA, recentTrend, currentCandle, extremeCondition, fastPeriod = 2) {
  if (trendMA === null) return false;
  if (extremeCondition) {
    if (extremeCondition.type === 'extreme_bullish' && crossType === 'golden') return true;
    if (extremeCondition.type === 'extreme_bearish' && crossType === 'death')  return true;
  }
  if (currentCandle.isReversal && currentCandle.strength >= 3) return false;
  if (crossType === 'golden' && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) return true;
  if (crossType === 'death'  && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) return true;
  if (!(trendMA >= 45 && trendMA <= 55)) {
    if (crossType === 'golden' && trendMA < 35) return true;
    if (crossType === 'death'  && trendMA > 65) return true;
  }
  const cm = getCrossCreatorMetrics(crossType, fastPeriod);
  if (cm.allWeak) return true;
  if (cm.forceRatio > 1.8 && !cm.anyStrong) return true;
  if (cm.recentCapitulation && cm.avgStr < 2.5) return true;
  if (crossType === 'golden' && recentTrend.weightedScore < -0.5 && cm.avgStr < 2) return true;
  if (crossType === 'death'  && recentTrend.weightedScore > 0.5  && cm.avgStr < 2) return true;
  return false;
}

function detectCrosses(useOriginal = false) {
  const results   = [];
  const trendMA   = calcMA(MA_CONFIG.trend.period, useOriginal);
  const prevTrendMA = calcPrevMA(MA_CONFIG.trend.period, useOriginal);
  const recentTrend   = analyzeTrend();
  const currentCandle = analyzeCurrentCandle();
  const extremeCondition = detectExtreme(trendMA, recentTrend);

  for (let cfg of MA_CONFIG.crosses) {
    const maFast = calcMA(cfg.fast, useOriginal);
    const maSlow = calcMA(cfg.slow, useOriginal);
    if (maFast === null || maSlow === null) continue;
    let crossed = false, crossType = null, trap = false, trapReason = '';
    let data = history;
    if (!useOriginal && manualTrapIndex !== null) data = history.filter((_, idx) => idx !== manualTrapIndex);
    if (data.length > cfg.slow) {
      const prevFast = calcPrevMA(cfg.fast, useOriginal);
      const prevSlow = calcPrevMA(cfg.slow, useOriginal);
      if (prevFast !== null && prevSlow !== null) {
        if (prevFast <= prevSlow && maFast > maSlow) {
          crossed = true; crossType = 'golden';
          trap = isTrap('golden', trendMA, recentTrend, currentCandle, extremeCondition, cfg.fast);
          if (trap) {
            const cm = getCrossCreatorMetrics('golden', cfg.fast);
            if (cm.allWeak) trapReason = 'Velas creadoras débiles (doji)';
            else if (cm.recentCapitulation && cm.avgStr < 2.5) trapReason = 'Capitulación bajista reciente';
            else if (cm.forceRatio > 1.8) trapReason = `Presión bajista ${cm.forceRatio.toFixed(1)}x mayor`;
            else if (recentTrend.weightedScore < -0.5) trapReason = `Score ponderado bajista (${recentTrend.weightedScore.toFixed(1)})`;
            else trapReason = 'Tendencia en contra';
          }
        } else if (prevFast >= prevSlow && maFast < maSlow) {
          crossed = true; crossType = 'death';
          trap = isTrap('death', trendMA, recentTrend, currentCandle, extremeCondition, cfg.fast);
          if (trap) {
            const cm = getCrossCreatorMetrics('death', cfg.fast);
            if (cm.allWeak) trapReason = 'Velas creadoras débiles (doji)';
            else if (cm.recentCapitulation && cm.avgStr < 2.5) trapReason = 'Capitulación alcista reciente';
            else if (cm.forceRatio > 1.8) trapReason = `Presión alcista ${cm.forceRatio.toFixed(1)}x mayor`;
            else if (recentTrend.weightedScore > 0.5) trapReason = `Score ponderado alcista (${recentTrend.weightedScore.toFixed(1)})`;
            else trapReason = 'Tendencia en contra';
          }
        }
      }
    }
    results.push({ pair: cfg.name, type: cfg.type, maFast, maSlow, diff: maFast - maSlow, crossed, crossType, trap, trapReason, active: Math.abs(maFast - maSlow) < 5, isExtreme: maFast >= 90 || maSlow >= 90 || maFast <= 10 || maSlow <= 10 });
  }
  return { crosses: results, trendMA, prevTrendMA, recentTrend, currentCandle, extremeCondition };
}

// ===== OTRAS FUNCIONES DE ANÁLISIS =====

function getTrendLabel(currentValue, prevValue, extremeCondition = null) {
  if (extremeCondition?.type === 'extreme_bullish') return { text: '⚠️ EXTREMO ALCISTA', class: 'extreme-bullish', color: 'var(--red)', isExtreme: true, note: 'Reversión bajista inminente' };
  if (extremeCondition?.type === 'extreme_bearish') return { text: '⚠️ EXTREMO BAJISTA', class: 'extreme-bearish', color: 'var(--green)', isExtreme: true, note: 'Reversión alcista inminente' };
  if (prevValue === null || currentValue === null) {
    if (currentValue > 55) return { text: 'ALCISTA ↑', class: 'bullish', color: 'var(--green)', isExtreme: false };
    if (currentValue < 45) return { text: 'BAJISTA ↓', class: 'bearish', color: 'var(--red)', isExtreme: false };
    return { text: 'NEUTRAL →', class: 'neutral', color: 'var(--gold)', isExtreme: false };
  }
  const diff = currentValue - prevValue;
  const dir  = diff > 0 ? 'rising' : diff < 0 ? 'falling' : 'flat';
  if (dir === 'falling' && diff < -10) return { text: 'BAJISTA ↓↓', class: 'bearish', color: 'var(--red)', isExtreme: false, note: `Cayendo fuerte (${diff.toFixed(1)}%)` };
  if (dir === 'rising'  && diff > 10)  return { text: 'ALCISTA ↑↑', class: 'bullish', color: 'var(--green)', isExtreme: false, note: `Subiendo fuerte (+${diff.toFixed(1)}%)` };
  if (currentValue > 55 && dir === 'falling') return { text: 'ALCISTA ↓', class: 'weakening-bullish', color: 'var(--orange)', isExtreme: false, note: `Perdiendo fuerza (${diff.toFixed(1)}%)` };
  if (currentValue < 45 && dir === 'rising')  return { text: 'BAJISTA ↑', class: 'strengthening-bearish', color: 'var(--cyan)', isExtreme: false, note: `Ganando fuerza (+${diff.toFixed(1)}%)` };
  if (currentValue > 55) { const a = dir === 'rising' ? '↑' : dir === 'falling' ? '↗' : '→'; return { text: `ALCISTA ${a}`, class: 'bullish', color: 'var(--green)', isExtreme: false, note: dir !== 'flat' ? `Momentum: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Estable' }; }
  if (currentValue < 45) { const a = dir === 'falling' ? '↓' : dir === 'rising' ? '↘' : '→'; return { text: `BAJISTA ${a}`, class: 'bearish', color: 'var(--red)', isExtreme: false, note: dir !== 'flat' ? `Momentum: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Estable' }; }
  return { text: 'NEUTRAL →', class: 'neutral', color: 'var(--gold)', isExtreme: false, note: diff !== 0 ? `Cambiando: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Sin dirección clara' };
}

function analyzePattern(lastTwo, originalTwo = null, extremeCondition = null) {
  if (lastTwo.length < 2) return null;
  const [prev, curr] = lastTwo;
  const em = extremeCondition ? 0.3 : 1;
  const scenarios = {
    'GG': { ifG: { pat: 'GGG', sig: 'COMPRA', conf: 0.75 * em, desc: 'Continuación alcista' }, ifR: { pat: 'GGR', sig: 'VENTA', conf: 0.85, desc: 'Reversión bajista FUERTE' } },
    'RR': { ifG: { pat: 'RRG', sig: 'COMPRA', conf: 0.85, desc: 'Reversión alcista FUERTE' }, ifR: { pat: 'RRR', sig: 'VENTA', conf: 0.75 * em, desc: 'Continuación bajista' } },
    'GR': { ifG: { pat: 'GRG', sig: 'COMPRA', conf: 0.55 * em, desc: 'Reversión alcista' }, ifR: { pat: 'GRR', sig: 'VENTA', conf: 0.65, desc: 'Confirmación bajista' } },
    'RG': { ifG: { pat: 'RGG', sig: 'COMPRA', conf: 0.65, desc: 'Confirmación alcista' }, ifR: { pat: 'RGR', sig: 'VENTA', conf: 0.55 * em, desc: 'Reversión bajista' } }
  };
  return scenarios[prev + curr] || null;
}

// ===== PANEL CMD =====

function updateCMDPanel() {
  const cmd = detectCMDPhase();
  cmdState = cmd;
  if (!cmd.allPhases) cmd.allPhases = ['consolidation','manipulation','distribution','accumulation'].map(name => ({ name, probability: 0 }));

  const indicator = document.getElementById('cmd-phase-indicator');
  indicator.className = 'cmd-phase-indicator';
  if (cmd.phase !== 'none') indicator.classList.add(cmd.phase);

  const phaseNames = { consolidation: 'Consolidación', manipulation: 'Manipulación', distribution: 'Distribución', accumulation: 'Acumulación' };
  ['consolidation','manipulation','distribution','accumulation'].forEach(phase => {
    const phaseData = cmd.allPhases.find(p => p.name === phase);
    const item = document.getElementById('cmd-' + phase);
    const valEl = document.getElementById(phase + '-val');
    const probEl = document.getElementById(phase + '-prob');
    if (phaseData) {
      valEl.textContent  = phaseData.probability > 0.3 ? (phaseData.description ? phaseData.description.split(':')[0] : 'Detectado') : '--';
      probEl.textContent = Math.round(phaseData.probability * 100) + '%';
      item.classList.toggle('active', cmd.phase === phase);
    }
  });

  const alert = document.getElementById('cmd-alert');
  if (cmd.phase !== 'none') {
    alert.classList.add('active');
    const phaseData = cmd.allPhases.find(p => p.name === cmd.phase);
    document.getElementById('cmd-alert-title').textContent = `🎯 ${phaseNames[cmd.phase].toUpperCase()} DETECTADA (${Math.round(cmd.probability * 100)}%)`;
    document.getElementById('cmd-alert-text').textContent  = phaseData?.description || 'Actividad institucional detectada';
  } else { alert.classList.remove('active'); }

  const whale = document.getElementById('whale-activity');
  if (cmd.probability > 0.5) {
    whale.style.display = 'block';
    const map = { manipulation: [20,30,50], distribution: [50,35,15], accumulation: [15,25,60] };
    const [retail, smart, w] = map[cmd.phase] || [40,35,25];
    document.getElementById('whale-retail').style.width = retail + '%';
    document.getElementById('whale-smart').style.width  = smart + '%';
    document.getElementById('whale-whale').style.width  = w + '%';
  } else { whale.style.display = 'none'; }
}

function updateCandleTrapAlert() {
  const el   = document.getElementById('candle-trap-alert');
  const trap = _detectCandleTrap();
  if (!trap) { el.classList.remove('active', 'bear-trap', 'bull-trap'); return; }
  el.classList.remove('bear-trap', 'bull-trap');
  el.classList.add('active', trap.type);
  document.getElementById('trap-alert-icon').textContent    = '🪤';
  document.getElementById('trap-alert-title').textContent   = `⚠️ ${trap.typeLabel} — ${trap.threatLevel}`;
  document.getElementById('trap-alert-subtitle').textContent = trap.subtitle;
  document.getElementById('trap-type-value').textContent    = trap.typeLabel;
  document.getElementById('trap-type-value').style.color    = trap.threatColor;
  document.getElementById('trap-conf-value').textContent    = Math.round(trap.probability * 100) + '%';
  document.getElementById('trap-conf-value').style.color    = trap.threatColor;
  const seqEl = document.getElementById('trap-sequence-display');
  seqEl.innerHTML = trap.patternCandles.map((c, i) => {
    const strLabel = c.strength >= 3 ? '▰▰▰' : c.strength >= 2 ? '▰▰' : '▰';
    const arrow    = i < trap.patternCandles.length - 1 ? '<span class="trap-seq-arrow">›</span>' : '';
    return `<div class="trap-seq-candle ${c.color.toLowerCase()}${c.isTrigger ? ' trigger' : ''}" title="Fuerza ${c.strength}">${c.color}</div>${arrow}`;
  }).join('') + `<span class="trap-seq-label">← Vela trampa potencial</span>`;
  document.getElementById('trap-alert-reason').innerHTML = `<strong>Por qué es sospechosa:</strong> ${trap.reasons.join(' · ')}<br><strong style="color:var(--gold)">⚡ Acción:</strong> ${trap.action}`;
  document.getElementById('trap-confidence-fill').style.width = (trap.probability * 100) + '%';
}

// ===== PANEL DE CONFIRMACIÓN =====

function renderSuggestedCandleSVG(strength) {
  if (typeof CANDLE_TYPES === 'undefined') return;
  const typeMap = { 1: 'doji', 1.5: 'spinning', 2: 'normal', 2.5: 'momentum', 3: 'marubozu', 4: 'engulf' };
  const ct = CANDLE_TYPES.find(t => t.id === (typeMap[strength] || 'normal'));
  if (!ct) return;
  const svgG = document.getElementById('suggested-candle-svg-g');
  const svgR = document.getElementById('suggested-candle-svg-r');
  if (svgG) svgG.innerHTML = buildCandleSVG(ct, 'G');
  if (svgR) svgR.innerHTML = buildCandleSVG(ct, 'R');
}

function updateSuggestionPanel() {
  if (strengthOrigin !== 'pending') return;
  autoSuggestedStrength = inferStrength(history.length);
  const vs = STRENGTH_CONFIG.VISUAL_MAP[autoSuggestedStrength] || 2;
  const cfg = STRENGTH_CONFIG.LEVELS[autoSuggestedStrength];
  const barsEl = document.getElementById('suggestion-bars');
  const textEl = document.getElementById('suggestion-text');
  barsEl.textContent = cfg.icon;
  barsEl.className   = 'suggestion-strength strength-' + vs;
  barsEl.style.color = cfg.color;
  textEl.textContent = cfg.name;
  textEl.style.color = cfg.color;
  document.getElementById('suggestion-reason').textContent = cfg.desc;
  renderSuggestedCandleSVG(autoSuggestedStrength);
  const box = document.getElementById('suggestion-box');
  box.classList.remove('confirmed', 'corrected');
  document.getElementById('correction-notice').classList.remove('active');
  confirmedStrength = null;
  document.getElementById('status-bar').className   = 'status-bar status-pending';
  document.getElementById('status-bar').textContent = '⏳ PENDIENTE: Confirma o corrige la fuerza sugerida';
  document.getElementById('correction-options').style.display = 'block';
  document.getElementById('step-confirm').style.display = 'block';
}

function correctStrength(newStrength) {
  confirmedStrength = newStrength;
  strengthOrigin    = 'corrected';
  const vs  = STRENGTH_CONFIG.VISUAL_MAP[newStrength] || 2;
  const cfg = STRENGTH_CONFIG.LEVELS[newStrength];
  document.getElementById('suggestion-bars').textContent = cfg.icon;
  document.getElementById('suggestion-bars').className   = 'suggestion-strength strength-' + vs;
  document.getElementById('suggestion-bars').style.color = cfg.color;
  document.getElementById('suggestion-text').textContent = cfg.name;
  document.getElementById('suggestion-text').style.color = cfg.color;
  document.getElementById('suggestion-reason').textContent = cfg.desc;
  if (typeof pickerTypeId !== 'undefined' && pickerTypeId && typeof CANDLE_TYPES !== 'undefined') {
    const picked = CANDLE_TYPES.find(t => t.id === pickerTypeId);
    if (picked) {
      const svgG = document.getElementById('suggested-candle-svg-g');
      const svgR = document.getElementById('suggested-candle-svg-r');
      if (svgG) svgG.innerHTML = buildCandleSVG(picked, 'G');
      if (svgR) svgR.innerHTML = buildCandleSVG(picked, 'R');
    }
  } else renderSuggestedCandleSVG(newStrength);
  const box = document.getElementById('suggestion-box');
  box.classList.remove('confirmed'); box.classList.add('corrected');
  const notice = document.getElementById('correction-notice');
  notice.textContent = `✏️ Cambiado de ${STRENGTH_CONFIG.LEVELS[autoSuggestedStrength].name} a ${cfg.name}`;
  notice.classList.add('active');
  document.getElementById('status-bar').className   = 'status-bar status-corrected';
  document.getElementById('status-bar').textContent = `✏️ CORREGIDO: ${cfg.name} — ${cfg.desc}`;
  updatePickerConfirmBtn();
}

function addCandle(color) {
  if (confirmedStrength === null || confirmedStrength === undefined) {
    confirmedStrength = autoSuggestedStrength || 2;
    strengthOrigin = 'auto';
  }
  const validStrengths = [1, 1.5, 2, 2.5, 3, 4];
  if (!validStrengths.includes(confirmedStrength)) { confirmedStrength = 2; strengthOrigin = 'auto'; }

  const index = history.length;
  history.push(color);
  manualStrengths[index] = { strength: confirmedStrength, origin: strengthOrigin || 'auto', autoSuggested: autoSuggestedStrength, timestamp: Date.now(), color };

  broadcastEdit();
  resetConfirmationPanel();

  if (history.length > 30) {
    if (manualTrapIndex !== null) {
      manualTrapIndex = manualTrapIndex === 0 ? null : manualTrapIndex - 1;
    }
    const newStr = {};
    for (let i = 0; i < history.length; i++) { if (manualStrengths[i]) newStr[i - 1] = manualStrengths[i]; }
    manualStrengths = newStr;
    history.shift();
  }
  update();
}

function resetConfirmationPanel() {
  strengthOrigin    = 'pending';
  confirmedStrength = null;
  autoSuggestedStrength = 2;
  pickerColor    = null;
  pickerStrength = null;
  pickerTypeId   = null;
  const els = {
    'suggestion-box':      el => el.classList.remove('confirmed', 'corrected'),
    'correction-notice':   el => el.classList.remove('active'),
    'correction-options':  el => el.style.display = 'block',
    'color-buttons':       el => el.style.display = 'none',
    'step-confirm':        el => el.style.display = 'block'
  };
  Object.entries(els).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) fn(el); });
  updateSuggestionPanel();
}

// ===== ACTUALIZACIÓN PRINCIPAL =====

function update() {
  updateSuggestionPanel();
  updateCMDPanel();
  updateCandleTrapAlert();

  const adjustedResult = detectCrosses(false);
  const originalResult = detectCrosses(true);

  const shortMA     = calcShortMA();
  const prevShortMA = history.length > 3 ? (history.slice(-4, -1).filter(h => h === 'G').length / 3) * 100 : null;

  const trendMA        = adjustedResult.trendMA;
  const prevTrendMA    = adjustedResult.prevTrendMA;
  const recentTrend    = adjustedResult.recentTrend;
  const currentCandle  = adjustedResult.currentCandle;
  const extremeCondition = adjustedResult.extremeCondition;

  if (manualTrapIndex !== null && originalResult.trendMA !== null) originalTrendMA = originalResult.trendMA;

  // Extreme alert
  const extremeAlert = document.getElementById('extreme-alert');
  if (extremeCondition && (extremeCondition.type === 'extreme_bullish' || extremeCondition.type === 'extreme_bearish')) {
    extremeAlert.classList.add('active');
    document.getElementById('extreme-text').textContent = extremeCondition.message;
  } else extremeAlert.classList.remove('active');

  // Current candle analysis
  const currentAnalysis = document.getElementById('current-analysis');
  if (currentCandle.strength > 0) {
    currentAnalysis.classList.add('active');
    const bars = '▰'.repeat(Math.min(currentCandle.strength, 3)) + '▱'.repeat(Math.max(0, 3 - currentCandle.strength));
    document.getElementById('current-strength').innerHTML = `<span style="color:${currentCandle.strength>=3?'var(--green)':currentCandle.strength===2?'var(--gold)':'#888'}">${bars}</span>`;
    document.getElementById('current-origin').innerHTML = currentCandle.origin;
    const verdict = document.getElementById('current-verdict');
    if (currentCandle.isReversal && currentCandle.strength >= 3) {
      verdict.className = 'current-verdict verdict-strong-' + (currentCandle.current==='G'?'green':'red');
      verdict.innerHTML = `<strong>🔄 REVERSIÓN ${currentCandle.current==='G'?'ALCISTA':'BAJISTA'} FUERTE</strong><br><small>Fuerza ${currentCandle.strength}/3 - ${currentCandle.origin}</small>`;
    } else if (currentCandle.isReversal) {
      verdict.className = 'current-verdict verdict-weak';
      verdict.innerHTML = `<strong>Reversión ${currentCandle.current==='G'?'Alcista':'Bajista'}</strong><br><small>Fuerza ${currentCandle.strength}/3 - Esperar confirmación</small>`;
    } else {
      verdict.className = 'current-verdict verdict-weak';
      verdict.innerHTML = `<strong>${currentCandle.current==='G'?'Continuación Alcista':'Continuación Bajista'}</strong><br><small>Fuerza: ${currentCandle.strength}/3</small>`;
    }
  } else currentAnalysis.classList.remove('active');

  // Recent sequence
  const recentSequence = document.getElementById('recent-sequence');
  const recentAnalysis = document.getElementById('recent-analysis');
  if (recentTrend.sequence.length > 0) {
    recentSequence.innerHTML = recentTrend.sequence.map((c, i) => {
      const isLast = i === recentTrend.sequence.length - 1;
      const s = recentTrend.strengths[i] || 2;
      const ind = s >= 3 ? '▰▰▰' : s === 2 ? '▰▰' : '▰';
      return `<div class="recent-candle recent-candle-${c.toLowerCase()} ${isLast?'candle-new':''}" title="Fuerza: ${s}/3">${c}<span style="font-size:7px;position:absolute;bottom:2px;">${ind}</span></div>`;
    }).join('');
    let ac = 'recent-' + recentTrend.trend;
    if (recentTrend.isExtreme) ac = 'recent-extreme';
    else if (recentTrend.warning === 'momentum_change') ac = 'recent-conflict';
    else if (cmdState.phase !== 'none') ac = 'recent-cmd';
    recentAnalysis.className = 'recent-analysis ' + ac;
    recentAnalysis.innerHTML = `<strong>${recentTrend.reason}</strong>${recentTrend.detail?'<br><small>'+recentTrend.detail+'</small>':''}`;
  }

  // Momentum box
  const momentumBox = document.getElementById('momentum-box');
  if (trendMA !== null) {
    momentumBox.style.display = 'block';
    const fill = document.getElementById('momentum-fill');
    const diff = prevTrendMA !== null ? (trendMA - prevTrendMA).toFixed(1) : '0.0';
    document.getElementById('momentum-detail').textContent = `MA10: ${trendMA.toFixed(1)}% (${diff > 0 ? '+' : ''}${diff}%) | Fuerza sugerida: ${autoSuggestedStrength}/4`;
    fill.style.width = trendMA + '%';
    if (extremeCondition?.type === 'extreme_bullish') fill.className = 'momentum-fill extreme-bullish';
    else if (extremeCondition?.type === 'extreme_bearish') fill.className = 'momentum-fill extreme-bearish';
    else fill.className = 'momentum-fill ' + (trendMA > 55 ? 'bullish' : trendMA < 45 ? 'bearish' : 'neutral');
  } else momentumBox.style.display = 'none';

  // Trap banner
  const trapBanner = document.getElementById('trap-banner');
  const btnClearTrap = document.getElementById('btn-clear-trap');
  if (manualTrapIndex !== null) {
    trapBanner.classList.add('active');
    document.getElementById('trap-info').textContent = `#${manualTrapIndex + 1} (${history[manualTrapIndex]})`;
    btnClearTrap.style.display = 'block';
  } else {
    trapBanner.classList.remove('active');
    btnClearTrap.style.display = 'none';
    originalTrendMA = null;
  }

  // Trend box
  const trendBox = document.getElementById('trend-box');
  const trendValue = document.getElementById('trend-value');
  if (trendMA !== null) {
    const trend = getTrendLabel(trendMA, prevTrendMA, extremeCondition);
    trendBox.className = 'trend-box ' + trend.class + (manualTrapIndex !== null ? ' adjusted' : '');
    trendValue.textContent = trend.text;
    trendValue.style.color = trend.color;
    const noteEl = document.getElementById('momentum-note');
    if (trend.note) { noteEl.textContent = trend.note; noteEl.style.display = 'block'; }
    else noteEl.style.display = 'none';
  } else {
    trendBox.className = 'trend-box neutral' + (manualTrapIndex !== null ? ' adjusted' : '');
    trendValue.textContent = 'SIN DATOS';
    document.getElementById('momentum-note').style.display = 'none';
  }

  // Short trend box
  const shortTrendBox   = document.getElementById('short-trend-box');
  const shortTrendValue = document.getElementById('short-trend-value');
  if (shortMA !== null) {
    const shortDiff = prevShortMA !== null ? shortMA - prevShortMA : 0;
    let shortText = 'NEUTRAL →', shortClass = 'neutral', shortColor = 'var(--gold)', shortNote = '';
    if (shortMA > 66)      { shortText = shortDiff > 10 ? 'ALCISTA ↑↑' : 'ALCISTA ↑'; shortClass = 'bullish'; shortColor = 'var(--green)'; shortNote = shortDiff > 0 ? `(+${shortDiff.toFixed(1)}%)` : 'Estable'; }
    else if (shortMA < 34) { shortText = shortDiff < -10 ? 'BAJISTA ↓↓' : 'BAJISTA ↓'; shortClass = 'bearish'; shortColor = 'var(--red)';   shortNote = shortDiff < 0 ? `(${shortDiff.toFixed(1)}%)` : 'Estable'; }
    else { shortNote = shortDiff > 5 ? `Subiendo (+${shortDiff.toFixed(1)}%)` : shortDiff < -5 ? `Bajando (${shortDiff.toFixed(1)}%)` : 'Sin dirección'; }
    shortTrendBox.className   = 'trend-box ' + shortClass;
    shortTrendValue.textContent = shortText;
    shortTrendValue.style.color = shortColor;
    document.getElementById('short-momentum-note').textContent = shortNote;
  } else { shortTrendBox.className = 'trend-box neutral'; shortTrendValue.textContent = 'SIN DATOS'; }

  // MA grid
  const maResults  = adjustedResult.crosses;
  document.getElementById('ma-grid').innerHTML = maResults.map(r => {
    const isExtreme = r.maFast >= 90 || r.maSlow >= 90 || r.maFast <= 10 || r.maSlow <= 10;
    const trapLabel = r.trap && r.trapReason ? `⚠️ ${r.trapReason}` : r.trap ? '⚠️ TRAMPA' : '';
    return `<div class="ma-item ${r.crossed?'active':''} ${r.trap?'trap':''} ${isExtreme?'extreme':''}" title="${r.trap?r.trapReason:''}">
      <div class="ma-name">${r.pair}</div>
      <div class="ma-val ${r.diff>0?'ma-up':'ma-down'} ${isExtreme?'ma-extreme':''}">${r.maFast.toFixed(0)}|${r.maSlow.toFixed(0)}</div>
      <div style="font-size:0.65em;color:${r.trap?'var(--purple)':r.crossed?'var(--gold)':isExtreme?'var(--red)':'#666'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${trapLabel||(r.crossed?'✓ CRUCE':isExtreme?'EXTREMO':r.type)}</div>
    </div>`;
  }).join('');

  const activeCross = maResults.find(r => r.crossed && !r.trap) || maResults.find(r => r.crossed);
  if (activeCross && !extremeCondition) {
    document.getElementById('cross-alert').classList.add('show');
    document.getElementById('cross-pair').textContent = activeCross.pair;
    const typeEl = document.getElementById('cross-type');
    typeEl.textContent = activeCross.crossType === 'golden' ? 'GOLDEN CROSS' : 'DEATH CROSS';
    typeEl.className   = activeCross.crossType === 'golden' ? 'cross-type-golden' : 'cross-type-death';
  } else document.getElementById('cross-alert').classList.remove('show');

  // ========== SEÑAL PRINCIPAL ==========
  const mainSignal = document.getElementById('main-signal');
  const priorityExplanation = document.getElementById('priority-explanation');
  const logicExplanation    = document.getElementById('logic-explanation');

  let effectiveHistory = history;
  if (manualTrapIndex !== null) effectiveHistory = history.filter((_, idx) => idx !== manualTrapIndex);
  const lastTwo = effectiveHistory.slice(-2);
  const proj    = lastTwo.length >= 2 ? analyzePattern(lastTwo, null, extremeCondition) : null;

  let finalSignal = 'wait', signalClass = 'signal-wait', signalText = 'ESPERAR';
  let showReversal = false, showExtreme = false, showCMD = false, logicText = '';

  // PRIORIDAD 0: EXTREMO
  if (extremeCondition && (extremeCondition.type === 'extreme_bullish' || extremeCondition.type === 'extreme_bearish')) {
    showExtreme = true;
    if (extremeCondition.type === 'extreme_bullish') {
      const tc = _detectCandleTrap();
      const hasConflict = tc && tc.type === 'bull-trap' && tc.probability >= 0.75;
      if (currentCandle.current === 'R' && currentCandle.strength >= 2 && !hasConflict) {
        finalSignal = 'sell'; signalClass = 'signal-extreme'; signalText = '🔻 VENDER EXTREMO';
        logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA.toFixed(0)}%) + reversión bajista confirmada (fuerza ${currentCandle.strength}).`;
      } else if (hasConflict) {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Conflicto: Agotamiento alcista vs Bull Trap ${Math.round(tc.probability*100)}%. Esperar vela roja fuerte.`;
      } else {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 NO COMPRAR - EXTREMO';
        logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA.toFixed(0)}%). Cualquier compra es TRAMPA.`;
      }
    } else {
      const tc = _detectCandleTrap();
      const hasConflict = tc && tc.type === 'bear-trap' && tc.probability >= 0.75;
      if (currentCandle.current === 'G' && currentCandle.strength >= 2 && !hasConflict) {
        if (currentCandle.strength >= 2.5) {
          finalSignal = 'buy'; signalClass = 'signal-extreme'; signalText = '🔥 COMPRAR EXTREMO';
          logicText = `🚨 SOBREVENTA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) + reversión alcista confirmada (fuerza ${currentCandle.strength}).`;
        } else {
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ POSIBLE REBOTE';
          logicText = `⚠️ Sobreventa (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) + verde fuerza ${currentCandle.strength}. Esperar segunda vela verde.`;
        }
      } else if (hasConflict) {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Conflicto: Agotamiento bajista vs Bear Trap ${Math.round(tc.probability*100)}%. Esperar vela verde fuerte.`;
      } else {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 NO VENDER - EXTREMO';
        logicText = `🚨 SOBREVENTA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : '?'}%). Cualquier venta es TRAMPA.`;
      }
    }
  }

  // PRIORIDADES 2-6: solo si no hay extremo activo
  if (finalSignal === 'wait' && !showExtreme) {
    if (cmdState.phase === 'distribution' && cmdState.probability > 0.6) {
      const candleOk = currentCandle.current === 'R' && currentCandle.strength >= 2;
      const ma10Ok   = trendMA === null || trendMA <= 65;
      showCMD = true;
      if (candleOk && ma10Ok) {
        finalSignal = 'sell'; signalClass = 'signal-distribution'; signalText = '🏦 VENDER';
        logicText = `🏦 DISTRIBUCIÓN (${Math.round(cmdState.probability*100)}%) + vela roja fuerza ${currentCandle.strength}. Smart money vendiendo.`;
      } else if (ma10Ok) {
        finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '🏦 POSIBLE VENTA';
        logicText = `🏦 DISTRIBUCIÓN (${Math.round(cmdState.probability*100)}%) detectada. Esperar vela roja para confirmar.`;
      } else {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Distribución (${Math.round(cmdState.probability*100)}%) pero MA10 alcista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}.`;
      }
    } else if (cmdState.phase === 'accumulation' && cmdState.probability > 0.6) {
      const candleOk = currentCandle.current === 'G' && currentCandle.strength >= 2;
      const ma10Ok   = trendMA === null || trendMA >= 35;
      showCMD = true;
      if (candleOk && ma10Ok) {
        finalSignal = 'buy'; signalClass = 'signal-accumulation'; signalText = '📥 COMPRAR';
        logicText = `📥 ACUMULACIÓN (${Math.round(cmdState.probability*100)}%) + vela verde fuerza ${currentCandle.strength}. Smart money comprando.`;
      } else if (ma10Ok) {
        finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '📥 POSIBLE COMPRA';
        logicText = `📥 ACUMULACIÓN (${Math.round(cmdState.probability*100)}%) detectada. Esperar vela verde para confirmar.`;
      } else {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Acumulación (${Math.round(cmdState.probability*100)}%) pero MA10 bajista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}.`;
      }
    } else if (cmdState.phase === 'manipulation' && cmdState.probability > 0.7) {
      showCMD = true;
      finalSignal = 'wait'; signalClass = 'signal-manipulation'; signalText = '🎭 ESPERAR';
      logicText = `🎭 MANIPULACIÓN detectada (${Math.round(cmdState.probability * 100)}%). NO operar.`;

    // PRIORIDAD 3: REVERSIÓN FUERTE
    } else if (currentCandle.isReversal && currentCandle.strength >= 3) {
      showReversal = true;
      if (currentCandle.current === 'G') {
        let prevReds = 0;
        for (let i = history.length - 2; i >= 0 && history[i] === 'R'; i--) prevReds++;
        const genuine = prevReds >= 2 || (trendMA !== null && trendMA <= 50);
        if (genuine) { finalSignal = 'buy'; signalClass = 'signal-strong-reversal'; signalText = '🔄 COMPRAR FUERTE'; logicText = `🔄 Reversión alcista CONFIRMADA — ${prevReds} velas rojas previas + fuerza ${currentCandle.strength}.`; }
        else         { finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ CONTINÚA ALZA'; logicText = `📈 Verde fuerza ${currentCandle.strength} en tendencia alcista. Continuación.`; }
      } else {
        let prevGreens = 0;
        for (let i = history.length - 2; i >= 0 && history[i] === 'G'; i--) prevGreens++;
        const genuine = prevGreens >= 2 || (trendMA !== null && trendMA >= 50);
        if (genuine) { finalSignal = 'sell'; signalClass = 'signal-strong-reversal'; signalText = '🔄 VENDER FUERTE'; logicText = `🔄 Reversión bajista CONFIRMADA — ${prevGreens} velas verdes previas + fuerza ${currentCandle.strength}.`; }
        else         { finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ CONTINÚA BAJA'; logicText = `📉 Roja fuerza ${currentCandle.strength} en tendencia bajista. Continuación.`; }
      }

    // PRIORIDAD 4: CONFLICTO MOMENTUM
    } else if (recentTrend.warning === 'momentum_change') {
      finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
      logicText = `⚠️ Conflicto momentum: ${recentTrend.reason}.`;

    // PRIORIDAD 5: CRUCE VÁLIDO
    } else if (activeCross && !activeCross.trap) {
      if (trendMA >= 85 && activeCross.crossType === 'golden') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Golden Cross ignorado: MA10 al ${trendMA.toFixed(0)}% (cerca de extremo).`;
      } else if (trendMA <= 15 && activeCross.crossType === 'death') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Death Cross ignorado: MA10 al ${trendMA.toFixed(0)}% (cerca de extremo).`;
      } else if (activeCross.crossType === 'death') {
        const tc = detectCandleTrap();
        if (tc && tc.type === 'bear-trap' && tc.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Death Cross vs Bear Trap (${Math.round(tc.probability*100)}%). ${tc.action}`;
        } else if (trendMA !== null && trendMA <= 30) {
          finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ VENDER DÉBIL';
          logicText = `⚠️ Death Cross en ${activeCross.pair} pero MA10 al ${trendMA.toFixed(0)}% — cerca de sobreventa.`;
        } else {
          finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '✅ VENDER';
          logicText = `✅ Death Cross válido en ${activeCross.pair}. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%.`;
        }
      } else if (activeCross.crossType === 'golden') {
        const tc = detectCandleTrap();
        if (tc && tc.type === 'bull-trap' && tc.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Golden Cross vs Bull Trap (${Math.round(tc.probability*100)}%). ${tc.action}`;
        } else if (trendMA !== null && trendMA >= 70) {
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
          logicText = `⚠️ Golden Cross en ${activeCross.pair} pero MA10 al ${trendMA.toFixed(0)}% — cerca de sobrecompra.`;
        } else {
          finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '✅ COMPRAR';
          logicText = `✅ Golden Cross válido en ${activeCross.pair}. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%.`;
        }
      }

    // PRIORIDAD 6: PATRÓN + CONTEXTO
    } else if (proj && recentTrend.trend !== 'neutral') {
      const momentumOk = (recentTrend.trend === 'bullish' && trendMA > prevTrendMA) ||
                         (recentTrend.trend === 'bearish' && trendMA < prevTrendMA) ||
                         Math.abs(trendMA - prevTrendMA) < 5;

      if (recentTrend.isExtreme && trendMA === null) {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBREEXTENSIÓN';
        logicText = `⚠️ ${recentTrend.strength} velas ${recentTrend.trend === 'bullish' ? 'verdes' : 'rojas'} seguidas. No entrar en la dirección de la racha.`;
      } else if (recentTrend.isExtreme && recentTrend.trend === 'bullish') {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBRECOMPRA';
        logicText = `⚠️ ${recentTrend.strength} verdes seguidas. Esperar corrección.`;
      } else if (recentTrend.isExtreme && recentTrend.trend === 'bearish') {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBREVENTA';
        logicText = `⚠️ ${recentTrend.strength} rojas seguidas. Esperar rebote.`;
      } else if (!momentumOk && Math.abs(trendMA - prevTrendMA) > 10) {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Patrón detectado pero momentum en contra (${(trendMA - prevTrendMA).toFixed(1)}%).`;
      } else if (recentTrend.trend === 'bullish' && proj.ifG.sig === 'COMPRA') {
        const confPct = Math.round(proj.ifG.conf * 100);
        finalSignal = 'buy'; signalClass = confPct >= 70 ? 'signal-buy' : 'signal-buy-weak'; signalText = confPct >= 70 ? '⬆️ COMPRAR' : '⬆️ COMPRAR DÉBIL';
        logicText = `⬆️ Patrón ${proj.ifG.pat} alcista. Confianza: ${confPct}%`;
      } else if (recentTrend.trend === 'bearish' && proj.ifR.sig === 'VENTA') {
        const confPct = Math.round(proj.ifR.conf * 100);
        finalSignal = 'sell'; signalClass = confPct >= 70 ? 'signal-sell' : 'signal-sell-weak'; signalText = confPct >= 70 ? '⬇️ VENDER' : '⬇️ VENDER DÉBIL';
        logicText = `⬇️ Patrón ${proj.ifR.pat} bajista. Confianza: ${confPct}%`;
      } else {
        logicText = `🤔 Patrón en conflicto con tendencia. Esperando.`;
      }
    } else {
      logicText = `⏸️ Sin señales claras. MA10: ${trendMA ? trendMA.toFixed(0) + '%' : 'N/A'}`;
    }
  }

  // ── Safety nets finales ──────────────────────────────────────────────────
  if (extremeCondition) {
    if (extremeCondition.type === 'extreme_bearish' && finalSignal === 'sell') {
      finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 NO VENDER - EXTREMO';
      logicText = `🚨 SOBREVENTA EXTREMA (${trendMA ? trendMA.toFixed(0) : '?'}%). ${extremeCondition.message}`;
    }
    if (extremeCondition.type === 'extreme_bullish' && finalSignal === 'buy') {
      finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 NO COMPRAR - EXTREMO';
      logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA ? trendMA.toFixed(0) : '?'}%). ${extremeCondition.message}`;
    }
  }
  if (recentTrend.isExtreme && (finalSignal === 'buy' || finalSignal === 'sell')) {
    const rachaDir = recentTrend.trend === 'bullish' ? 'verdes' : 'rojas';
    if ((recentTrend.trend === 'bullish' && finalSignal === 'buy') || (recentTrend.trend === 'bearish' && finalSignal === 'sell')) {
      finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — RACHA EXTREMA';
      logicText = `🚨 ${recentTrend.strength} ${rachaDir} seguidas. Entrar en dirección de racha extrema tiene alta probabilidad de fallo.`;
    }
  }

  // Trampa de cruce
  if (activeCross && activeCross.trap && !showExtreme && recentTrend.warning !== 'momentum_change' && !showCMD && finalSignal !== 'wait') {
    signalClass = 'signal-trap'; signalText = activeCross.crossType === 'golden' ? '❓ ¿COMPRA?' : '❓ ¿VENTA?';
    logicText = `⚠️ ${activeCross.pair}: Cruce ${activeCross.crossType} es TRAMPA${activeCross.trapReason ? ' — ' + activeCross.trapReason : ''}.`;
    finalSignal = 'wait';
  }

  // Trampa de vela — bloqueo final
  const candleTrap = _detectCandleTrap();
  if (candleTrap && candleTrap.probability >= 0.60 && !showExtreme) {
    const trapBuy  = candleTrap.type === 'bear-trap';
    const trapSell = candleTrap.type === 'bull-trap';
    if ((finalSignal === 'buy' && trapBuy) || (finalSignal === 'sell' && trapSell)) {
      signalClass = 'signal-trap';
      const pct = Math.round(candleTrap.probability * 100);
      signalText = trapBuy ? `🪤 ¿COMPRA? (${pct}% TRAMPA)` : `🪤 ¿VENTA? (${pct}% TRAMPA)`;
      logicText  = `🪤 ${candleTrap.typeLabel} detectada (${pct}%). ${candleTrap.consecOpposite} velas previas fuerza máx ${candleTrap.maxOppStr}. ${candleTrap.action}`;
      finalSignal = 'wait';
    } else if (finalSignal === 'wait') {
      logicText += ` | 🪤 ${candleTrap.typeLabel} (${Math.round(candleTrap.probability * 100)}%)`;
    }
  }

  // ── Renderizado señal ────────────────────────────────────────────────────
  mainSignal.className = 'main-signal ' + signalClass;
  const badgeMap = {
    'manual-trap-badge':    signalClass === 'signal-trap' && manualTrapIndex !== null,
    'conflict-badge':       signalClass === 'signal-conflict',
    'reversal-badge':       signalClass === 'signal-strong-reversal',
    'extreme-signal-badge': signalClass === 'signal-extreme',
    'cmd-signal-badge':     signalClass === 'signal-accumulation' || signalClass === 'signal-distribution' || signalClass === 'signal-manipulation',
    'candle-trap-badge':    signalClass === 'signal-trap',
    'weak-buy-badge':       signalClass === 'signal-buy-weak' || signalClass === 'signal-sell-weak',
    'caution-badge':        signalClass === 'signal-caution',
  };
  mainSignal.innerHTML = signalText + Object.entries(badgeMap).map(([cls, show]) =>
    `<div class="${cls}" style="display:${show?'block':'none'}">${
      cls==='manual-trap-badge'?'TRAMPA ACTIVA':cls==='conflict-badge'?'⚠️ CONFLICTO':cls==='reversal-badge'?'🔄 REVERSIÓN FUERTE':cls==='extreme-signal-badge'?'🚨 EXTREMO':cls==='cmd-signal-badge'?'🎯 FASE CMD':cls==='candle-trap-badge'?'🪤 POSIBLE TRAMPA':cls==='weak-buy-badge'?'⚡ CONFIANZA MEDIA':cls==='caution-badge'?'🛑 PRECAUCIÓN':''
    }</div>`
  ).join('');

  const voiceTexts = {
    'signal-extreme':         finalSignal==='buy'?'Comprar extremo. Sobreventa confirmada.':'Vender extremo. Sobrecompra confirmada.',
    'signal-buy':             'Comprar confirmado.',
    'signal-sell':            'Vender confirmado.',
    'signal-buy-weak':        'Posible compra. Confianza media. Verifica antes de entrar.',
    'signal-sell-weak':       'Posible venta. Confianza media. Verifica antes de entrar.',
    'signal-caution':         'Precaución. Zona límite. No operes todavía.',
    'signal-strong-reversal': finalSignal==='buy'?'Comprar. Reversión fuerte confirmada.':'Vender. Reversión fuerte confirmada.',
    'signal-accumulation':    'Comprar. Acumulación institucional detectada.',
    'signal-distribution':    'Vender. Distribución institucional detectada.',
    'signal-conflict':        'Esperar. Señales contradictorias.',
    'signal-manipulation':    'Esperar. Manipulación detectada. No operes.',
    'signal-trap':            'Cuidado. Posible trampa.',
    'signal-wait':            'Esperando señal.',
  };
  const cleanFallback = signalText.replace(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[⬆️⬇️⚠️🔄🎯🔥📥🏦✅🚫🪤🎭🔻]/gu, '').trim();
  mainSignal.setAttribute('data-voice', voiceTexts[signalClass] || cleanFallback);

  const showCandleTrap = candleTrap && candleTrap.probability >= 0.60;
  priorityExplanation.classList.toggle('active', showReversal || showExtreme || recentTrend.warning === 'momentum_change' || showCMD || showCandleTrap);
  logicExplanation.classList.toggle('active', true);
  document.getElementById('logic-text').textContent = logicText;

  updateProjections(trendMA, prevTrendMA, activeCross, recentTrend, currentCandle, extremeCondition, proj);

  // Historial de velas
  document.getElementById('history').innerHTML = history.map((h, i) => {
    const isTrap = i === manualTrapIndex;
    const isNew  = i === history.length - 1;
    const s      = getCandleStrength(i) || 2;
    const origin = manualStrengths[i]?.origin || 'auto';
    let indicator = '', extraClass = '';
    if (s >= 4)      { indicator = '<span class="candle-strength strength-4-ind">4🔥</span>'; extraClass = 'candle-extreme'; }
    else if (s >= 3) { indicator = '<span class="candle-strength strength-3-ind">3</span>'; }
    else if (s >= 2.5){ indicator = '<span class="candle-strength strength-2-ind">2+</span>'; extraClass = 'candle-accelerated'; }
    else if (s >= 2) { indicator = '<span class="candle-strength strength-2-ind">2</span>'; }
    else if (s >= 1.5){ indicator = '<span class="candle-strength strength-1-ind">1+</span>'; }
    else              { indicator = '<span class="candle-strength strength-1-ind">1</span>'; }
    const manualMark = origin==='corrected'?'<span style="position:absolute;top:-3px;right:-3px;width:6px;height:6px;background:var(--orange);border-radius:50%;"></span>':origin==='confirmed'?'<span style="position:absolute;top:-3px;right:-3px;width:6px;height:6px;background:var(--green);border-radius:50%;"></span>':'';
    const strengthLabel = STRENGTH_CONFIG.LEVELS[s]?.name || 'MEDIA';
    return `<div class="candle candle-${h.toLowerCase()} ${isTrap?'candle-trap':''} ${isNew&&!isTrap?'candle-new':''} ${extraClass}" data-hover-idx="${i}" onclick="openEditPanel(${i})" title="Vela #${i+1}: ${h}, Fuerza: ${s}/4 (${strengthLabel}), Origen: ${origin}">${h}${indicator}${manualMark}</div>`;
  }).join('');
}

function updateProjections(trendMA, prevTrendMA, activeCross, recentTrend, currentCandle, extremeCondition, proj) {
  if (!proj) { document.getElementById('proj-g-seq').textContent = '--'; document.getElementById('proj-r-seq').textContent = '--'; return; }
  const s = getCandleStrength(history.length - 1);
  if (s === 4) {
    const cap = history[history.length - 1] === 'G' ? 'bullish' : 'bearish';
    document.getElementById(cap==='bullish'?'proj-g-extreme':'proj-r-extreme').textContent = '🔥 CAPITULACIÓN: Reversión ' + (cap==='bullish'?'alcista':'bajista') + ' inminente';
    document.getElementById(cap==='bullish'?'proj-g-extreme':'proj-r-extreme').style.display = 'block';
    document.getElementById(cap==='bullish'?'proj-r-extreme':'proj-g-extreme').style.display = 'none';
  } else { document.getElementById('proj-g-extreme').style.display='none'; document.getElementById('proj-r-extreme').style.display='none'; }
  if (s === 2.5) {
    const d = history[history.length - 1] === 'G' ? 'G' : 'R';
    if (d==='G') document.getElementById('proj-g-conf').textContent = (Math.round(proj.ifG.conf*100)+15)+'% (Momentum+)';
    else         document.getElementById('proj-r-conf').textContent = (Math.round(proj.ifR.conf*100)+15)+'% (Momentum+)';
  }
  if (s === 1.5) { document.getElementById('proj-g-conflict').textContent='⚠️ Doji sesgado: Esperar claridad'; document.getElementById('proj-r-conflict').textContent='⚠️ Doji sesgado: Esperar claridad'; }

  document.getElementById('proj-g-seq').textContent = proj.ifG.pat;
  let gSig=proj.ifG.sig, gClass=proj.ifG.sig==='COMPRA'?'proj-signal-buy':'proj-signal-hold', gBox='proj-box proj-green', gConf=Math.round(proj.ifG.conf*100)+'%';
  if (extremeCondition?.type==='extreme_bullish') { gSig='ESPERAR'; gClass='proj-signal-extreme'; gBox='proj-box proj-green proj-extreme'; gConf='0% - EXTREMO'; }
  else if (cmdState.phase==='distribution') { gSig='NO COMPRAR'; gClass='proj-signal-hold'; gBox='proj-box proj-green proj-conflict'; gConf='Distribución activa'; }
  else if (recentTrend.warning==='momentum_change' && recentTrend.weightedScore<0) { gSig='ESPERAR'; gClass='proj-signal-hold'; gBox='proj-box proj-green proj-conflict'; gConf='Conflicto momentum'; }
  document.getElementById('proj-g-sig').textContent=gSig; document.getElementById('proj-g-sig').className='proj-signal '+gClass;
  document.getElementById('proj-g-conf').textContent=gConf; document.getElementById('proj-g-reason').textContent=currentCandle.isReversal&&currentCandle.current==='G'&&currentCandle.strength>=3?'🔄 Reversión fuerza 3':'';
  document.getElementById('proj-g-reversal').textContent=currentCandle.isReversal&&currentCandle.current==='G'&&currentCandle.strength>=3?'Prioridad máxima':'';
  document.getElementById('proj-g-cmd').textContent=cmdState.phase==='distribution'?'🏦 DISTRIBUCIÓN: Smart money vendiendo':cmdState.phase==='accumulation'?'📥 ACUMULACIÓN: Posible entrada':'';
  document.getElementById('proj-g-box').className=gBox;

  document.getElementById('proj-r-seq').textContent = proj.ifR.pat;
  let rSig=proj.ifR.sig, rClass=proj.ifR.sig==='VENTA'?'proj-signal-sell':'proj-signal-hold', rBox='proj-box proj-red', rConf=Math.round(proj.ifR.conf*100)+'%';
  if (extremeCondition?.type==='extreme_bearish') { rSig='ESPERAR'; rClass='proj-signal-extreme'; rBox='proj-box proj-red proj-extreme'; rConf='0% - EXTREMO'; }
  else if (cmdState.phase==='accumulation') { rSig='NO VENDER'; rClass='proj-signal-hold'; rBox='proj-box proj-red proj-conflict'; rConf='Acumulación activa'; }
  else if (recentTrend.warning==='momentum_change' && recentTrend.weightedScore>0) { rSig='ESPERAR'; rClass='proj-signal-hold'; rBox='proj-box proj-red proj-conflict'; rConf='Conflicto momentum'; }
  document.getElementById('proj-r-sig').textContent=rSig; document.getElementById('proj-r-sig').className='proj-signal '+rClass;
  document.getElementById('proj-r-conf').textContent=rConf; document.getElementById('proj-r-reason').textContent=currentCandle.isReversal&&currentCandle.current==='R'&&currentCandle.strength>=3?'🔄 Reversión fuerza 3':'';
  document.getElementById('proj-r-reversal').textContent=currentCandle.isReversal&&currentCandle.current==='R'&&currentCandle.strength>=3?'Prioridad máxima':'';
  document.getElementById('proj-r-cmd').textContent=cmdState.phase==='accumulation'?'📥 ACUMULACIÓN: Smart money comprando':cmdState.phase==='distribution'?'🏦 DISTRIBUCIÓN: Posible salida':'';
  document.getElementById('proj-r-box').className=rBox;
}

// ===== UTILIDADES =====

function getStrengthLabel(strength) {
  return { 1:'DÉBIL', 1.5:'DÉBIL+', 2:'MEDIA', 2.5:'MEDIA+', 3:'FUERTE', 4:'EXTREMA' }[strength] || 'MEDIA';
}

function closeModal()   { document.getElementById('trap-modal').classList.remove('active'); pendingTrapIndex = null; }
function confirmTrap()  { if (pendingTrapIndex !== null) { manualTrapIndex = pendingTrapIndex; closeModal(); update(); } }
function clearTrap()    { manualTrapIndex = null; originalTrendMA = null; update(); }

function reset() {
  history = []; manualStrengths = {}; manualTrapIndex = null; pendingTrapIndex = null; originalTrendMA = null;
  cmdState = { phase: 'none', probability: 0, details: {} };
  autoSuggestedStrength = 2; confirmedStrength = null; strengthOrigin = 'pending';
  resetConfirmationPanel();
  document.getElementById('priority-explanation').classList.remove('active');
  document.getElementById('logic-explanation').classList.remove('active');
  document.getElementById('proj-g-extreme').style.display = 'none';
  document.getElementById('proj-r-extreme').style.display = 'none';
  closeModal();
  update();
}

// ===== SELECTOR VISUAL DE VELAS JAPONESAS =====

const CANDLE_TYPES = [
  { id:'doji',         strength:1,   shape:'normal',    label:'Doji',           sublabel:'Equilibrio puro',       body:[0.46,0.06], wickTop:0.40, wickBottom:0.40 },
  { id:'longleg',      strength:1,   shape:'longleg',   label:'Cruz',           sublabel:'Máx. indecisión' },
  { id:'spinning',     strength:1.5, shape:'spinning',  label:'Spinning Top',   sublabel:'Indec. con cuerpo',     bodyFrac:0.22, wickFrac:0.28 },
  { id:'hammer',       strength:2,   shape:'hammer',    label:'Martillo',       sublabel:'Rebote desde bajo',     bodyH:0.12, wickLen:0.68, topWick:0.04 },
  { id:'shootstar',    strength:2,   shape:'shootstar', label:'Estrella Fugaz', sublabel:'Rechazo desde alto',    bodyH:0.12, wickLen:0.68, bottomWick:0.04 },
  { id:'dragonfly',    strength:1.5, shape:'dragonfly', label:'Libélula',       sublabel:'Pin bar alcista' },
  { id:'gravestone',   strength:1.5, shape:'gravestone',label:'Lápida',         sublabel:'Pin bar bajista' },
  { id:'asymdown',     strength:2,   shape:'asymdown',  label:'Mecha abajo',    sublabel:'Cuerpo + cola ↓',       body:[0.10,0.44], wickTop:0.06, wickBottom:0.30 },
  { id:'normal',       strength:2,   shape:'normal',    label:'Normal',         sublabel:'Tendencia limpia',      body:[0.22,0.52], wickTop:0.13, wickBottom:0.13 },
  { id:'asymup',       strength:2,   shape:'asymup',    label:'Mecha arriba',   sublabel:'Cuerpo + cola ↑',       body:[0.46,0.44], wickTop:0.30, wickBottom:0.06 },
  { id:'doji-bias',    strength:1.5, shape:'normal',    label:'Doji Sesgado',   sublabel:'Ligera dirección',      body:[0.34,0.20], wickTop:0.28, wickBottom:0.26 },
  { id:'momentum',     strength:2.5, shape:'normal',    label:'Momentum',       sublabel:'Presión fuerte',        body:[0.14,0.64], wickTop:0.08, wickBottom:0.08 },
  { id:'marubozu',     strength:3,   shape:'normal',    label:'Marubozu',       sublabel:'Control total',         body:[0.06,0.82], wickTop:0.03, wickBottom:0.03 },
  { id:'engulf',       strength:4,   shape:'normal',    label:'Engulfing',      sublabel:'Capitulación',          body:[0.02,0.94], wickTop:0.01, wickBottom:0.01 },
  { id:'inv-hammer',   strength:2,   shape:'inv-hammer',label:'Martillo Inv.',  sublabel:'Rechazo desde bajo ↑',  bodyH:0.12, wickLen:0.68, bottomWick:0.04 },
  { id:'harami',       strength:1.5, shape:'harami',    label:'Harami',         sublabel:'Pausa dentro de rango', bodyFrac:0.16, wickFrac:0.12 },
  { id:'piercing',     strength:3,   shape:'piercing',  label:'Piercing / Nube',sublabel:'Penetra 50% anterior',  body:[0.18,0.58], wickTop:0.08, wickBottom:0.16 },
  { id:'doji-4price',  strength:1,   shape:'doji-4price',label:'Doji 4-Precio', sublabel:'Punto puro' },
  { id:'three-soldiers',strength:3,  shape:'normal',    label:'Three Soldiers', sublabel:'3ª vela confirmación',  body:[0.10,0.76], wickTop:0.04, wickBottom:0.06 },
  { id:'morning-star', strength:2.5, shape:'spinning',  label:'Estrella M/E',   sublabel:'Giro de 3 velas',       bodyFrac:0.14, wickFrac:0.26 },
];

let pickerColor = null, pickerStrength = null, pickerTypeId = null;

function initCandlePicker() {}
function buildSizePicker()  {}
function quickAddCandle(color, strength) { confirmedStrength = strength; strengthOrigin = 'corrected'; addCandle(color); }
function pickerDirectAdd(typeId, strength, color) { quickAddCandle(color, strength); }
function selectCandleType(typeId, strength) { pickerTypeId = typeId; pickerStrength = strength; correctStrength(strength); }
function setCandlePickColor(color) { pickerColor = color; }
function updatePickerConfirmBtn() {}
function addCandleFromPicker() { if (pickerColor && pickerStrength) quickAddCandle(pickerColor, pickerStrength); }

function buildPickerGrid(color) {
  const grid = document.getElementById('candle-picker-grid'); if (!grid) return;
  grid.innerHTML = CANDLE_TYPES.map(type => {
    const selG = pickerTypeId===type.id && pickerColor==='G', selR = pickerTypeId===type.id && pickerColor==='R';
    return `<div class="candle-type-row ${selG?'sel-g':selR?'sel-r':''}" id="crow-${type.id}">
      <div class="ctr-name"><div class="ctr-label">${type.label}</div><div class="ctr-sub">${type.sublabel}</div></div>
      <button class="ctr-btn ctr-g ${selG?'ctr-active-g':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'G')">${buildCandleSVG(type,'G')}<div class="ctr-btn-label">🟢</div></button>
      <button class="ctr-btn ctr-r ${selR?'ctr-active-r':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'R')">${buildCandleSVG(type,'R')}<div class="ctr-btn-label">🔴</div></button>
    </div>`;
  }).join('');
}

function buildCandleSVG(type, color) {
  const W=36, H=52, cx=W/2, bodyX=cx-6, bodyW=12;
  const fill=color==='G'?'#00ff88':'#ff4444', stroke=color==='G'?'#00cc66':'#cc2222';
  const filterId=`glow-${type.id}-${color}`;
  const filterDef=`<filter id="${filterId}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const mkBody=(bTop,bH)=>`<rect x="${bodyX}" y="${bTop.toFixed(1)}" width="${bodyW}" height="${Math.max(bH,2).toFixed(1)}" fill="${fill}" rx="2" filter="url(#${filterId})" opacity="0.93"/>`;
  const mkWick=(y1,y2)=>y1<y2-0.5?`<line x1="${cx}" y1="${y1.toFixed(1)}" x2="${cx}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/>`:'';
  let b='';
  const s=type.shape;
  if (s==='normal'||s==='asymup'||s==='asymdown') { const bt=type.body[0]*H, bh=type.body[1]*H; b=mkWick(type.wickTop*H,bt)+mkBody(bt,bh)+mkWick(bt+bh,(1-type.wickBottom)*H); }
  else if (s==='spinning'||s==='harami') { const mid=H*0.5, bh=(type.bodyFrac||0.22)*H, bt=mid-bh/2, wl=(type.wickFrac||0.28)*H; b=mkWick(bt-wl,bt)+mkBody(bt,bh)+mkWick(bt+bh,bt+bh+wl); }
  else if (s==='dragonfly') { const bt=H*0.05, bh=H*0.11; b=mkBody(bt,bh)+mkWick(bt+bh,H*0.94); }
  else if (s==='gravestone') { const bh=H*0.11, bt=H*0.84; b=mkWick(H*0.06,bt)+mkBody(bt,bh); }
  else if (s==='hammer')    { const bh=(type.bodyH||0.12)*H, bt=H*0.07; b=mkWick((type.topWick||0.02)*H,bt)+mkBody(bt,bh)+mkWick(bt+bh,Math.min(bt+bh+(type.wickLen||0.68)*H,H*0.97)); }
  else if (s==='shootstar') { const bh=(type.bodyH||0.12)*H, bt=H*0.81; b=mkWick(H*0.06,bt)+mkBody(bt,bh)+mkWick(bt+bh,Math.min(bt+bh+(type.bottomWick||0.04)*H,H*0.97)); }
  else if (s==='inv-hammer'){ const bh=(type.bodyH||0.12)*H, bt=H*0.81; b=mkWick(H*0.06,bt)+mkBody(bt,bh)+mkWick(bt+bh,Math.min(bt+bh+(type.bottomWick||0.04)*H,H*0.97)); }
  else if (s==='longleg')   { const mid=H*0.5, hw=9; b=`<line x1="${cx}" y1="${(H*0.06).toFixed(1)}" x2="${cx}" y2="${(mid-1).toFixed(1)}" stroke="${fill}" stroke-width="1.5" stroke-linecap="round"/><line x1="${(cx-hw).toFixed(1)}" y1="${mid}" x2="${(cx+hw).toFixed(1)}" y2="${mid}" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" filter="url(#${filterId})"/><line x1="${cx}" y1="${(mid+1).toFixed(1)}" x2="${cx}" y2="${(H*0.94).toFixed(1)}" stroke="${fill}" stroke-width="1.5" stroke-linecap="round"/>`; }
  else if (s==='piercing')  { const bt=type.body[0]*H, bh=type.body[1]*H; b=mkWick(type.wickTop*H,bt)+mkBody(bt,bh)+mkWick(bt+bh,(1-type.wickBottom)*H); }
  else if (s==='doji-4price'){ const mid=H*0.5, hw=5; b=`<line x1="${(cx-hw).toFixed(1)}" y1="${mid}" x2="${(cx+hw).toFixed(1)}" y2="${mid}" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" filter="url(#${filterId})"/>`; }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="candle-pick-svg"><defs>${filterDef}</defs>${b}</svg>`;
}

function buildPickerBadge(type, color) {
  const badges = {
    dragonfly:  color==='G'?'<span style="color:#00cc66;font-size:0.85em">↑ alcista</span>':'<span style="color:#888;font-size:0.85em">neutro</span>',
    gravestone: color==='R'?'<span style="color:#cc2222;font-size:0.85em">↓ bajista</span>':'<span style="color:#888;font-size:0.85em">neutro</span>',
    longleg:    '<span style="color:#888;font-size:0.85em">± neutro</span>',
    hammer:     color==='G'?'<span style="color:#00cc66;font-size:0.85em">Martillo ↑</span>':'<span style="color:#cc2222;font-size:0.85em">Colgado ↓</span>',
    shootstar:  color==='G'?'<span style="color:#888;font-size:0.85em">neutro</span>':'<span style="color:#cc2222;font-size:0.85em">Fuga ↓ techo</span>',
    asymdown:   color==='G'?'<span style="color:#00cc66;font-size:0.85em">rebote bajo</span>':'<span style="color:#888;font-size:0.85em">rechazo</span>',
    asymup:     color==='R'?'<span style="color:#cc2222;font-size:0.85em">rechazo alto</span>':'<span style="color:#888;font-size:0.85em">rechazo</span>',
    'inv-hammer': color==='G'?'<span style="color:#00cc66;font-size:0.85em">↑ alcista fondo</span>':'<span style="color:#cc2222;font-size:0.85em">↓ bajista techo</span>',
    harami:     color==='G'?'<span style="color:#00cc66;font-size:0.85em">pausa alcista</span>':'<span style="color:#cc2222;font-size:0.85em">pausa bajista</span>',
    piercing:   color==='G'?'<span style="color:#00cc66;font-size:0.85em">↑ penetra roja</span>':'<span style="color:#cc2222;font-size:0.85em">↓ cubre verde</span>',
    'doji-4price': '<span style="color:#888;font-size:0.85em">punto puro</span>',
  };
  if (badges[type.shape]) return badges[type.shape];
  if (type.id==='three-soldiers') return color==='G'?'<span style="color:#00cc66;font-size:0.85em">3 soldados ↑</span>':'<span style="color:#cc2222;font-size:0.85em">3 cuervos ↓</span>';
  if (type.id==='morning-star')   return color==='G'?'<span style="color:#00cc66;font-size:0.85em">estrella mañana</span>':'<span style="color:#cc2222;font-size:0.85em">estrella tarde</span>';
  return '';
}

// ===== BROADCAST — solo emisor =====

function broadcastEdit() {
  if (bc) {
    try {
      bc.postMessage({ type: 'strength-edited', payload: { manualStrengths, history, cmdState, timestamp: Date.now() } });
    } catch (e) { console.error('BroadcastChannel error:', e); }
  }
  try {
    localStorage.setItem('cmd-vp-data', JSON.stringify({ history, manualStrengths, cmdState, timestamp: Date.now() }));
  } catch (e) {}
  if (typeof monitorWindow !== 'undefined' && monitorWindow && !monitorWindow.closed) {
    try { monitorWindow.postMessage({ type: 'vp-update', payload: { history, manualStrengths, timestamp: Date.now() } }, '*'); } catch (e) {}
  }
}

// Escuchar ediciones desde el monitor
function setupEditListener() {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cmd-detector-vp') : null;
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type === 'strength-edited' && e.data.payload.manualStrengths) {
        manualStrengths = e.data.payload.manualStrengths;
        update();
      }
      if (e.data?.type === 'open-edit-panel') {
        const idx = e.data.payload?.index;
        if (idx !== undefined && idx >= 0 && idx < history.length) openEditPanel(idx);
      }
    };
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'cmd-vp-data') {
      try { const d = JSON.parse(e.newValue || '{}'); if (d.manualStrengths) { manualStrengths = d.manualStrengths; update(); } } catch(err) {}
    }
  });
}
setupEditListener();

// Atajos de teclado
document.addEventListener('keydown', (e) => {
  if (document.getElementById('edit-panel').style.display === 'block') { if (e.key === 'Escape') closeEditPanel(); return; }
  if (document.getElementById('trap-modal').classList.contains('active')) return;
  const key = e.key.toLowerCase();
  if (strengthOrigin === 'pending') {
    if (key==='1') correctStrength(1);   if (key==='2') correctStrength(1.5);
    if (key==='3') correctStrength(2);   if (key==='4') correctStrength(2.5);
    if (key==='5') correctStrength(3);   if (key==='6') correctStrength(4);
  } else {
    if (key==='g') { setCandlePickColor('G'); addCandle('G'); }
    if (key==='r') { setCandlePickColor('R'); addCandle('R'); }
  }
});

// ===== PRICE PICKER (stubs — implementación en index.html) =====
let ppRefPrice=null, ppMinPrice=null, ppMaxPrice=null, ppSpread=1;
function ppCenterRange(price) { ppRefPrice=price; ppMinPrice=parseFloat((price-ppSpread).toFixed(4)); ppMaxPrice=parseFloat((price+ppSpread).toFixed(4)); }
function ppRenderBar()    {}
function ppSetRef(val)    {}
function ppUpdateSpread() {}
function ppBarClick(e)    {}
function ppBarHover(e)    {}
function ppBarLeave()     {}
function ppRebuild()      { if (ppRefPrice!==null) ppCenterRange(ppRefPrice); }
function ppManualEnter()  {}
function ppProcessPrice(p) {
  if (typeof quickAddCandle==='function' && ppMinPrice!==null) {
    const range=ppMaxPrice-ppMinPrice, pct=range>0?Math.min(100,Math.abs(p-ppRefPrice)/range*100):0;
    const str=([[85,4],[65,3],[45,2.5],[25,2],[8,1.5],[0,1]].find(([min])=>pct>=min)||[0,1])[1];
    quickAddCandle(p>=ppRefPrice?'G':'R',str);
    ppCenterRange(p);
  }
}

// ===== MODO BOSTON =====
let bostonActive=false, bostonColor=null, bostonTypeId=null, bostonStr=null;

function toggleBoston() {
  bostonActive = !bostonActive;
  const overlay=document.getElementById('boston-overlay'), btn=document.getElementById('boston-btn-main');
  if (bostonActive) { overlay.classList.add('active'); btn.classList.add('active'); bostonColor=null; bostonTypeId=null; bostonStr=null; bostonRenderGrid(); bostonSyncSignal(); bostonSyncHistory(); }
  else { overlay.classList.remove('active'); btn.classList.remove('active'); }
}

function bostonSyncSignal() {
  const src=document.getElementById('main-signal'), dest=document.getElementById('boston-signal'), ctx=document.getElementById('boston-context'), logic=document.getElementById('logic-text');
  if (!src||!dest) return;
  dest.className=src.className.replace('main-signal','').trim()||'signal-wait';
  const clone=src.cloneNode(true); clone.querySelectorAll('div').forEach(d=>d.remove()); dest.textContent=clone.textContent.trim()||'ESPERAR';
  if (ctx&&logic) ctx.textContent=logic.textContent||'';
  const ids=['proj-g-sig','proj-g-conf','proj-r-sig','proj-r-conf'];
  const bids=['boston-proj-g-sig','boston-proj-g-conf','boston-proj-r-sig','boston-proj-r-conf'];
  ids.forEach((id,i)=>{ const el=document.getElementById(id); if(el) document.getElementById(bids[i]).textContent=el.textContent; });
  const gBox=document.getElementById('boston-proj-g'), rBox=document.getElementById('boston-proj-r');
  const gsig=document.getElementById('boston-proj-g-sig')?.textContent||'', rsig=document.getElementById('boston-proj-r-sig')?.textContent||'';
  if (gBox) gBox.style.borderColor=gsig.includes('COMPRA')?'var(--green)':gsig.includes('VENTA')?'var(--red)':'#333';
  if (rBox) rBox.style.borderColor=rsig.includes('VENTA')?'var(--red)':rsig.includes('COMPRA')?'var(--green)':'#333';
}

function bostonSyncHistory() {
  const container=document.getElementById('boston-history'); if (!container) return;
  const last=history.slice(-15);
  container.innerHTML=last.map((h,i)=>{
    const absIdx=history.length-last.length+i, s=getCandleStrength(absIdx)||2;
    const label=s>=4?'4🔥':s>=3?'3':s>=2.5?'2+':s>=2?'2':s>=1.5?'1+':'1';
    return `<div style="width:26px;height:26px;border-radius:4px;background:${h==='G'?'var(--green)':'var(--red)'};color:${h==='G'?'#000':'#fff'};display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;font-weight:bold;cursor:default;" title="Vela #${absIdx+1}: ${h} fuerza ${s}">${h}<span style="font-size:7px;opacity:0.8">${label}</span></div>`;
  }).join('');
}

function bostonRenderGrid() {
  const grid=document.getElementById('boston-candle-grid'); if (!grid) return;
  grid.innerHTML=CANDLE_TYPES.map(type=>{
    const selG=bostonTypeId===type.id&&bostonColor==='G', selR=bostonTypeId===type.id&&bostonColor==='R';
    const sc=STRENGTH_CONFIG.LEVELS[type.strength]||STRENGTH_CONFIG.LEVELS[2];
    return `<div class="candle-type-row ${selG?'sel-g':selR?'sel-r':''}">
      <div class="ctr-name"><div class="ctr-label">${type.label}</div><div class="ctr-sub">${type.sublabel}</div></div>
      <div class="ctr-strength" title="Fuerza: ${sc.name} (${type.strength})"><div style="font-size:0.75em;letter-spacing:1px;color:${sc.color};font-weight:bold;">${sc.icon}</div><div style="font-size:0.6em;color:${sc.color};white-space:nowrap;">${sc.name}</div><div style="font-size:0.55em;color:#555;">${type.strength}/4</div></div>
      <button class="ctr-btn ctr-g ${selG?'ctr-active-g':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'G')" title="${type.label} verde">${buildCandleSVG(type,'G')}<div class="ctr-btn-label">🟢</div></button>
      <button class="ctr-btn ctr-r ${selR?'ctr-active-r':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'R')" title="${type.label} rojo">${buildCandleSVG(type,'R')}<div class="ctr-btn-label">🔴</div></button>
    </div>`;
  }).join('');
}

function bostonDirectAdd(typeId, strength, color) {
  bostonTypeId=typeId; bostonStr=strength; bostonColor=color;
  document.getElementById('boston-btn-green').className='boston-color-btn'+(color==='G'?' active-green':'');
  document.getElementById('boston-btn-red').className='boston-color-btn'+(color==='R'?' active-red':'');
  correctStrength(strength); bostonAdd();
}

function bostonSetColor(color) {
  bostonColor=color;
  document.getElementById('boston-btn-green').className='boston-color-btn'+(color==='G'?' active-green':'');
  document.getElementById('boston-btn-red').className='boston-color-btn'+(color==='R'?' active-red':'');
  bostonRenderGrid(); bostonUpdateAddBtn();
}

function bostonSelectType(typeId, strength) { bostonTypeId=typeId; bostonStr=strength; correctStrength(strength); bostonRenderGrid(); bostonUpdateAddBtn(); }

function bostonUpdateAddBtn() {
  const btn=document.getElementById('boston-add-btn'); if (!btn) return;
  if (bostonColor&&bostonTypeId) {
    btn.classList.add('ready'); btn.classList.remove('green-ready','red-ready');
    const name=(CANDLE_TYPES.find(t=>t.id===bostonTypeId)||{}).label||'';
    if (bostonColor==='G') { btn.classList.add('green-ready'); btn.textContent=`🟢 Añadir VERDE — ${name}`; }
    else { btn.classList.add('red-ready'); btn.textContent=`🔴 Añadir ROJO — ${name}`; }
  } else if (bostonColor) { btn.classList.remove('ready','green-ready','red-ready'); btn.textContent='← Selecciona el tipo de vela'; }
  else { btn.classList.remove('ready','green-ready','red-ready'); btn.textContent='← Selecciona color y tipo'; }
}

function bostonAdd() {
  if (!bostonColor||!bostonStr) return;
  addCandle(bostonColor);
  bostonColor=null; bostonTypeId=null; bostonStr=null;
  document.getElementById('boston-btn-green').className='boston-color-btn';
  document.getElementById('boston-btn-red').className='boston-color-btn';
  bostonRenderGrid(); bostonUpdateAddBtn(); bostonSyncSignal(); bostonSyncHistory();
  const sig=document.getElementById('boston-signal');
  if (sig) { sig.style.transform='scale(1.04)'; setTimeout(()=>{ sig.style.transform=''; },200); }
}

// Patch update() para refrescar Boston si está abierto
const _origUpdate = update;
update = function() { _origUpdate(); if (bostonActive) { bostonSyncSignal(); bostonSyncHistory(); } };

// ===== MODO FOCO =====
function initFocusMode() { try { focusModeActive=localStorage.getItem('focusMode')==='true'; } catch(e) {} applyFocusMode(); }
function toggleFocusMode() { focusModeActive=!focusModeActive; try { localStorage.setItem('focusMode',focusModeActive); } catch(e) {} applyFocusMode(); }
function applyFocusMode() {
  const btn=document.getElementById('focus-switch');
  if (focusModeActive) { document.body.classList.add('focus-mode'); if (btn) btn.classList.add('active'); }
  else { document.body.classList.remove('focus-mode'); if (btn) btn.classList.remove('active'); }
}

// ===== MONITOR =====
function openMonitor() {
  if (monitorWindow && !monitorWindow.closed) { monitorWindow.focus(); return; }
  monitorWindow=window.open('monitor.html','TradingMonitor','width=800,height=900,menubar=no,toolbar=no,location=no,status=no');
  if (!monitorWindow) { alert('El navegador bloqueó la ventana emergente. Por favor, permite popups para este sitio.'); return; }
  setTimeout(()=>broadcastEdit(),1000);
}

// ===== INICIALIZAR =====
update();
initCandlePicker();
initFocusMode();
patchHistoryCandles();
console.log('Detector CMD v20260320 iniciado.');

// ===== MODO DE PROYECCION (Vela Actual / Siguiente) =====

var projectionMode = 'current';
var hoverProjPinned = false;
var _hoverMouseX = 0;
var _hoverMouseY = 0;
var _hideTimer = null;

document.addEventListener('mousemove', function(e) {
  _hoverMouseX = e.clientX;
  _hoverMouseY = e.clientY;
});

function toggleProjectionMode() {
  projectionMode = projectionMode === 'current' ? 'next' : 'current';
  var sw    = document.getElementById('proj-mode-switch');
  var badge = document.getElementById('hover-proj-mode-badge');
  var labelBot = document.querySelector('.proj-label-bot');
  var labelTop = document.querySelector('.proj-label-top');
  if (projectionMode === 'next') {
    if (sw) sw.classList.add('mode-next');
    if (badge) badge.textContent = 'VELA SIGUIENTE';
    if (labelTop) labelTop.style.color = '#444';
    if (labelBot) labelBot.style.color = '#00ffff';
  } else {
    if (sw) sw.classList.remove('mode-next');
    if (badge) badge.textContent = 'VELA ACTUAL';
    if (labelTop) labelTop.style.color = '#aaa';
    if (labelBot) labelBot.style.color = '#444';
  }
  if (hoverProjPinned) {
    var panel = document.getElementById('hover-proj-panel');
    if (panel && panel.style.display !== 'none') {
      var idx = parseInt(panel.getAttribute('data-idx') || '-1');
      if (idx >= 0) showHoverProj(idx, true);
    }
  }
}

function computeHoverProjection(idx) {
  var effHist = history;
  if (manualTrapIndex !== null) {
    effHist = history.filter(function(_, i) { return i !== manualTrapIndex; });
  }
  var windowEnd = projectionMode === 'current'
    ? Math.min(idx + 1, effHist.length)
    : Math.min(idx + 2, effHist.length);
  var slice = effHist.slice(0, windowEnd);
  if (slice.length < 2) return null;
  var lastTwo = slice.slice(-2);
  var cr = detectCrosses(false);
  return analyzePattern(lastTwo, null, cr.extremeCondition);
}

function positionHoverPanel(panel) {
  var W  = panel.offsetWidth  || 300;
  var H  = panel.offsetHeight || 200;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var gap = 16;
  var left = _hoverMouseX + gap;
  var top  = _hoverMouseY + gap;
  if (left + W > vw - 8) { left = _hoverMouseX - W - gap; }
  if (top  + H > vh - 8) { top  = _hoverMouseY - H - gap; }
  if (left < 8) { left = 8; }
  if (top  < 8) { top  = 8; }
  panel.style.left = left + 'px';
  panel.style.top  = top  + 'px';
}

function cancelHide() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function scheduleHide() {
  if (hoverProjPinned) return;
  cancelHide();
  _hideTimer = setTimeout(function() {
    var p = document.getElementById('hover-proj-panel');
    if (p && !hoverProjPinned) { p.style.display = 'none'; }
  }, 200);
}

function renderHoverPanel(idx, proj, pinned) {
  var panel  = document.getElementById('hover-proj-panel');
  var badge  = document.getElementById('hover-proj-mode-badge');
  var infoEl = document.getElementById('hover-proj-candle-info');
  var hint   = document.getElementById('hover-proj-pin-hint');
  if (!panel) return;

  badge.textContent = projectionMode === 'next' ? 'VELA SIGUIENTE' : 'VELA ACTUAL';
  if (projectionMode === 'next') {
    panel.classList.add('mode-next-active');
    badge.style.color = '#00ffff';
  } else {
    panel.classList.remove('mode-next-active');
    badge.style.color = '#ffd700';
  }
  if (pinned) { panel.classList.add('pinned'); } else { panel.classList.remove('pinned'); }

  var col    = history[idx] === 'G' ? 'VERDE' : 'ROJA';
  var str    = getCandleStrength(idx) || 2;
  var slabel = (STRENGTH_CONFIG.LEVELS[str] || {}).name || 'MEDIA';
  var info   = 'Vela #' + (idx + 1) + ' ' + col + ' F' + str + ' ' + slabel;
  if (projectionMode === 'next' && idx + 1 < history.length) {
    info += '  ->  Sig. #' + (idx + 2) + ' ' + (history[idx + 1] === 'G' ? 'VERDE' : 'ROJA');
  } else if (projectionMode === 'next') {
    info += '  ->  Proxima vela';
  }
  infoEl.textContent = info;

  if (!proj) {
    document.getElementById('hover-proj-g-seq').textContent  = '--';
    document.getElementById('hover-proj-g-sig').textContent  = 'Sin datos';
    document.getElementById('hover-proj-g-sig').className    = 'hover-proj-sig sig-wait';
    document.getElementById('hover-proj-g-conf').textContent = 'Necesitas al menos 2 velas';
    document.getElementById('hover-proj-r-seq').textContent  = '--';
    document.getElementById('hover-proj-r-sig').textContent  = 'Sin datos';
    document.getElementById('hover-proj-r-sig').className    = 'hover-proj-sig sig-wait';
    document.getElementById('hover-proj-r-conf').textContent = 'Necesitas al menos 2 velas';
  } else {
    document.getElementById('hover-proj-g-seq').textContent  = proj.ifG.pat;
    var gSig = document.getElementById('hover-proj-g-sig');
    gSig.textContent = proj.ifG.sig;
    gSig.className   = 'hover-proj-sig ' + (proj.ifG.sig === 'COMPRA' ? 'sig-buy' : proj.ifG.sig === 'VENTA' ? 'sig-sell' : 'sig-wait');
    document.getElementById('hover-proj-g-conf').textContent = Math.round(proj.ifG.conf * 100) + '%  ' + proj.ifG.desc;

    document.getElementById('hover-proj-r-seq').textContent  = proj.ifR.pat;
    var rSig = document.getElementById('hover-proj-r-sig');
    rSig.textContent = proj.ifR.sig;
    rSig.className   = 'hover-proj-sig ' + (proj.ifR.sig === 'VENTA' ? 'sig-sell' : proj.ifR.sig === 'COMPRA' ? 'sig-buy' : 'sig-wait');
    document.getElementById('hover-proj-r-conf').textContent = Math.round(proj.ifR.conf * 100) + '%  ' + proj.ifR.desc;
  }

  if (hint) {
    hint.textContent = pinned
      ? 'Fijado - Click en misma vela o X para cerrar'
      : 'Click en vela para fijar';
  }

  panel.setAttribute('data-idx', String(idx));
  panel.style.display = 'block';
  requestAnimationFrame(function() { positionHoverPanel(panel); });
}

function showHoverProj(idx, pinned) {
  var proj = (history.length >= 2) ? computeHoverProjection(idx) : null;
  renderHoverPanel(idx, proj, pinned);
}

function closeHoverProj() {
  hoverProjPinned = false;
  var panel = document.getElementById('hover-proj-panel');
  if (panel) { panel.style.display = 'none'; }
}

function patchHistoryCandles() {
  var historyEl = document.getElementById('history');
  if (!historyEl) { return; }

  historyEl.addEventListener('mouseover', function(e) {
    cancelHide();
    if (hoverProjPinned) return;
    var t = e.target;
    while (t && t !== historyEl) {
      if (t.classList && t.classList.contains('candle')) {
        var raw = t.getAttribute('data-hover-idx');
        if (raw !== null) { showHoverProj(parseInt(raw), false); }
        return;
      }
      t = t.parentElement;
    }
  });

  historyEl.addEventListener('mousemove', function() {
    cancelHide();
    if (hoverProjPinned) return;
    var panel = document.getElementById('hover-proj-panel');
    if (panel && panel.style.display !== 'none') {
      requestAnimationFrame(function() { positionHoverPanel(panel); });
    }
  });

  historyEl.addEventListener('mouseleave', function() {
    scheduleHide();
  });

  historyEl.addEventListener('click', function(e) {
    var t = e.target;
    while (t && t !== historyEl) {
      if (t.classList && t.classList.contains('candle')) {
        var raw = t.getAttribute('data-hover-idx');
        if (raw === null) return;
        var idx    = parseInt(raw);
        var panel  = document.getElementById('hover-proj-panel');
        var curIdx = panel ? parseInt(panel.getAttribute('data-idx') || '-1') : -1;
        if (hoverProjPinned && curIdx === idx) {
          closeHoverProj();
        } else {
          hoverProjPinned = true;
          showHoverProj(idx, true);
        }
        return;
      }
      t = t.parentElement;
    }
  });

  // Cancelar hide cuando el mouse entra al panel flotante
  document.addEventListener('mouseover', function(e) {
    var panel = document.getElementById('hover-proj-panel');
    if (!panel || panel.style.display === 'none') return;
    var t = e.target;
    while (t) {
      if (t === panel) { cancelHide(); return; }
      t = t.parentElement;
    }
  });

  // Ocultar cuando mouse sale del panel
  var panel = document.getElementById('hover-proj-panel');
  if (panel) {
    panel.addEventListener('mouseleave', function() { scheduleHide(); });
  }
}

document.addEventListener('click', function(e) {
  if (!hoverProjPinned) return;
  var panel     = document.getElementById('hover-proj-panel');
  var historyEl = document.getElementById('history');
  if (!panel || !historyEl) return;
  var t = e.target;
  while (t) {
    if (t === panel || t === historyEl) return;
    t = t.parentElement;
  }
  closeHoverProj();
});

window.toggleProjectionMode = toggleProjectionMode;
window.closeHoverProj = closeHoverProj;
