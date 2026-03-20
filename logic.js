// ===== CONFIGURACIÓN COMPLETA =====
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

const VP_CONFIG = {
  rows: 20,
  valueAreaPercent: 70,
  minHistory: 10,
  lookbackPeriod: 30
};

const CMD_CONFIG = {
  consolidation: {
    minPeriods: 8,
    maxRange: 15,
    minTouches: 3,
    volumeDrop: 0.6
  },
  manipulation: {
    spikeThreshold: 2.5,
    fakeoutReversal: 0.7,
    wickRatio: 0.6,
    institutionalWick: 3
  },
  distribution: {
    topThreshold: 75,
    volumePattern: 'climax',
    divergencePeriods: 5,
    weaknessSignals: 3
  },
  accumulation: {
    bottomThreshold: 25,
    springDetection: true,
    absorption: true
  }
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

let cmdState = {
  phase: 'none',
  probability: 0,
  details: {},
  lastUpdate: null
};

// ===== ESTADO DE PREDICCIÓN (puente entre paneles) =====
// Se actualiza en updatePredictionPanel() y se lee en la lógica de señal
let predictionState = {
  direction: 'neutral',   // 'bullish' | 'bearish' | 'neutral'
  confidence: 0,          // 0-1
  targetPosition: null,   // 'vah' | 'val' | 'poc' | null
  candlesEstimate: null,  // número estimado de velas
  ready: false            // true cuando hay suficientes datos
};

let volumeProfile = {
  poc: null,
  vah: null,
  val: null,
  histogram: [],
  totalVolume: 0,
  valueAreaVolume: 0,
  currentPriceLevel: null
};

// ===== BROADCAST CHANNEL PARA SINCRONIZACIÓN =====
let bc = null;
if (typeof BroadcastChannel !== 'undefined') {
  bc = new BroadcastChannel('cmd-detector-vp');
  bc.onmessage = function(e) {
    if (e.data?.type === 'strength-edited') {
      if (e.data.payload.manualStrengths) {
        manualStrengths = e.data.payload.manualStrengths;
        update();
        console.log('📡 Fuerzas sincronizadas desde monitor');
      }
    }
  };
}

// ===== FUNCIONES DE EDICIÓN DE VELAS =====

function openEditPanel(index) {
  // Evitar editar la vela actual si estamos en medio de confirmación
  if (index === history.length - 1 && strengthOrigin === 'pending') {
    alert('Esta es la vela actual. Usa el panel superior para confirmar su fuerza.');
    return;
  }
  
  editingIndex = index;
  const currentStrength = getCandleStrength(index);
  
  document.getElementById('edit-index').textContent = index + 1;
  document.getElementById('edit-current').textContent = `${getStrengthLabel(currentStrength)} (${currentStrength})`;
  
  // Resaltar botón actual
  document.querySelectorAll('#edit-panel .edit-btn').forEach((btn, i) => {
    btn.classList.remove('selected');
    const strengths = [1, 1.5, 2, 2.5, 3, 4];
    if (currentStrength === strengths[i]) {
      btn.classList.add('selected');
    }
  });
  
  const panel = document.getElementById('edit-panel');
  panel.classList.add('show');
}

function closeEditPanel() {
  const panel = document.getElementById('edit-panel');
  panel.classList.remove('show');
  editingIndex = null;
}

function confirmEditFromIndex(newStrength) {
  if (editingIndex === null) return;
  
  // Guardar edición
  manualStrengths[editingIndex] = {
    strength: newStrength,
    origin: 'corrected',
    editedAt: Date.now()
  };
  
  // Notificar al monitor
  broadcastEdit();
  
  // Recalcular todo
  update();
  
  closeEditPanel();
  
  console.log(`✏️ Vela #${editingIndex + 1} editada: fuerza ${newStrength}`);
}




// ===== FUNCIONES VOLUME PROFILE =====

function calculateVolumeProfile() {
  if (history.length < VP_CONFIG.minHistory) {
    volumeProfile = {
      poc: null, vah: null, val: null,
      histogram: [], totalVolume: 0, valueAreaVolume: 0,
      currentPriceLevel: null
    };
    return volumeProfile;
  }
  
  const lookback = Math.min(history.length, VP_CONFIG.lookbackPeriod);
  const startIdx = history.length - lookback;
  
  const priceLevels = [];
  let currentPrice = 50;
  
  for (let i = 0; i < lookback; i++) {
    const idx = startIdx + i;
    const candle = history[idx];
    const strength = getCandleStrength(idx) || 2;
    
    const move = (candle === 'G' ? 1 : -1) * (strength * 2);
    const open = currentPrice;
    const close = currentPrice + move;
    const high = Math.max(open, close) + (Math.random() * strength);
    const low = Math.min(open, close) - (Math.random() * strength);
    
    let volume = strength * 10;
    if (cmdState.phase === 'distribution' || cmdState.phase === 'accumulation') {
      volume *= 1.5;
    }
    
    priceLevels.push({
      index: i,
      open, high, low, close,
      volume: Math.floor(volume),
      upVolume: candle === 'G' ? Math.floor(volume * 0.7) : Math.floor(volume * 0.3),
      downVolume: candle === 'R' ? Math.floor(volume * 0.7) : Math.floor(volume * 0.3),
      candle
    });
    
    currentPrice = close;
  }
  
  const allPrices = priceLevels.flatMap(p => [p.high, p.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  
  const rowHeight = priceRange / VP_CONFIG.rows;
  const histogram = [];
  
  for (let i = 0; i < VP_CONFIG.rows; i++) {
    const rowLow = minPrice + (i * rowHeight);
    const rowHigh = rowLow + rowHeight;
    const rowPrice = (rowLow + rowHigh) / 2;
    
    let volume = 0;
    let upVolume = 0;
    let downVolume = 0;
    
    priceLevels.forEach(candle => {
      const overlap = Math.max(0, Math.min(candle.high, rowHigh) - Math.max(candle.low, rowLow));
      if (overlap > 0) {
        const ratio = overlap / (candle.high - candle.low);
        const vol = candle.volume * ratio;
        volume += vol;
        upVolume += candle.upVolume * ratio;
        downVolume += candle.downVolume * ratio;
      }
    });
    
    histogram.push({
      price: rowPrice,
      priceLow: rowLow,
      priceHigh: rowHigh,
      volume: Math.floor(volume),
      upVolume: Math.floor(upVolume),
      downVolume: Math.floor(downVolume),
      isPOC: false,
      isVAH: false,
      isVAL: false
    });
  }
  
  const maxVolume = Math.max(...histogram.map(h => h.volume));
  const pocIndex = histogram.findIndex(h => h.volume === maxVolume);
  histogram[pocIndex].isPOC = true;
  
  const totalVolume = histogram.reduce((sum, h) => sum + h.volume, 0);
  const targetVolume = totalVolume * (VP_CONFIG.valueAreaPercent / 100);
  
  let vaVolume = histogram[pocIndex].volume;
  let vahIndex = pocIndex;
  let valIndex = pocIndex;
  
  while (vaVolume < targetVolume && (vahIndex < histogram.length - 1 || valIndex > 0)) {
    const volAbove = vahIndex < histogram.length - 1 ? histogram[vahIndex + 1].volume : 0;
    const volBelow = valIndex > 0 ? histogram[valIndex - 1].volume : 0;
    
    if (volAbove >= volBelow && vahIndex < histogram.length - 1) {
      vahIndex++;
      vaVolume += histogram[vahIndex].volume;
    } else if (valIndex > 0) {
      valIndex--;
      vaVolume += histogram[valIndex].volume;
    } else if (vahIndex < histogram.length - 1) {
      vahIndex++;
      vaVolume += histogram[vahIndex].volume;
    } else {
      break;
    }
  }
  
  histogram[vahIndex].isVAH = true;
  histogram[valIndex].isVAL = true;
  
  const lastCandle = priceLevels[priceLevels.length - 1];
  const currentPriceLevel = lastCandle.close;
  
  let currentLevelIndex = histogram.findIndex(h => 
    currentPriceLevel >= h.priceLow && currentPriceLevel <= h.priceHigh
  );
  
  let position = 'unknown';
  if (currentLevelIndex !== -1) {
    if (currentLevelIndex === pocIndex) position = 'poc';
    else if (currentLevelIndex >= valIndex && currentLevelIndex <= vahIndex) position = 'inside';
    else if (currentLevelIndex > vahIndex) position = 'above';
    else position = 'below';
  }
  
  volumeProfile = {
    poc: histogram[pocIndex].price,
    vah: histogram[vahIndex].price,
    val: histogram[valIndex].price,
    histogram: histogram,
    totalVolume: totalVolume,
    valueAreaVolume: vaVolume,
    currentPriceLevel: currentPriceLevel,
    currentPosition: position,
    pocIndex, vahIndex, valIndex,
    currentLevelIndex
  };
  
  return volumeProfile;
}

function updateVolumeProfileDisplay() {
  const container = document.getElementById('vp-histogram');
  const pocEl = document.getElementById('vp-poc-value');
  const vahEl = document.getElementById('vp-vah-value');
  const valEl = document.getElementById('vp-val-value');
  const positionEl = document.getElementById('vp-position');
  const positionText = document.getElementById('vp-position-text');
  const positionDetail = document.getElementById('vp-position-detail');
  
  if (history.length < VP_CONFIG.minHistory) {
    container.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">Necesitas al menos ' + VP_CONFIG.minHistory + ' velas para calcular el Volume Profile</div>';
    pocEl.textContent = '--';
    vahEl.textContent = '--';
    valEl.textContent = '--';
    positionEl.className = 'vp-current-position';
    positionText.textContent = 'Posición: --';
    positionDetail.textContent = 'Esperando datos...';
    return;
  }
  
  const vp = volumeProfile;
  const maxVol = Math.max(...vp.histogram.map(h => h.volume));
  
  let html = '';
  
  for (let i = vp.histogram.length - 1; i >= 0; i--) {
    const row = vp.histogram[i];
    const volPercent = (row.volume / maxVol) * 100;
    const upPercent = row.volume > 0 ? (row.upVolume / row.volume) * 100 : 50;
    const downPercent = 100 - upPercent;
    
    let barClass = '';
    let rowClass = '';
    
    if (row.isPOC) {
      barClass = 'poc';
      rowClass = 'poc-row';
    } else if (row.isVAH) {
      barClass = 'vah-zone';
      rowClass = 'vah-row';
    } else if (row.isVAL) {
      barClass = 'val-zone';
      rowClass = 'val-row';
    } else if (upPercent > 60) {
      barClass = 'up';
    } else if (downPercent > 60) {
      barClass = 'down';
    }
    
    const isCurrent = i === vp.currentLevelIndex;
    const currentMarker = isCurrent ? '→ ' : '';
    const currentStyle = isCurrent ? 'background:rgba(255,255,255,0.1);border-radius:4px;' : '';
    
    html += `
      <div class="vp-row ${rowClass}" style="${currentStyle}">
        <div class="vp-price-label">${currentMarker}${row.price.toFixed(1)}%</div>
        <div class="vp-bar-container">
          <div class="vp-bar ${barClass}" style="width: ${volPercent}%;"></div>
        </div>
        <div style="width:30px;font-size:0.6em;color:#666;">${row.volume}</div>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  pocEl.textContent = vp.poc.toFixed(1) + '%';
  vahEl.textContent = vp.vah.toFixed(1) + '%';
  valEl.textContent = vp.val.toFixed(1) + '%';
  
  const positionNames = {
    'poc': 'EN POC (Point of Control)',
    'inside': 'DENTRO DEL VALUE AREA',
    'above': 'POR ENCIMA DE VAH',
    'below': 'POR DEBAJO DE VAL',
    'unknown': 'DESCONOCIDA'
  };
  
  const positionClasses = {
    'poc': 'vp-position-poc',
    'inside': 'vp-position-inside',
    'above': 'vp-position-above',
    'below': 'vp-position-below',
    'unknown': ''
  };
  
  positionEl.className = 'vp-current-position ' + (positionClasses[vp.currentPosition] || '');
  positionText.textContent = 'Posición: ' + positionNames[vp.currentPosition];
  
  let detailText = '';
  switch(vp.currentPosition) {
    case 'poc':
      detailText = 'Nivel de máximo volumen - Soporte/Resistencia fuerte';
      break;
    case 'inside':
      detailText = `Entre VAL (${vp.val.toFixed(1)}%) y VAH (${vp.vah.toFixed(1)}%) - Zona de equilibrio`;
      break;
    case 'above':
      detailText = `Por encima de VAH (${vp.vah.toFixed(1)}%) - Posible sobrecompra`;
      break;
    case 'below':
      detailText = `Por debajo de VAL (${vp.val.toFixed(1)}%) - Posible sobreventa`;
      break;
  }
  positionDetail.textContent = detailText;
}

// ===== FUNCIONES CMD =====

function detectCMDPhase() {
  if (history.length < 5) return { phase: 'none', probability: 0, details: {} };
  
  const trendMA = calcMA(10, true);
  const recentTrend = analyzeRecentTrend();
  const currentCandle = analyzeCurrentCandle();
  
  const consolidation = detectConsolidation(trendMA, recentTrend);
  const manipulation = detectManipulation(trendMA, recentTrend, currentCandle);
  const distribution = detectDistribution(trendMA, recentTrend, currentCandle);
  const accumulation = detectAccumulation(trendMA, recentTrend, currentCandle);
  
  const phases = [
    { name: 'consolidation', ...consolidation },
    { name: 'manipulation', ...manipulation },
    { name: 'distribution', ...distribution },
    { name: 'accumulation', ...accumulation }
  ];
  
  phases.sort((a, b) => b.probability - a.probability);
  const dominant = phases[0];
  
  return {
    phase: dominant.probability > 0.4 ? dominant.name : 'none',
    probability: dominant.probability,
    details: dominant.details,
    allPhases: phases
  };
}

function detectConsolidation(trendMA, recentTrend) {
  if (history.length < CMD_CONFIG.consolidation.minPeriods) {
    return { probability: 0, details: {} };
  }
  
  const recent = history.slice(-CMD_CONFIG.consolidation.minPeriods);
  const maValues = [];
  
  for (let i = CMD_CONFIG.consolidation.minPeriods; i > 0; i--) {
    const slice = history.slice(-i - 10, -i);
    if (slice.length >= 10) {
      const ma = (slice.filter(h => h === 'G').length / 10) * 100;
      maValues.push(ma);
    }
  }
  
  if (maValues.length < 3) return { probability: 0, details: {} };
  
  const maxMA = Math.max(...maValues);
  const minMA = Math.min(...maValues);
  const range = maxMA - minMA;
  
  let touches = 0;
  let lastDir = 0;
  for (let i = 1; i < maValues.length; i++) {
    const dir = Math.sign(maValues[i] - maValues[i-1]);
    if (dir !== 0 && dir !== lastDir) {
      touches++;
      lastDir = dir;
    }
  }
  
  let probability = 0;
  const details = {
    range: range.toFixed(1),
    touches: touches,
    isNarrow: range < CMD_CONFIG.consolidation.maxRange
  };
  
  if (range < CMD_CONFIG.consolidation.maxRange) probability += 0.4;
  if (touches >= CMD_CONFIG.consolidation.minTouches) probability += 0.3;
  if (recentTrend.trend === 'neutral') probability += 0.2;
  if (Math.abs(recentTrend.weightedScore) < 2) probability += 0.1;
  if (range < 10 && history.length > 15) probability += 0.2;
  
  return { 
    probability: Math.min(probability, 0.95), 
    details,
    description: range < CMD_CONFIG.consolidation.maxRange ? 
      `Rango estrecho: ${range.toFixed(1)}% | ${touches} toques` : 
      'Rango amplio, no consolidación clara'
  };
}

function detectManipulation(trendMA, recentTrend, currentCandle) {
  if (history.length < 3) return { probability: 0, details: {} };
  
  const lastThree = history.slice(-3);
  const strengths = lastThree.map((_, i) => getCandleStrength(history.length - 3 + i));
  
  const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  const maxStrength = Math.max(...strengths);
  const minStrength = Math.min(...strengths);
  
  const capitulationDetected = maxStrength === 4 || 
    (maxStrength >= 3 && minStrength <= 1 && avgStrength < 2);
  
  const acceleratedSpike = strengths.includes(2.5) && strengths.filter(s => s >= 2).length >= 2;
  const biasedDojiTrap = strengths.includes(1.5) && 
    (strengths[strengths.length - 1] === 1.5 || strengths[strengths.length - 2] === 1.5);
  
  const spikeDetected = maxStrength >= 3 && avgStrength < 2.3;
  
  const lastTwo = history.slice(-2);
  const prevThree = history.slice(-4, -1);
  
  let fakeoutDetected = false;
  let fakeoutType = '';
  let fakeoutIntensity = 0;
  
  if (prevThree.every(h => h === 'G') && lastTwo[0] === 'G' && lastTwo[1] === 'R') {
    const prevStrengths = prevThree.map((_, i) => getCandleStrength(history.length - 4 + i));
    const lastStrength = getCandleStrength(history.length - 1);
    
    if (prevStrengths.every(s => s >= 2) && lastStrength >= 2) {
      fakeoutDetected = true;
      fakeoutType = 'bull_trap';
      fakeoutIntensity = 1;
    }
    
    if (prevStrengths.some(s => s >= 3) && lastStrength <= 1.5) {
      fakeoutDetected = true;
      fakeoutType = 'bull_trap_capitulation';
      fakeoutIntensity = 2;
    }
  }
  
  if (prevThree.every(h => h === 'R') && lastTwo[0] === 'R' && lastTwo[1] === 'G') {
    const prevStrengths = prevThree.map((_, i) => getCandleStrength(history.length - 4 + i));
    const lastStrength = getCandleStrength(history.length - 1);
    
    if (prevStrengths.every(s => s >= 2) && lastStrength >= 2) {
      fakeoutDetected = true;
      fakeoutType = 'bear_trap';
      fakeoutIntensity = 1;
    }
    
    if (prevStrengths.some(s => s >= 3) && lastStrength <= 1.5) {
      fakeoutDetected = true;
      fakeoutType = 'bear_trap_capitulation';
      fakeoutIntensity = 2;
    }
  }
  
  const longWickPattern = detectLongWickPattern();
  const hiddenInstitutional = (strengths.includes(2.5) && strengths.includes(1.5)) ||
    (strengths.filter(s => s === 2.5).length >= 2);
  
  let probability = 0;
  const details = {
    spikeDetected,
    capitulationDetected,
    acceleratedSpike,
    biasedDojiTrap,
    fakeoutDetected,
    fakeoutType,
    fakeoutIntensity,
    longWickPattern,
    hiddenInstitutional,
    avgStrength: avgStrength.toFixed(1),
    strengthRange: (maxStrength - minStrength).toFixed(1),
    maxStrength,
    minStrength
  };
  
  if (capitulationDetected) probability += 0.5;
  else if (spikeDetected) probability += 0.35;
  
  if (fakeoutIntensity === 2) probability += 0.5;
  else if (fakeoutDetected) probability += 0.4;
  
  if (acceleratedSpike) probability += 0.25;
  if (biasedDojiTrap) probability += 0.2;
  if (longWickPattern.detected) probability += 0.25;
  if (hiddenInstitutional) probability += 0.15;
  if (cmdState.phase === 'consolidation') probability += 0.15;
  
  if (capitulationDetected && trendMA !== null) {
    const lastCandle = history[history.length - 1];
    const isBullishCapitulation = lastCandle === 'G' && trendMA <= 20;
    const isBearishCapitulation = lastCandle === 'R' && trendMA >= 80;
    if (isBullishCapitulation || isBearishCapitulation) probability += 0.1;
  }
  
  let description = 'Sin manipulación clara';
  
  if (fakeoutIntensity === 2) {
    description = `🔥 CAPITULACIÓN: ${fakeoutType === 'bull_trap_capitulation' ? 'Trampa Alcista EXTREMA' : 'Trampa Bajista EXTREMA'} - Liquidación de stops institucional`;
  } else if (fakeoutDetected) {
    description = `🎭 FALSO QUIEBRE: ${fakeoutType === 'bull_trap' ? 'Trampa Alcista' : 'Trampa Bajista'}`;
  } else if (capitulationDetected) {
    description = `⚡ CAPITULACIÓN: Spike ${maxStrength}/4 seguido de colapso (${minStrength}) - Reversión violenta inminente`;
  } else if (acceleratedSpike) {
    description = `🚀 MOMENTUM FORZADO: Aceleración artificial detectada (${strengths.filter(s => s >= 2.5).length} velas 2.5+)`;
  } else if (hiddenInstitutional) {
    description = `🏦 ACTIVIDAD OCULTA: ${cmdState.phase === 'distribution' ? 'Distribución' : 'Acumulación'} institucional disimulada`;
  } else if (biasedDojiTrap) {
    description = `🕯️ DOJI FORZADO: Indecisión con sesgo - Posible preparación de movimiento`;
  } else if (spikeDetected) {
    description = `⚡ SPIKE: Fuerza ${maxStrength}/4 vs media ${avgStrength.toFixed(1)} - Volatilidad anormal`;
  } else if (longWickPattern.detected) {
    description = `📍 RECHAZO INSTITUCIONAL: Mechas largas en ${longWickPattern.type === 'spike_rejection' ? 'spike' : 'doble reversión'}`;
  }
  
  return {
    probability: Math.min(probability, 0.95),
    details,
    description,
    severity: fakeoutIntensity === 2 || capitulationDetected ? 'critical' : 
              fakeoutDetected || acceleratedSpike ? 'high' : 
              spikeDetected || hiddenInstitutional ? 'medium' : 'low'
  };
}

function detectLongWickPattern() {
  if (history.length < 3) return { detected: false };
  
  const recent = history.slice(-3);
  const strengths = recent.map((_, i) => getCandleStrength(history.length - 3 + i));
  
  const spikeAndRejection = strengths[0] >= 3 && strengths[1] <= 1;
  const doubleRejection = strengths.every(s => s === 1) && 
    recent[0] !== recent[1] && recent[1] !== recent[2];
  
  return {
    detected: spikeAndRejection || doubleRejection,
    type: spikeAndRejection ? 'spike_rejection' : 'double_rejection'
  };
}

function detectDistribution(trendMA, recentTrend, currentCandle) {
  if (trendMA === null) return { probability: 0, details: {} };
  
  const isHighLevel = trendMA >= CMD_CONFIG.distribution.topThreshold;
  const divergence = detectDivergence('bearish');
  const weaknessSignals = countWeaknessSignals();
  
  const recent = history.slice(-CMD_CONFIG.distribution.divergencePeriods);
  const greenCount = recent.filter(h => h === 'G').length;
  const redStrength = recent
    .map((h, i) => ({ h, i: history.length - CMD_CONFIG.distribution.divergencePeriods + i }))
    .filter(x => x.h === 'R')
    .map(x => getCandleStrength(x.i))
    .reduce((a, b) => a + b, 0);
  
  const distributionPattern = greenCount >= 3 && redStrength >= 6;
  
  let probability = 0;
  const details = {
    isHighLevel,
    divergence,
    weaknessSignals,
    distributionPattern,
    greenCount,
    redStrength
  };
  
  if (isHighLevel) probability += 0.3;
  if (divergence.detected) probability += 0.25;
  if (weaknessSignals >= CMD_CONFIG.distribution.weaknessSignals) probability += 0.25;
  if (distributionPattern) probability += 0.2;
  if (cmdState.phase === 'consolidation' && isHighLevel) probability += 0.15;
  
  return {
    probability: Math.min(probability, 0.95),
    details,
    description: distributionPattern ?
      `🏦 DISTRIBUCIÓN: ${greenCount} verdes débiles → rojas fuertes (fuerza ${redStrength})` :
      isHighLevel && divergence.detected ?
      `📉 Divergencia bajista en nivel alto (${trendMA.toFixed(0)}%)` :
      weaknessSignals >= 2 ?
      `⚠️ ${weaknessSignals} señales de debilidad detectadas` :
      'Sin distribución clara'
  };
}

function detectAccumulation(trendMA, recentTrend, currentCandle) {
  if (trendMA === null) return { probability: 0, details: {} };
  
  const isLowLevel = trendMA <= CMD_CONFIG.accumulation.bottomThreshold;
  const divergence = detectDivergence('bullish');
  const spring = detectSpring();
  
  const recent = history.slice(-5);
  const redCount = recent.filter(h => h === 'R').length;
  const greenStrength = recent
    .map((h, i) => ({ h, i: history.length - 5 + i }))
    .filter(x => x.h === 'G')
    .map(x => getCandleStrength(x.i))
    .reduce((a, b) => a + b, 0);
  
  const absorptionPattern = redCount >= 3 && greenStrength >= 6;
  
  let probability = 0;
  const details = {
    isLowLevel,
    divergence,
    spring,
    absorptionPattern,
    redCount,
    greenStrength
  };
  
  if (isLowLevel) probability += 0.3;
  if (divergence.detected) probability += 0.25;
  if (spring.detected) probability += 0.3;
  if (absorptionPattern) probability += 0.15;
  
  return {
    probability: Math.min(probability, 0.95),
    details,
    description: spring.detected ?
      `🌱 SPRING detectado: Falso quiebre con recuperación` :
      absorptionPattern ?
      `📥 ACUMULACIÓN: ${redCount} rojas débiles → verdes fuertes (fuerza ${greenStrength})` :
      isLowLevel && divergence.detected ?
      `📈 Divergencia alcista en nivel bajo (${trendMA.toFixed(0)}%)` :
      'Sin acumulación clara'
  };
}

function detectDivergence(type) {
  if (history.length < 6) return { detected: false };
  
  const recentMA = [];
  const recentMomentum = [];
  
  for (let i = 5; i > 0; i--) {
    const slice = history.slice(-i - 10, -i);
    if (slice.length >= 10) {
      const ma = (slice.filter(h => h === 'G').length / 10) * 100;
      recentMA.push(ma);
      
      const momentumSlice = history.slice(-i - 3, -i);
      let momentum = 0;
      momentumSlice.forEach((h, idx) => {
        const strength = getCandleStrength(history.length - i - 3 + idx) || 2;
        momentum += (h === 'G' ? 1 : -1) * strength;
      });
      recentMomentum.push(momentum);
    }
  }
  
  if (recentMA.length < 3) return { detected: false };
  
  const maTrend = recentMA[recentMA.length - 1] - recentMA[0];
  const momTrend = recentMomentum[recentMomentum.length - 1] - recentMomentum[0];
  
  const detected = type === 'bearish' ? 
    (maTrend > 2 && momTrend < -2) : 
    (maTrend < -2 && momTrend > 2);
  
  return {
    detected,
    maTrend: maTrend.toFixed(1),
    momTrend: momTrend.toFixed(1),
    strength: Math.abs(maTrend) + Math.abs(momTrend)
  };
}

function detectSpring() {
  if (history.length < 4) return { detected: false };
  
  const recent = history.slice(-4);
  
  const isSpringPattern = recent[0] === 'R' && recent[1] === 'R' && 
    recent[2] === 'R' && recent[3] === 'G';
  
  if (!isSpringPattern) return { detected: false };
  
  const strengths = recent.map((_, i) => getCandleStrength(history.length - 4 + i));
  const springStrength = strengths[3] >= 3 && strengths[2] <= 2;
  
  return {
    detected: springStrength,
    pattern: recent.join(''),
    strength: strengths[3]
  };
}

function countWeaknessSignals() {
  let signals = 0;
  const recent = history.slice(-5);
  
  recent.forEach((h, i) => {
    const idx = history.length - 5 + i;
    const strength = getCandleStrength(idx);
    
    if (h === 'G' && strength < 2) signals += 0.5;
    if (h === 'R' && strength >= 2) signals += 1;
    if (i > 0 && h !== recent[i-1]) signals += 0.3;
  });
  
  return Math.floor(signals);
}



// ===== FUNCIONES DE FUERZA =====

function calculateAutoStrength() {
  // Si el usuario ya seleccionó un tipo de vela en el picker,
  // usar la fuerza de ese tipo como sugerencia base.
  // Guardia: CANDLE_TYPES y pickerTypeId se declaran más abajo en el archivo,
  // así que solo accedemos a ellos si ya existen (evita errores en carga inicial).
  if (typeof pickerTypeId !== 'undefined' && pickerTypeId &&
      typeof CANDLE_TYPES !== 'undefined') {
    const selectedType = CANDLE_TYPES.find(t => t.id === pickerTypeId);
    if (selectedType) return selectedType.strength;
  }

  if (history.length < 3) return 2;
  
  const last = history[history.length - 1];
  let consecutiveOpposite = 0;
  let consecutiveSame = 0;
  
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] !== last) {
      if (consecutiveSame === 0) consecutiveOpposite++;
      else break;
    } else {
      consecutiveSame++;
    }
  }
  
  const trendMA = calcMA(10, true);
  const prevTrendMA = calcPrevMA(10, true);
  const maDirection = prevTrendMA !== null ? trendMA - prevTrendMA : 0;
  
  const recentStrengths = [];
  for (let i = Math.max(0, history.length - 4); i < history.length; i++) {
    recentStrengths.push(getCandleStrength(i));
  }
  const hasSpike = recentStrengths.length >= 2 && 
    recentStrengths[recentStrengths.length - 2] >= 3 && 
    recentStrengths[recentStrengths.length - 1] <= 1.5;
  
  let alternations = 0;
  for (let i = history.length - 4; i < history.length - 1; i++) {
    if (i >= 0 && history[i] !== history[i+1]) alternations++;
  }
  const isDojiPattern = alternations >= 3;
  
  if (consecutiveOpposite >= 4 && trendMA !== null) {
    const isExtreme = (trendMA >= 90 && last === 'R') || (trendMA <= 10 && last === 'G');
    if (isExtreme) return 4;
  }
  
  if (consecutiveOpposite >= 3) return 3;
  if (consecutiveOpposite === 2 && Math.abs(maDirection) > 3) return 3;
  if (hasSpike && trendMA !== null && (trendMA >= 85 || trendMA <= 15)) return 3;
  
  if (consecutiveSame >= 3 && Math.abs(maDirection) > 5) return 2.5;
  if (consecutiveSame >= 2 && Math.abs(maDirection) > 8) return 2.5;
  
  if (consecutiveSame >= 2) return 2;
  if (consecutiveOpposite === 2) return 2;
  
  if (isDojiPattern && consecutiveSame >= 1) return 1.5;
  
  if (isDojiPattern || consecutiveOpposite === 1) return 1;
  
  return 2;
}


// ===== PANEL DE CONFIRMACIÓN =====

// Renderiza la vela sugerida como SVG en el panel de confirmación
function renderSuggestedCandleSVG(strength) {
  if (typeof CANDLE_TYPES === 'undefined') return;

  // Encontrar el tipo de vela que mejor corresponde a la fuerza sugerida
  // Priorizar: exact match de strength → tipo más representativo
  const typeMap = {
    1:   'doji',
    1.5: 'spinning',
    2:   'normal',
    2.5: 'momentum',
    3:   'marubozu',
    4:   'engulf'
  };
  const typeId   = typeMap[strength] || 'normal';
  const candleType = CANDLE_TYPES.find(t => t.id === typeId);
  if (!candleType) return;

  const svgG = document.getElementById('suggested-candle-svg-g');
  const svgR = document.getElementById('suggested-candle-svg-r');
  if (svgG) svgG.innerHTML = buildCandleSVG(candleType, 'G');
  if (svgR) svgR.innerHTML = buildCandleSVG(candleType, 'R');
}

function updateSuggestionPanel() {
  if (strengthOrigin !== 'pending') return;
  
  autoSuggestedStrength = calculateAutoStrength();
  
  const visualStrength = STRENGTH_CONFIG.VISUAL_MAP[autoSuggestedStrength] || 2;
  const config = STRENGTH_CONFIG.LEVELS[autoSuggestedStrength];
  
  const bars = config.icon;
  const box = document.getElementById('suggestion-box');
  const barsEl = document.getElementById('suggestion-bars');
  const textEl = document.getElementById('suggestion-text');
  
  barsEl.textContent = bars;
  barsEl.className = 'suggestion-strength strength-' + visualStrength;
  barsEl.style.color = config.color;
  
  textEl.textContent = config.name;
  textEl.style.color = config.color;

  document.getElementById('suggestion-reason').textContent = config.desc;

  // Renderizar vela visual sugerida
  renderSuggestedCandleSVG(autoSuggestedStrength);
  
  box.classList.remove('confirmed', 'corrected');
  document.getElementById('correction-notice').classList.remove('active');
  
  confirmedStrength = null;
  document.getElementById('status-bar').className = 'status-bar status-pending';
  document.getElementById('status-bar').textContent = '⏳ PENDIENTE: Confirma o corrige la fuerza sugerida';
  
  document.getElementById('correction-options').style.display = 'block';
  document.getElementById('step-confirm').style.display = 'block';
}





function correctStrength(newStrength) {
  confirmedStrength = newStrength;
  strengthOrigin = 'corrected';
  
  const visualStrength = STRENGTH_CONFIG.VISUAL_MAP[newStrength] || 2;
  const config = STRENGTH_CONFIG.LEVELS[newStrength];
  
  document.getElementById('suggestion-bars').textContent = config.icon;
  document.getElementById('suggestion-bars').className = 'suggestion-strength strength-' + visualStrength;
  document.getElementById('suggestion-bars').style.color = config.color;
  document.getElementById('suggestion-text').textContent = config.name;
  document.getElementById('suggestion-text').style.color = config.color;
  
  // Mostrar también la descripción de la nueva fuerza elegida
  document.getElementById('suggestion-reason').textContent = config.desc;

  // Actualizar vela visual — si el usuario seleccionó un tipo específico
  // en el picker, mostrar ese tipo exacto; si no, mostrar el tipo por fuerza
  if (typeof pickerTypeId !== 'undefined' && pickerTypeId &&
      typeof CANDLE_TYPES !== 'undefined') {
    const picked = CANDLE_TYPES.find(t => t.id === pickerTypeId);
    if (picked) {
      const svgG = document.getElementById('suggested-candle-svg-g');
      const svgR = document.getElementById('suggested-candle-svg-r');
      const col  = typeof pickerColor !== 'undefined' && pickerColor;
      if (svgG) svgG.innerHTML = buildCandleSVG(picked, col === 'R' ? 'G' : 'G');
      if (svgR) svgR.innerHTML = buildCandleSVG(picked, 'R');
    }
  } else {
    renderSuggestedCandleSVG(newStrength);
  }

  const box = document.getElementById('suggestion-box');
  box.classList.remove('confirmed');
  box.classList.add('corrected');
  
  const notice = document.getElementById('correction-notice');
  notice.textContent = `✏️ Cambiado de ${STRENGTH_CONFIG.LEVELS[autoSuggestedStrength].name} a ${config.name}`;
  notice.classList.add('active');
  
  document.getElementById('status-bar').className = 'status-bar status-corrected';
  document.getElementById('status-bar').textContent = `✏️ CORREGIDO: ${config.name} — ${config.desc}`;
  
  
  updatePickerConfirmBtn();
}



function addCandle(color) {
  // ========== COMPORTAMIENTO INTENCIONAL: Auto-confirmar si el usuario no interactuó ==========
  // Si el usuario presiona G/R sin haber confirmado/corregido la fuerza,
  // se usa la sugerencia automática como fallback para no bloquear el flujo.
  // Si prefieres obligar al usuario a confirmar siempre, elimina este bloque
  // y muestra un alert() en su lugar.
  if (confirmedStrength === null || confirmedStrength === undefined) {
    confirmedStrength = autoSuggestedStrength || 2;
    strengthOrigin = 'auto';
    console.log(`⚠️ Auto-confirmando fuerza ${confirmedStrength} para vela ${color}`);
  }
  
  // ========== FIX 2: Validar que la fuerza esté en rango válido ==========
  const validStrengths = [1, 1.5, 2, 2.5, 3, 4];
  if (!validStrengths.includes(confirmedStrength)) {
    console.warn(`Fuerza inválida: ${confirmedStrength}, usando 2`);
    confirmedStrength = 2;
    strengthOrigin = 'auto';
  }
  
  const index = history.length;
  history.push(color);
  
  // ========== FIX 3: Guardar con verificación completa ==========
  const strengthToSave = confirmedStrength;
  const originToSave = strengthOrigin || 'auto';
  
  manualStrengths[index] = {
    strength: strengthToSave,
    origin: originToSave,
    autoSuggested: autoSuggestedStrength,
    timestamp: Date.now(),
    color: color
  };
  
  console.log(`✅ Vela #${index + 1} registrada: ${color} | Fuerza: ${strengthToSave} | Origen: ${originToSave}`);
  
  // ========== FIX 4: Sincronización inmediata con monitor ==========
  broadcastEdit();
  
  resetConfirmationPanel();
  
  // ========== FIX 5: Corrección del desplazamiento de índices ==========
  if (history.length > 30) {
    // Ajustar índice de trampa si es necesario
    if (manualTrapIndex !== null) {
      if (manualTrapIndex === 0) {
        manualTrapIndex = null; // La trampa se eliminó
      } else {
        manualTrapIndex--;
      }
    }
    
    // Desplazar manualStrengths correctamente (incluyendo índice 0)
    const newStrengths = {};
    for (let i = 0; i < history.length; i++) {  // Corregido: empezar en 0 para no perder el índice 0
      if (manualStrengths[i]) {
        newStrengths[i - 1] = manualStrengths[i];
      }
    }
    manualStrengths = newStrengths;
    
    // Eliminar primera vela del historial
    const removed = history.shift();
    console.log(`🗑️ Vela antigua eliminada: ${removed}, total: ${history.length}`);
  }
  
  update();
}

function resetConfirmationPanel() {
  strengthOrigin    = 'pending';
  confirmedStrength = null;
  autoSuggestedStrength = 2;

  // Reset picker state (legacy vars mantenidas para Boston overlay)
  pickerColor    = null;
  pickerStrength = null;
  pickerTypeId   = null;

  // El nuevo size picker no necesita reset visual — siempre está listo

  // Paneles de sugerencia legacy (pueden no existir si el HTML fue simplificado)
  const suggBox = document.getElementById('suggestion-box');
  if (suggBox) suggBox.classList.remove('confirmed', 'corrected');
  const corrNotice = document.getElementById('correction-notice');
  if (corrNotice) corrNotice.classList.remove('active');
  const corrOpts = document.getElementById('correction-options');
  if (corrOpts) corrOpts.style.display = 'block';
  const colorBtns = document.getElementById('color-buttons');
  if (colorBtns) colorBtns.style.display = 'none';
  const stepConf = document.getElementById('step-confirm');
  if (stepConf) stepConf.style.display = 'block';

  updateSuggestionPanel();
}

// ===== FUNCIONES DE ANÁLISIS =====

function getCandleStrength(index) {
  if (manualStrengths[index]) return manualStrengths[index].strength;
  return calculateHistoricalStrength(index);
}

function getCandleOrigin(index) {
  if (manualStrengths[index]) {
    const origins = { 'confirmed': '✓ Auto', 'corrected': '✏️ Manual', 'auto': 'Auto' };
    return origins[manualStrengths[index].origin] || 'Auto';
  }
  return 'Auto';
}

function calculateHistoricalStrength(index) {
  if (index < 2) return 2;
  
  const current = history[index];
  const prev = history[index - 1];
  const prev2 = history[index - 2];
  
  const wasBearish = prev === 'R' && prev2 === 'R';
  const wasBullish = prev === 'G' && prev2 === 'G';
  
  let consecutiveSame = 0;
  for (let i = index - 1; i >= 0 && history[i] === current; i--) {
    consecutiveSame++;
  }
  if (consecutiveSame >= 4 && (current === 'G' || current === 'R')) return 4;
  
  if (consecutiveSame >= 3) return 2.5;
  
  if ((current === 'G' && wasBearish) || (current === 'R' && wasBullish)) return 3;
  
  if (index >= 3) {
    const recent = [history[index-3], history[index-2], history[index-1], current];
    let alternations = 0;
    for (let i = 0; i < recent.length - 1; i++) {
      if (recent[i] !== recent[i+1]) alternations++;
    }
    if (alternations >= 3) return 1.5;
  }
  
  if (current === prev) return 2;
  
  return 1;
}

function analyzeCurrentCandle() {
  if (history.length === 0) return { strength: 0, type: 'neutral', isReversal: false, origin: '-' };
  
  const idx = history.length - 1;
  const current = history[idx];
  
  let strength = getCandleStrength(idx);
  if (!strength || strength === undefined) strength = 2;
  
  const origin = getCandleOrigin(idx);
  
  let isReversal = false;
  let type = 'normal';
  
  if (strength >= 3) {
    isReversal = true;
    type = strength === 4 ? 'capitulation' : 'strong-reversal';
  } else if (strength === 2.5) {
    type = 'strong-continuation';
  } else if (strength === 2) {
    type = 'continuation';
  } else if (strength === 1.5) {
    type = 'biased-doji';
  } else {
    type = 'pure-doji';
  }
  
  if (history.length >= 3) {
    const prev = history[idx-1];
    const prev2 = history[idx-2];
    const wasOpposite = prev !== current && prev2 !== current;
    if (wasOpposite) {
      isReversal = true;
      if (strength < 2.5) type = 'weak-reversal';
    }
  }
  
  return { 
    strength, 
    type, 
    isReversal: isReversal && strength >= 2,
    current, 
    origin,
    isCapitulation: strength === 4,
    isAccelerated: strength === 2.5
  };
}

// Analiza el impulso dominante en las últimas 10 velas para detectar
// correcciones dentro de una tendencia mayor, que el WeightedScore-5
// no puede ver porque su ventana es demasiado corta.
//
// Ejemplo del bug: [G2.5, G3, G2.5, G1.5, R2.5, G1.5, R2.5, R1.5]
// El score-5 ve solo las últimas 5 → bajista (-3.3)
// Pero el impulso verde (9.5) es 2.4x el rojo (4.0) → corrección, no reversión
function analyzeSwingContext() {
  const window = Math.min(10, history.length);
  if (window < 5) return null;

  const slice    = history.slice(-window);
  const sliceStr = [];
  for (let i = history.length - window; i < history.length; i++) {
    sliceStr.push(getCandleStrength(i) || 2);
  }

  // Encontrar el run más fuerte de cada color dentro de la ventana
  let maxStrGreen = 0, maxStrRed = 0;
  let currentDir = slice[0], currentStr = sliceStr[0];

  for (let i = 1; i < slice.length; i++) {
    if (slice[i] === currentDir) {
      currentStr += sliceStr[i];
    } else {
      if (currentDir === 'G' && currentStr > maxStrGreen) maxStrGreen = currentStr;
      if (currentDir === 'R' && currentStr > maxStrRed)   maxStrRed   = currentStr;
      currentDir = slice[i];
      currentStr = sliceStr[i];
    }
  }
  if (currentDir === 'G' && currentStr > maxStrGreen) maxStrGreen = currentStr;
  if (currentDir === 'R' && currentStr > maxStrRed)   maxStrRed   = currentStr;

  if (maxStrGreen === 0 || maxStrRed === 0) return null;

  const dominantDir   = maxStrGreen >= maxStrRed ? 'bullish' : 'bearish';
  const dominantStr   = Math.max(maxStrGreen, maxStrRed);
  const recessionStr  = Math.min(maxStrGreen, maxStrRed);
  const impulseRatio  = dominantStr / recessionStr;

  // Contar cuántas velas recientes van contra el impulso dominante
  const againstDir = dominantDir === 'bullish' ? 'R' : 'G';
  let corrCount = 0, corrStr = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === againstDir; i--) {
    corrCount++;
    corrStr += getCandleStrength(i) || 2;
  }

  return {
    dominantDir,
    maxStrGreen,
    maxStrRed,
    impulseRatio,
    corrCount,
    avgCorrStr: corrCount > 0 ? corrStr / corrCount : 0
  };
}

function analyzeRecentTrend() {
  const recentCount = Math.min(5, history.length);
  const recent = [];
  const strengths = [];
  
  for (let i = 0; i < recentCount; i++) {
    const idx = history.length - recentCount + i;
    recent.push(history[idx]);
    strengths.push(getCandleStrength(idx));
  }
  
  if (recent.length < 2) return { trend: 'neutral', sequence: recent, strengths, strength: 0, weightedScore: 0 };
  
  let weightedScore = 0;
  for (let i = 0; i < recent.length; i++) {
    const candleStrength = strengths[i] || 2;
    const recencyWeight = (i + 1) / recent.length;
    const finalWeight = candleStrength * recencyWeight;
    weightedScore += (recent[i] === 'G' ? 1 : -1) * finalWeight;
  }
  
  let consecutiveGreens = 0, consecutiveReds = 0, totalConsecutiveStrength = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const s = strengths[i] || 2;
    if (recent[i] === 'G') {
      if (consecutiveReds === 0) { consecutiveGreens++; totalConsecutiveStrength += s; }
      else break;
    } else {
      if (consecutiveGreens === 0) { consecutiveReds++; totalConsecutiveStrength += s; }
      else break;
    }
  }
  
  const lastTwo = recent.slice(-2);
  const lastTwoRed = lastTwo[0] === 'R' && lastTwo[1] === 'R';
  const lastTwoGreen = lastTwo[0] === 'G' && lastTwo[1] === 'G';
  
  // isExtreme: 3+ velas consecutivas con fuerza total alta
  // Umbral reducido a 6 (antes 8) para capturar series largas con velas débiles
  const isExtremeBullish = consecutiveGreens >= 3 && totalConsecutiveStrength >= 6;
  const isExtremeBearish = consecutiveReds   >= 3 && totalConsecutiveStrength >= 6;
  
  if (isExtremeBullish) return { 
    trend: 'bullish', sequence: recent, strengths, strength: consecutiveGreens, 
    reason: `${consecutiveGreens} verdes fuertes seguidas (fuerza total: ${totalConsecutiveStrength})`,
    weightedScore, isExtreme: true 
  };
  if (isExtremeBearish) return { 
    trend: 'bearish', sequence: recent, strengths, strength: consecutiveReds, 
    reason: `${consecutiveReds} rojas fuertes seguidas (fuerza total: ${totalConsecutiveStrength})`,
    weightedScore, isExtreme: true 
  };
  
  if (consecutiveGreens >= 3) return { trend: 'bullish', sequence: recent, strengths, strength: consecutiveGreens, reason: `${consecutiveGreens} verdes seguidas`, weightedScore };
  if (consecutiveReds >= 3) return { trend: 'bearish', sequence: recent, strengths, strength: consecutiveReds, reason: `${consecutiveReds} rojas seguidas`, weightedScore };
  
  if (lastTwoRed && weightedScore > 2) return { 
    trend: 'neutral', sequence: recent, strengths, strength: consecutiveReds, 
    reason: `Conflicto: Score +${weightedScore.toFixed(1)} pero últimas 2 rojas`,
    weightedScore, warning: 'momentum_change', detail: 'Momentum alcista pero cambiando' 
  };
  if (lastTwoGreen && weightedScore < -2) return { 
    trend: 'neutral', sequence: recent, strengths, strength: consecutiveGreens, 
    reason: `Conflicto: Score ${weightedScore.toFixed(1)} pero últimas 2 verdes`,
    weightedScore, warning: 'momentum_change', detail: 'Momentum bajista pero cambiando' 
  };
  
  if (weightedScore > 3) {
    const swing = analyzeSwingContext();
    if (swing && swing.dominantDir === 'bearish' && swing.impulseRatio >= 1.5) {
      return {
        trend: 'neutral', sequence: recent, strengths, strength: 0,
        reason: `Corrección alcista dentro de impulso bajista (${swing.maxStrRed.toFixed(1)} vs ${swing.maxStrGreen.toFixed(1)})`,
        weightedScore, warning: 'momentum_change',
        detail: `Impulso rojo ${swing.impulseRatio.toFixed(1)}x más fuerte — posible retroceso, no reversión`
      };
    }
    return { trend: 'bullish', sequence: recent, strengths, strength: Math.abs(weightedScore), reason: `Mayoría verde ponderada (+${weightedScore.toFixed(1)})`, weightedScore };
  }
  if (weightedScore < -3) {
    const swing = analyzeSwingContext();
    if (swing && swing.dominantDir === 'bullish' && swing.impulseRatio >= 1.5) {
      return {
        trend: 'neutral', sequence: recent, strengths, strength: 0,
        reason: `Corrección bajista dentro de impulso alcista (${swing.maxStrGreen.toFixed(1)} vs ${swing.maxStrRed.toFixed(1)})`,
        weightedScore, warning: 'momentum_change',
        detail: `Impulso verde ${swing.impulseRatio.toFixed(1)}x más fuerte — posible retroceso, no reversión`
      };
    }
    return { trend: 'bearish', sequence: recent, strengths, strength: Math.abs(weightedScore), reason: `Mayoría roja ponderada (${weightedScore.toFixed(1)})`, weightedScore };
  }
  
  return { trend: 'neutral', sequence: recent, strengths, strength: 0, reason: 'Equilibrio o conflicto de fuerzas', weightedScore };
}

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
  const slice = data.slice(-3);
  return (slice.filter(h => h === 'G').length / 3) * 100;
}

function detectExtreme(trendMA, recentTrend) {
  // ── DETECCIÓN INDEPENDIENTE DE MA10 ───────────────────────────────────────

  // 1. Agotamiento post-capitulación
  // Fix: calibrar la fuerza de la señal según MA10.
  // Una R4🔥 con MA10=60% es una CORRECCIÓN dentro de tendencia alcista (rebote bajista),
  // no una capitulación de sobreventa. Solo es 'sobreventa extrema' real cuando MA10 es bajo.
  // Con MA10 alto, el agotamiento solo justifica 'warning', no bloqueo total.
  const exhaustion = detectPostCapitulationExhaustion();
  if (exhaustion.detected) {
    const maForExhaustion = trendMA !== null ? trendMA : 50; // default 50 si sin datos
    if (exhaustion.direction === 'bearish') {
      if (maForExhaustion <= 35) {
        // MA10 baja: capitulación real de sobreventa → bloqueo fuerte
        return {
          type: 'extreme_bearish', level: trendMA,
          message: `AGOTAMIENTO BAJISTA: ${exhaustion.reason}. Alta probabilidad de reversión alcista.`,
          action: 'wait_buy', confidence: 0.75
        };
      } else if (maForExhaustion <= 55) {
        // MA10 media: corrección notable → warning suave, no bloqueo
        return {
          type: 'warning_bearish', level: trendMA,
          message: `PAUSA BAJISTA: ${exhaustion.reason}. Posible rebote técnico (MA10 ${maForExhaustion.toFixed(0)}% — no es sobreventa real).`,
          action: 'caution', confidence: 0.55
        };
      }
      // MA10 >= 56%: corrección dentro de tendencia alcista → no señal de extremo
      // El Bear Trap ya maneja este caso visualmente
    } else {
      // Agotamiento alcista (G4🔥 + verdes débiles)
      if (maForExhaustion >= 65) {
        return {
          type: 'extreme_bullish', level: trendMA,
          message: `AGOTAMIENTO ALCISTA: ${exhaustion.reason}. Alta probabilidad de reversión bajista.`,
          action: 'wait_sell', confidence: 0.75
        };
      } else if (maForExhaustion >= 45) {
        return {
          type: 'warning_bullish', level: trendMA,
          message: `PAUSA ALCISTA: ${exhaustion.reason}. Posible corrección técnica (MA10 ${maForExhaustion.toFixed(0)}% — no es sobrecompra real).`,
          action: 'caution', confidence: 0.55
        };
      }
      // MA10 < 45%: impulso alcista dentro de tendencia bajista → no señal de extremo
    }
  }

  // ── CASO 2 FIX: Series extremas con historial corto (sin MA10) ────────────
  // Con < 10 velas, MA10 es null y los detectores de extremo no funcionan.
  // Si hay 5+ velas consecutivas de la misma dirección con fuerza total >= 8,
  // el mercado está sobreextendido incluso sin MA10.
  if (history.length < 10) {
    let consecG = 0, consecR = 0, strG = 0, strR = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const s = getCandleStrength(i) || 2;
      if (history[i] === 'G') {
        if (consecR > 0) break;
        consecG++; strG += s;
      } else {
        if (consecG > 0) break;
        consecR++; strR += s;
      }
    }
    if (consecG >= 5 && strG >= 8) {
      return {
        type: 'extreme_bullish', level: trendMA,
        message: `SOBREEXTENSIÓN ALCISTA: ${consecG} verdes consecutivas (fuerza ${strG.toFixed(1)}) sin historial suficiente para MA10. Muy probable corrección.`,
        action: 'wait_sell', confidence: 0.78
      };
    }
    if (consecR >= 5 && strR >= 8) {
      return {
        type: 'extreme_bearish', level: trendMA,
        message: `SOBREEXTENSIÓN BAJISTA: ${consecR} rojas consecutivas (fuerza ${strR.toFixed(1)}) sin historial suficiente para MA10. Muy probable rebote.`,
        action: 'wait_buy', confidence: 0.78
      };
    }
  }

  // 2. Patrón Wyckoff: SC → AR → ST (capitulación → rebote → retest más débil)
  const wyckoff = detectWyckoffPattern();
  if (wyckoff.detected) {
    if (wyckoff.type === 'accumulation') {
      return {
        type: 'extreme_bearish', level: trendMA,
        message: `ACUMULACIÓN WYCKOFF: SC(fuerza ${wyckoff.scStr}🔥) → rebote débil → ST(fuerza ${wyckoff.stStr}, < SC). Reversión alcista probable.`,
        action: 'wait_buy', confidence: wyckoff.confidence
      };
    } else {
      return {
        type: 'extreme_bullish', level: trendMA,
        message: `DISTRIBUCIÓN WYCKOFF: BC(fuerza ${wyckoff.scStr}🔥) → rebote débil → UT(fuerza ${wyckoff.stStr}, < BC). Reversión bajista probable.`,
        action: 'wait_sell', confidence: wyckoff.confidence
      };
    }
  }

  // ── LO QUE SIGUE REQUIERE trendMA ─────────────────────────────────────────
  if (trendMA === null) return null;

  // Sobreventa / sobrecompra por MA10
  const isExtrBull = trendMA >= EXTREME_THRESHOLDS.overbought && recentTrend.strength >= 4 && recentTrend.trend === 'bullish';
  const isExtrBear = trendMA <= EXTREME_THRESHOLDS.oversold   && recentTrend.strength >= 4 && recentTrend.trend === 'bearish';

  // Extremo por momentum aunque MA10 no haya llegado al umbral duro
  const momentumExtrBull = recentTrend.isExtreme && recentTrend.trend === 'bullish' && trendMA >= 70;
  const momentumExtrBear = recentTrend.isExtreme && recentTrend.trend === 'bearish' && trendMA <= 30;

  if (isExtrBull || momentumExtrBull) {
    const src = momentumExtrBull && !isExtrBull ? `momentum extremo (${recentTrend.strength} verdes fuertes)` : `MA10 al ${trendMA.toFixed(0)}%`;
    return {
      type: 'extreme_bullish', level: trendMA,
      message: `SOBRECOMPRA EXTREMA: ${src} con ${recentTrend.strength} velas verdes seguidas. Reversión bajista inminente.`,
      action: 'wait_sell', confidence: 0.85
    };
  }
  if (isExtrBear || momentumExtrBear) {
    const src = momentumExtrBear && !isExtrBear ? `momentum extremo (${recentTrend.strength} rojas fuertes)` : `MA10 al ${trendMA.toFixed(0)}%`;
    return {
      type: 'extreme_bearish', level: trendMA,
      message: `SOBREVENTA EXTREMA: ${src} con ${recentTrend.strength} velas rojas seguidas. Reversión alcista inminente.`,
      action: 'wait_buy', confidence: 0.85
    };
  }

  // Advertencias (no bloquean pero avisan)
  if (trendMA >= 80 && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) {
    return { type: 'warning_bullish', level: trendMA, message: `Sobrecompra: MA10 al ${trendMA.toFixed(0)}%. Precaución con compras.`, action: 'caution', confidence: 0.60 };
  }
  if (trendMA <= 20 && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) {
    return { type: 'warning_bearish', level: trendMA, message: `Sobreventa: MA10 al ${trendMA.toFixed(0)}%. Oportunidad de compra cercana.`, action: 'caution', confidence: 0.60 };
  }
  return null;
}

// Detecta cuando, tras una vela de capitulación (fuerza 4), las velas siguientes
// muestran pérdida de momentum — el movimiento se agota antes de revertir.
// Bug fix: ahora tolera una vela de rebote débil (AR de Wyckoff) en el medio.
function detectPostCapitulationExhaustion() {
  if (history.length < 4) return { detected: false };

  // Buscar la capitulación más reciente en las últimas 8 velas
  let capIdx = -1, capDir = null;
  for (let i = history.length - 2; i >= Math.max(0, history.length - 8); i--) {
    const s = getCandleStrength(i) || 2;
    if (s >= 4) {
      capIdx = i;
      capDir = history[i];
      break;
    }
  }
  if (capIdx === -1) return { detected: false };

  const postSlice = history.slice(capIdx + 1);
  if (postSlice.length < 2) return { detected: false };

  // Contar cuántas velas van en la MISMA dirección que la capitulación
  // Toleramos hasta 1 vela de rebote débil (fuerza < 2) en el medio (patrón AR)
  const postStr = [];
  for (let i = capIdx + 1; i < history.length; i++) {
    postStr.push(getCandleStrength(i) || 2);
  }

  let sameDirCount = 0, oppositeCount = 0, oppositeMaxStr = 0;
  postSlice.forEach((c, i) => {
    if (c === capDir) { sameDirCount++; }
    else { oppositeCount++; if (postStr[i] > oppositeMaxStr) oppositeMaxStr = postStr[i]; }
  });

  // Condición estricta: al menos 2 velas en dirección cap, y si hay opuesta, es débil (AR)
  const toleratedAR = oppositeCount <= 1 && oppositeMaxStr < 2.5;
  if (sameDirCount < 2 || !toleratedAR) return { detected: false };

  // Fuerza promedio de las velas en dirección de la capitulación
  const capDirStr = postSlice
    .map((c, i) => c === capDir ? postStr[i] : 0)
    .filter(s => s > 0);
  const avgPost = capDirStr.reduce((a, b) => a + b, 0) / capDirStr.length;

  const capStrength = getCandleStrength(capIdx) || 4;
  const exhausted = avgPost < 2.5 && capStrength >= 4 && sameDirCount >= 2;

  if (!exhausted) return { detected: false };

  const direction = capDir === 'R' ? 'bearish' : 'bullish';
  const dirLabel  = capDir === 'R' ? 'bajista' : 'alcista';
  const arNote    = oppositeCount > 0 ? ' (con rebote débil intermedio)' : '';

  return {
    detected: true,
    direction,
    capIdx,
    postCount: postSlice.length,
    avgPostStr: avgPost,
    reason: `Cap fuerza ${capStrength} hace ${postSlice.length} velas + continuación débil${arNote} (media ${avgPost.toFixed(1)}) — momentum ${dirLabel} agotándose`
  };
}

// Detecta el patrón Wyckoff SC → AR → ST (acumulación) o BC → AR → UT (distribución)
//
// ACUMULACIÓN: SC(R fuerte) → AR(G débil) → ST(R más débil que SC) → markup alcista
// DISTRIBUCIÓN: BC(G fuerte) → AR(R débil) → UT(G más débil que BC) → markdown bajista
//
// Condiciones de validez (4 fixes aplicados para reducir falsos positivos):
// Fix 1: Para DISTRIBUCIÓN, MA10 debe ser >= 55% en el momento del SC (contexto alcista real)
//        Para ACUMULACIÓN, MA10 debe ser <= 45% en el momento del SC (contexto bajista real)
// Fix 2: El AR debe tener fuerza >= 2 en al menos 1 vela (AR trivial de R1 no cuenta)
// Fix 3: Debe haber al menos 2 velas entre el AR y el ST/UT (patrón demasiado comprimido no es Wyckoff)
// Fix 4: Si hay una cap4 RECIENTE en la dirección OPUESTA al SC dentro de las últimas 15 velas,
//        el SC es probablemente un AR de un patrón mayor en la dirección contraria, no un SC real
function detectWyckoffPattern() {
  if (history.length < 6) return { detected: false };

  const trendMA10 = calcMA(10, false); // MA10 actual para validación de contexto

  const window = Math.min(12, history.length);
  const wSlice = history.slice(-window);
  const wStr   = [];
  for (let i = history.length - window; i < history.length; i++) {
    wStr.push(getCandleStrength(i) || 2);
  }

  for (let scOff = window - 3; scOff >= 1; scOff--) {
    const scStr = wStr[scOff];
    if (scStr < 3) continue;

    const scDir     = wSlice[scOff]; // R = SC acumulación, G = BC distribución
    const scAbsIdx  = history.length - window + scOff;

    // ── FIX 1: Validar contexto MA10 en el momento del SC ─────────────────
    // Calcular MA10 hasta (inclusive) el SC
    if (scAbsIdx >= 10) {
      const ma10AtSC = (history.slice(scAbsIdx - 9, scAbsIdx + 1).filter(c => c === 'G').length / 10) * 100;
      if (scDir === 'G' && ma10AtSC < 50) continue; // BC de distribución requiere MA10 >= 50%
      if (scDir === 'R' && ma10AtSC > 55) continue; // SC de acumulación requiere MA10 <= 55%
    }

    // ── FIX 4: Verificar que no hay cap4 opuesta reciente ─────────────────
    // Si hay una vela fuerza 4 en dirección opuesta al SC en las últimas 15 velas
    // ANTES del SC, el SC es más probablemente un AR de ese patrón mayor
    const oppositeDir  = scDir === 'R' ? 'G' : 'R';
    const lookbackStart = Math.max(0, scAbsIdx - 15);
    let hasOpposingCap4 = false;
    for (let i = lookbackStart; i < scAbsIdx; i++) {
      if (history[i] === oppositeDir && (getCandleStrength(i) || 2) >= 4) {
        hasOpposingCap4 = true;
        break;
      }
    }
    if (hasOpposingCap4) continue; // SC invalido — es AR de patrón opuesto mayor

    // ── Buscar AR: vela opuesta después del SC ─────────────────────────────
    let arEnd = -1, arMaxStr = 0;
    for (let j = scOff + 1; j < window; j++) {
      if (wSlice[j] !== scDir && wStr[j] < 2.5) {
        if (wStr[j] > arMaxStr) arMaxStr = wStr[j];
        arEnd = j;
        break;
      } else if (wSlice[j] !== scDir) {
        break; // AR demasiado fuerte → reversión real, no AR
      }
    }
    if (arEnd === -1) continue;

    // ── FIX 2: AR debe tener fuerza real (no un doji irrelevante) ──────────
    if (arMaxStr < 1.5) continue; // AR de fuerza < 1.5 no es un rebote real

    // ── Buscar ST/UT: misma dirección que SC, más débil ───────────────────
    let stIdx = -1, stStr = 0;
    for (let j = arEnd + 1; j < window; j++) {
      if (wSlice[j] === scDir && wStr[j] >= 1.5 && wStr[j] < scStr) {
        stIdx = j;
        stStr = wStr[j];
        break;
      }
    }
    if (stIdx === -1) continue;

    // ── FIX 3: Debe haber al menos 2 velas entre AR y ST ──────────────────
    if (stIdx - arEnd < 2) continue; // patrón demasiado comprimido

    // ── Verificar velas post-ST ────────────────────────────────────────────
    const postST    = wSlice.slice(stIdx + 1);
    const postSTStr = wStr.slice(stIdx + 1);
    if (postST.length === 0) continue;

    const avgPostST       = postSTStr.reduce((a, b) => a + b, 0) / postSTStr.length;
    const postSTHasOpp    = postST.some(c => c !== scDir);
    const postSTWeak      = avgPostST < 2.5;

    if (!postSTWeak && !postSTHasOpp) continue;

    // ── Calcular confianza ─────────────────────────────────────────────────
    let conf = 0.62;
    if (scStr >= 4)           conf += 0.10;
    if (stStr < scStr - 1)    conf += 0.08;
    if (postST.length >= 2)   conf += 0.05;
    if (postSTHasOpp)         conf += 0.07;
    if (arMaxStr >= 2)        conf += 0.04; // AR robusto aumenta confianza
    if (stIdx - arEnd >= 3)   conf += 0.03; // más separación SC→ST = más fiable

    return {
      detected: true,
      type: scDir === 'R' ? 'accumulation' : 'distribution',
      scStr, stStr,
      confidence: Math.min(conf, 0.88)
    };
  }

  return { detected: false };
}


// fastPeriod = 2 → miramos las últimas 2 velas (las que movieron MA2).
function getCrossCreatorMetrics(crossType, fastPeriod) {
  const n = Math.min(fastPeriod, history.length);
  const creatorSlice = history.slice(-n);
  const strengthSlice = [];
  for (let i = history.length - n; i < history.length; i++) {
    strengthSlice.push(getCandleStrength(i) || 2);
  }

  const avgStr   = strengthSlice.reduce((a, b) => a + b, 0) / n;
  const maxStr   = Math.max(...strengthSlice);
  const allWeak  = strengthSlice.every(s => s < 2);       // todos son doji/débil
  const anyStrong = strengthSlice.some(s => s >= 3);      // al menos uno es fuerte

  // ¿Las velas que crearon el cruce van en la dirección CORRECTA del cruce?
  const expectedColor = crossType === 'golden' ? 'G' : 'R';
  const allCorrectDir = creatorSlice.every(c => c === expectedColor);

  // Fuerza total del lado opuesto en las últimas 5 velas (presión contraria reciente)
  const last5 = history.slice(-5);
  const last5str = [];
  for (let i = history.length - 5; i < history.length; i++) {
    if (i >= 0) last5str.push(getCandleStrength(i) || 2);
  }
  const oppositeColor = crossType === 'golden' ? 'R' : 'G';
  let oppositeForce = 0, ownForce = 0;
  last5.forEach((c, i) => {
    const s = last5str[i] || 2;
    if (c === oppositeColor) oppositeForce += s;
    else ownForce += s;
  });
  const forceRatio = ownForce > 0 ? oppositeForce / ownForce : 99;  // ratio R/G o G/R

  // ¿Hay una capitulación reciente en dirección opuesta? (fuerza 4 en últimas 5 velas)
  let recentCapitulation = false;
  for (let i = history.length - 5; i < history.length; i++) {
    if (i >= 0 && history[i] === oppositeColor && (getCandleStrength(i) || 2) >= 4) {
      recentCapitulation = true;
      break;
    }
  }

  return { avgStr, maxStr, allWeak, anyStrong, allCorrectDir, forceRatio, oppositeForce, ownForce, recentCapitulation };
}

function isTrap(crossType, trendMA, recentTrend, currentCandle, extremeCondition, fastPeriod = 2) {
  if (trendMA === null) return false;

  // ── Reglas originales ──────────────────────────────────────────────────────
  if (extremeCondition) {
    if (extremeCondition.type === 'extreme_bullish' && crossType === 'golden') return true;
    if (extremeCondition.type === 'extreme_bearish' && crossType === 'death')  return true;
  }

  // Reversión genuina fuerte: no bloquear
  if (currentCandle.isReversal && currentCandle.strength >= 3) return false;

  if (crossType === 'golden' && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) return true;
  if (crossType === 'death'  && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) return true;

  if (trendMA >= 45 && trendMA <= 55) {
    // En zona neutral no bloquear por MA, pero sí por calidad del cruce
  } else {
    if (crossType === 'golden' && trendMA < 35) return true;
    if (crossType === 'death'  && trendMA > 65) return true;
  }

  // ── FILTRO 1: Velas creadoras del cruce demasiado débiles ──────────────────
  // Si MA2 cruzó MA10 pero lo hicieron dos Dojis (fuerza < 2), el cruce no
  // tiene momentum real detrás — es ruido estadístico, no señal.
  const cm = getCrossCreatorMetrics(crossType, fastPeriod);

  if (cm.allWeak) {
    // Todas las velas creadoras son débiles (fuerza < 2) → trampa segura
    return true;
  }

  // ── FILTRO 2: Ratio de fuerza contraria > 1.8x en las últimas 5 velas ──────
  // La presión del lado opuesto más que duplica la del lado del cruce.
  // En tu caso: rojas=7 vs verdes=3 → ratio 2.33 → trampa.
  if (cm.forceRatio > 1.8 && !cm.anyStrong) {
    // Solo si el cruce no viene de una vela genuinamente fuerte
    return true;
  }

  // ── FILTRO 3: Capitulación reciente en dirección opuesta ──────────────────
  // Una vela fuerza 4 en dirección opuesta hace 1-4 velas es demasiado reciente
  // para que un cruce débil la supere. Requiere confirmación adicional.
  if (cm.recentCapitulation && cm.avgStr < 2.5) {
    return true;
  }

  // ── FILTRO 4: WeightedScore del contexto opuesto al cruce ─────────────────
  // Si el score ponderado va en dirección OPUESTA al cruce (aunque sea leve),
  // y además las velas creadoras son débiles (<2.5 promedio), es trampa.
  if (crossType === 'golden' && recentTrend.weightedScore < -0.5 && cm.avgStr < 2) {
    return true;
  }
  if (crossType === 'death' && recentTrend.weightedScore > 0.5 && cm.avgStr < 2) {
    return true;
  }

  return false;
}

function detectCrosses(useOriginal = false) {
  const results = [];
  const trendMA = calcMA(MA_CONFIG.trend.period, useOriginal);
  const prevTrendMA = calcPrevMA(MA_CONFIG.trend.period, useOriginal);
  const recentTrend = analyzeRecentTrend();
  const currentCandle = analyzeCurrentCandle();
  const extremeCondition = detectExtreme(trendMA, recentTrend);
  
  for (let cfg of MA_CONFIG.crosses) {
    const maFast = calcMA(cfg.fast, useOriginal);
    const maSlow = calcMA(cfg.slow, useOriginal);
    
    if (maFast === null || maSlow === null) continue;
    
    let crossed = false, crossType = null, trap = false, trapReason = '';
    
    let data = history;
    if (!useOriginal && manualTrapIndex !== null) {
      data = history.filter((_, idx) => idx !== manualTrapIndex);
    }
    
    if (data.length > cfg.slow) {
      const prevFast = calcPrevMA(cfg.fast, useOriginal);
      const prevSlow = calcPrevMA(cfg.slow, useOriginal);
      
      if (prevFast !== null && prevSlow !== null) {
        if (prevFast <= prevSlow && maFast > maSlow) {
          crossed = true; crossType = 'golden';
          trap = isTrap('golden', trendMA, recentTrend, currentCandle, extremeCondition, cfg.fast);
          if (trap) {
            const cm = getCrossCreatorMetrics('golden', cfg.fast);
            if (cm.allWeak)                              trapReason = 'Velas creadoras débiles (doji)';
            else if (cm.recentCapitulation && cm.avgStr < 2.5) trapReason = 'Capitulación bajista reciente';
            else if (cm.forceRatio > 1.8)                trapReason = `Presión bajista ${cm.forceRatio.toFixed(1)}x mayor`;
            else if (recentTrend.weightedScore < -0.5)   trapReason = `Score ponderado bajista (${recentTrend.weightedScore.toFixed(1)})`;
            else                                          trapReason = 'Tendencia en contra';
          }
        } else if (prevFast >= prevSlow && maFast < maSlow) {
          crossed = true; crossType = 'death';
          trap = isTrap('death', trendMA, recentTrend, currentCandle, extremeCondition, cfg.fast);
          if (trap) {
            const cm = getCrossCreatorMetrics('death', cfg.fast);
            if (cm.allWeak)                              trapReason = 'Velas creadoras débiles (doji)';
            else if (cm.recentCapitulation && cm.avgStr < 2.5) trapReason = 'Capitulación alcista reciente';
            else if (cm.forceRatio > 1.8)                trapReason = `Presión alcista ${cm.forceRatio.toFixed(1)}x mayor`;
            else if (recentTrend.weightedScore > 0.5)    trapReason = `Score ponderado alcista (${recentTrend.weightedScore.toFixed(1)})`;
            else                                          trapReason = 'Tendencia en contra';
          }
        }
      }
    }
    
    results.push({
      pair: cfg.name, type: cfg.type, maFast, maSlow,
      diff: maFast - maSlow, crossed, crossType, trap, trapReason,
      active: Math.abs(maFast - maSlow) < 5,
      isExtreme: maFast >= 90 || maSlow >= 90 || maFast <= 10 || maSlow <= 10
    });
  }
  
  return { crosses: results, trendMA, prevTrendMA, recentTrend, currentCandle, extremeCondition };
}

function getTrendLabel(currentValue, prevValue, extremeCondition = null) {
  if (extremeCondition && extremeCondition.type === 'extreme_bullish') {
    return { text: '⚠️ EXTREMO ALCISTA', class: 'extreme-bullish', color: 'var(--red)', isExtreme: true, note: 'Reversión bajista inminente' };
  }
  if (extremeCondition && extremeCondition.type === 'extreme_bearish') {
    return { text: '⚠️ EXTREMO BAJISTA', class: 'extreme-bearish', color: 'var(--green)', isExtreme: true, note: 'Reversión alcista inminente' };
  }
  
  if (prevValue === null || currentValue === null) {
    if (currentValue > 55) return { text: 'ALCISTA ↑', class: 'bullish', color: 'var(--green)', isExtreme: false };
    if (currentValue < 45) return { text: 'BAJISTA ↓', class: 'bearish', color: 'var(--red)', isExtreme: false };
    return { text: 'NEUTRAL →', class: 'neutral', color: 'var(--gold)', isExtreme: false };
  }
  
  const diff = currentValue - prevValue;
  const trendDirection = diff > 0 ? 'rising' : diff < 0 ? 'falling' : 'flat';
  
  if (trendDirection === 'falling' && diff < -10) return { text: 'BAJISTA ↓↓', class: 'bearish', color: 'var(--red)', isExtreme: false, note: `Cayendo fuerte (${diff.toFixed(1)}%)` };
  if (trendDirection === 'rising' && diff > 10) return { text: 'ALCISTA ↑↑', class: 'bullish', color: 'var(--green)', isExtreme: false, note: `Subiendo fuerte (+${diff.toFixed(1)}%)` };
  
  if (currentValue > 55 && trendDirection === 'falling') return { text: 'ALCISTA ↓', class: 'weakening-bullish', color: 'var(--orange)', isExtreme: false, note: `Perdiendo fuerza (${diff.toFixed(1)}%)` };
  if (currentValue < 45 && trendDirection === 'rising') return { text: 'BAJISTA ↑', class: 'strengthening-bearish', color: 'var(--cyan)', isExtreme: false, note: `Ganando fuerza (+${diff.toFixed(1)}%)` };
  
  if (currentValue > 55) {
    const arrow = trendDirection === 'rising' ? '↑' : trendDirection === 'falling' ? '↗' : '→';
    return { text: `ALCISTA ${arrow}`, class: 'bullish', color: 'var(--green)', isExtreme: false, note: trendDirection !== 'flat' ? `Momentum: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Estable' };
  }
  if (currentValue < 45) {
    const arrow = trendDirection === 'falling' ? '↓' : trendDirection === 'rising' ? '↘' : '→';
    return { text: `BAJISTA ${arrow}`, class: 'bearish', color: 'var(--red)', isExtreme: false, note: trendDirection !== 'flat' ? `Momentum: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Estable' };
  }
  
  return { text: 'NEUTRAL →', class: 'neutral', color: 'var(--gold)', isExtreme: false, note: diff !== 0 ? `Cambiando: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : 'Sin dirección clara' };
}

function analyzePattern(lastTwo, originalTwo = null, extremeCondition = null) {
  if (lastTwo.length < 2) return null;
  
  const [prev, curr] = lastTwo;
  const pattern = prev + curr;
  
  let extremeMultiplier = 1;
  if (extremeCondition) {
    if (extremeCondition.type === 'extreme_bullish') extremeMultiplier = 0.3;
    if (extremeCondition.type === 'extreme_bearish') extremeMultiplier = 0.3;
  }
  
  const scenarios = {
    'GG': { 
      ifG: { pat: 'GGG', sig: 'COMPRA', conf: 0.75 * extremeMultiplier, desc: 'Continuación alcista' },
      ifR: { pat: 'GGR', sig: 'VENTA', conf: 0.85, desc: 'Reversión bajista FUERTE (después de extremo)' }
    },
    'RR': {
      ifG: { pat: 'RRG', sig: 'COMPRA', conf: 0.85, desc: 'Reversión alcista FUERTE (después de extremo)' },
      ifR: { pat: 'RRR', sig: 'VENTA', conf: 0.75 * extremeMultiplier, desc: 'Continuación bajista' }
    },
    'GR': {
      ifG: { pat: 'GRG', sig: 'COMPRA', conf: 0.55 * extremeMultiplier, desc: 'Reversión alcista' },
      ifR: { pat: 'GRR', sig: 'VENTA', conf: 0.65, desc: 'Confirmación bajista' }
    },
    'RG': {
      ifG: { pat: 'RGG', sig: 'COMPRA', conf: 0.65, desc: 'Confirmación alcista' },
      ifR: { pat: 'RGR', sig: 'VENTA', conf: 0.55 * extremeMultiplier, desc: 'Reversión bajista' }
    }
  };
  
  return scenarios[pattern] || null;
}

// ===== NUEVO: ACTUALIZACIÓN PANEL CMD =====

function updateCMDPanel() {
  const cmd = detectCMDPhase();
  cmdState = cmd;
  
  if (!cmd.allPhases) {
    cmd.allPhases = [
      { name: 'consolidation', probability: 0 },
      { name: 'manipulation', probability: 0 },
      { name: 'distribution', probability: 0 },
      { name: 'accumulation', probability: 0 }
    ];
  }
  
  const indicator = document.getElementById('cmd-phase-indicator');
  indicator.className = 'cmd-phase-indicator';
  if (cmd.phase !== 'none') {
    indicator.classList.add(cmd.phase);
  }
  
  const phases = ['consolidation', 'manipulation', 'distribution', 'accumulation'];
  const phaseNames = {
    consolidation: 'Consolidación',
    manipulation: 'Manipulación', 
    distribution: 'Distribución',
    accumulation: 'Acumulación'
  };
  
  phases.forEach(phase => {
    const phaseData = cmd.allPhases.find(p => p.name === phase);
    const item = document.getElementById('cmd-' + phase);
    const valEl = document.getElementById(phase + '-val');
    const probEl = document.getElementById(phase + '-prob');
    
    if (phaseData) {
      valEl.textContent = phaseData.probability > 0.3 ? 
        (phaseData.description ? phaseData.description.split(':')[0] : 'Detectado') : 
        '--';
      probEl.textContent = Math.round(phaseData.probability * 100) + '%';
      
      item.classList.toggle('active', cmd.phase === phase);
    }
  });
  
  const alert = document.getElementById('cmd-alert');
  const alertTitle = document.getElementById('cmd-alert-title');
  const alertText = document.getElementById('cmd-alert-text');
  
  if (cmd.phase !== 'none') {
    alert.classList.add('active');
    const phaseData = cmd.allPhases.find(p => p.name === cmd.phase);
    alertTitle.textContent = `🎯 ${phaseNames[cmd.phase].toUpperCase()} DETECTADA (${Math.round(cmd.probability * 100)}%)`;
    alertText.textContent = phaseData?.description || 'Actividad institucional detectada en el mercado';
  } else {
    alert.classList.remove('active');
  }
  
  const whaleActivity = document.getElementById('whale-activity');
  if (cmd.probability > 0.5) {
    whaleActivity.style.display = 'block';
    
    let retail, smart, whale;
    if (cmd.phase === 'manipulation') {
      retail = 20; smart = 30; whale = 50;
    } else if (cmd.phase === 'distribution') {
      retail = 50; smart = 35; whale = 15;
    } else if (cmd.phase === 'accumulation') {
      retail = 15; smart = 25; whale = 60;
    } else {
      retail = 40; smart = 35; whale = 25;
    }
    
    document.getElementById('whale-retail').style.width = retail + '%';
    document.getElementById('whale-smart').style.width = smart + '%';
    document.getElementById('whale-whale').style.width = whale + '%';
  } else {
    whaleActivity.style.display = 'none';
  }
}

// ===== DETECTOR DE TRAMPA DE VELA (Bear Trap / Bull Trap) =====
//
// Lógica: Una "trampa" ocurre cuando la vela actual va en dirección CONTRARIA
// a N velas previas consecutivas FUERTES, especialmente después de capitulación,
// en una zona de extremo, o cuando su propia fuerza no justifica la reversión.
//
// Bear Trap: velas rojas fuertes → vela verde débil/media (posible trampa alcista)
// Bull Trap: velas verdes fuertes → vela roja débil/media (posible trampa bajista)

function detectCandleTrap() {
  if (history.length < 3) return null;

  const idx        = history.length - 1;
  const current    = history[idx];
  const currStr    = getCandleStrength(idx) || 2;
  const trendMA    = calcMA(10, false);

  // Contar velas previas consecutivas en dirección opuesta
  const opposite   = current === 'G' ? 'R' : 'G';
  let consecOpposite = 0;
  let totalOppStr  = 0;
  let maxOppStr    = 0;

  for (let i = idx - 1; i >= 0 && history[i] === opposite; i--) {
    consecOpposite++;
    const s = getCandleStrength(i) || 2;
    totalOppStr += s;
    if (s > maxOppStr) maxOppStr = s;
  }

  // Necesitamos al menos 2 velas previas en dirección opuesta para considerar trampa
  if (consecOpposite < 2) return null;

  // ── Calculo de probabilidad de trampa ──────────────────────────────────────
  let trapProb = 0;
  const reasons = [];

  // 1. Número de velas opuestas (más velas = más probable trampa)
  if (consecOpposite >= 2) { trapProb += 0.20; reasons.push(`${consecOpposite} velas ${opposite === 'R' ? 'rojas' : 'verdes'} previas`); }
  if (consecOpposite >= 3) { trapProb += 0.15; }
  if (consecOpposite >= 4) { trapProb += 0.10; }

  // 2. Fuerza de las velas opuestas (capitulación previa = trampa más probable)
  if (maxOppStr >= 4)      { trapProb += 0.25; reasons.push('Capitulación previa (fuerza 4)'); }
  else if (maxOppStr >= 3) { trapProb += 0.15; reasons.push('Vela fuerte previa (fuerza 3)'); }

  // 3. Fuerza de la vela actual (cuanto más débil, más probable es trampa)
  if (currStr <= 1)        { trapProb += 0.20; reasons.push('Vela actual muy débil (Doji)'); }
  else if (currStr <= 1.5) { trapProb += 0.15; reasons.push('Vela actual débil'); }
  else if (currStr === 2)  { trapProb += 0.08; reasons.push('Vela actual media'); }
  // Fuerza 3+ reduce probabilidad de trampa (reversión genuina)
  else if (currStr >= 3)   { trapProb -= 0.25; }

  // 4. Posición en extremo de mercado (el extremo amplifica el riesgo de trampa)
  if (trendMA !== null) {
    if (current === 'G' && trendMA <= 15) { trapProb += 0.15; reasons.push(`MA10 en sobreventa (${trendMA.toFixed(0)}%) — posible spring falso`); }
    if (current === 'R' && trendMA >= 85) { trapProb += 0.15; reasons.push(`MA10 en sobrecompra (${trendMA.toFixed(0)}%) — posible upthrust falso`); }
    // En extremo bajista, una verde débil después de rojas es clásica bear trap
    if (current === 'G' && trendMA <= 30 && consecOpposite >= 3) { trapProb += 0.10; }
    // En extremo alcista, una roja después de verdes es bull trap
    if (current === 'R' && trendMA >= 70 && consecOpposite >= 3) { trapProb += 0.10; }
  }

  // 5. Fase CMD amplifica o reduce
  if (cmdState.phase === 'manipulation' && cmdState.probability > 0.5) {
    trapProb += 0.15;
    reasons.push(`Fase CMD: Manipulación (${Math.round(cmdState.probability * 100)}%)`);
  }
  if (cmdState.phase === 'accumulation' && current === 'G') {
    trapProb -= 0.15; // Acumulación genuina reduce riesgo de bear trap
  }
  if (cmdState.phase === 'distribution' && current === 'R') {
    trapProb -= 0.15; // Distribución genuina reduce riesgo de bull trap
  }

  // 6. Fuerza total acumulada opuesta vs fuerza de la reversión
  const strengthRatio = currStr / (totalOppStr / consecOpposite);
  if (strengthRatio < 0.5) {
    trapProb += 0.10;
    reasons.push(`Reversión débil vs tendencia previa (ratio ${strengthRatio.toFixed(1)}x)`);
  }

  trapProb = Math.max(0, Math.min(trapProb, 0.97));

  // Umbral mínimo para mostrar alerta: 35%
  if (trapProb < 0.35) return null;

  // ── Construir resultado ────────────────────────────────────────────────────
  const isBearTrap = current === 'G'; // Verde después de rojas = Bear Trap
  const isBullTrap = current === 'R'; // Roja después de verdes = Bull Trap

  // Obtener las velas que forman el patrón (hasta 5 previas + actual)
  const patternStart = Math.max(0, idx - Math.min(consecOpposite, 5));
  const patternCandles = [];
  for (let i = patternStart; i <= idx; i++) {
    patternCandles.push({
      color: history[i],
      strength: getCandleStrength(i) || 2,
      isTrigger: i === idx
    });
  }

  // Etiqueta de nivel de amenaza
  let threatLevel, threatColor;
  if (trapProb >= 0.75)      { threatLevel = 'MUY ALTO';  threatColor = '#ff4444'; }
  else if (trapProb >= 0.60) { threatLevel = 'ALTO';      threatColor = '#ff8800'; }
  else if (trapProb >= 0.45) { threatLevel = 'MODERADO';  threatColor = '#ffd700'; }
  else                        { threatLevel = 'BAJO';      threatColor = '#aaa'; }

  return {
    detected: true,
    type: isBearTrap ? 'bear-trap' : 'bull-trap',
    typeLabel: isBearTrap ? '🐻 BEAR TRAP' : '🐂 BULL TRAP',
    subtitle: isBearTrap
      ? `Verde débil después de ${consecOpposite} rojas — posible trampa alcista`
      : `Roja débil después de ${consecOpposite} verdes — posible trampa bajista`,
    probability: trapProb,
    threatLevel,
    threatColor,
    consecOpposite,
    maxOppStr,
    currStr,
    reasons,
    patternCandles,
    action: isBearTrap
      ? 'NO COMPRAR aún — esperar confirmación con segunda vela verde fuerte'
      : 'NO VENDER aún — esperar confirmación con segunda vela roja fuerte'
  };
}

function updateCandleTrapAlert() {
  const el = document.getElementById('candle-trap-alert');
  const trap = detectCandleTrap();

  if (!trap) {
    el.classList.remove('active', 'bear-trap', 'bull-trap');
    return;
  }

  // Tipo CSS
  el.classList.remove('bear-trap', 'bull-trap');
  el.classList.add('active', trap.type);

  // Header
  document.getElementById('trap-alert-icon').textContent = trap.type === 'bear-trap' ? '🪤' : '🪤';
  document.getElementById('trap-alert-title').textContent = `⚠️ ${trap.typeLabel} — ${trap.threatLevel}`;
  document.getElementById('trap-alert-subtitle').textContent = trap.subtitle;

  // Estadísticas
  document.getElementById('trap-type-value').textContent = trap.typeLabel;
  document.getElementById('trap-type-value').style.color = trap.threatColor;
  document.getElementById('trap-conf-value').textContent = Math.round(trap.probability * 100) + '%';
  document.getElementById('trap-conf-value').style.color = trap.threatColor;

  // Secuencia visual de velas
  const seqEl = document.getElementById('trap-sequence-display');
  seqEl.innerHTML = trap.patternCandles.map((c, i) => {
    const cls = c.color.toLowerCase();
    const strLabel = c.strength >= 3 ? '▰▰▰' : c.strength >= 2 ? '▰▰' : '▰';
    const triggerCls = c.isTrigger ? ' trigger' : '';
    const arrow = i < trap.patternCandles.length - 1 ? '<span class="trap-seq-arrow">›</span>' : '';
    return `<div class="trap-seq-candle ${cls}${triggerCls}" title="Fuerza ${c.strength}">${c.color}</div>${arrow}`;
  }).join('') +
  `<span class="trap-seq-label">← Vela trampa potencial</span>`;

  // Razones
  const reasonsText = trap.reasons.join(' · ');
  document.getElementById('trap-alert-reason').innerHTML =
    `<strong>Por qué es sospechosa:</strong> ${reasonsText}<br>` +
    `<strong style="color:var(--gold)">⚡ Acción:</strong> ${trap.action}`;

  // Barra de confianza
  document.getElementById('trap-confidence-fill').style.width = (trap.probability * 100) + '%';
}

// ===== ACTUALIZACIÓN PRINCIPAL =====

function update() {
  updateSuggestionPanel();
  updateCMDPanel();
  updateCandleTrapAlert();  // ← Detector de Bear/Bull Trap

  // ⚠️ ORDEN IMPORTANTE: updatePredictionPanel debe ejecutarse ANTES de la lógica
  // de señal porque escribe predictionState, que la señal lee para el puente.
  updatePredictionPanel();  // ← Predicción + escribe predictionState
  
  // Calcular y mostrar Volume Profile
  calculateVolumeProfile();
  updateVolumeProfileDisplay();
  
  const adjustedResult = detectCrosses(false);
  const originalResult = detectCrosses(true);
  
  const shortMA = calcShortMA();
  const prevShortMA = history.length > 3 ? 
    (history.slice(-4, -1).filter(h => h === 'G').length / 3) * 100 : null;
  
  const trendMA = adjustedResult.trendMA;
  const prevTrendMA = adjustedResult.prevTrendMA;
  const recentTrend = adjustedResult.recentTrend;
  const currentCandle = adjustedResult.currentCandle;
  const extremeCondition = adjustedResult.extremeCondition;
  
  if (manualTrapIndex !== null && originalResult.trendMA !== null) {
    originalTrendMA = originalResult.trendMA;
  }
  
  const extremeAlert = document.getElementById('extreme-alert');
  if (extremeCondition && (extremeCondition.type === 'extreme_bullish' || extremeCondition.type === 'extreme_bearish')) {
    extremeAlert.classList.add('active');
    document.getElementById('extreme-text').textContent = extremeCondition.message;
  } else {
    extremeAlert.classList.remove('active');
  }
  
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
  } else {
    currentAnalysis.classList.remove('active');
  }
  
  const recentSequence = document.getElementById('recent-sequence');
  const recentAnalysis = document.getElementById('recent-analysis');
  
  if (recentTrend.sequence.length > 0) {
    recentSequence.innerHTML = recentTrend.sequence.map((c, i) => {
      const isLast = i === recentTrend.sequence.length - 1;
      const strength = recentTrend.strengths[i] || 2;
      const indicator = strength >= 3 ? '▰▰▰' : strength === 2 ? '▰▰' : '▰';
      return `<div class="recent-candle recent-candle-${c.toLowerCase()} ${isLast?'candle-new':''}" title="Fuerza: ${strength}/3">
                ${c}<span style="font-size:7px;position:absolute;bottom:2px;">${indicator}</span>
              </div>`;
    }).join('');
    
    let analysisClass = 'recent-' + recentTrend.trend;
    if (recentTrend.isExtreme) analysisClass = 'recent-extreme';
    else if (recentTrend.warning === 'momentum_change') analysisClass = 'recent-conflict';
    else if (cmdState.phase !== 'none') analysisClass = 'recent-cmd';
    
    recentAnalysis.className = 'recent-analysis ' + analysisClass;
    recentAnalysis.innerHTML = `<strong>${recentTrend.reason}</strong>${recentTrend.detail?'<br><small>'+recentTrend.detail+'</small>':''}`;
  }
  
  const momentumBox = document.getElementById('momentum-box');
  if (trendMA !== null) {
    momentumBox.style.display = 'block';
    const fill = document.getElementById('momentum-fill');
    const diff = prevTrendMA !== null ? (trendMA - prevTrendMA).toFixed(1) : '0.0';
    document.getElementById('momentum-detail').textContent = `MA10: ${trendMA.toFixed(1)}% (${diff > 0 ? '+' : ''}${diff}%) | Fuerza sugerida: ${autoSuggestedStrength}/4`;
    fill.style.width = trendMA + '%';
    
    if (extremeCondition && extremeCondition.type === 'extreme_bullish') fill.className = 'momentum-fill extreme-bullish';
    else if (extremeCondition && extremeCondition.type === 'extreme_bearish') fill.className = 'momentum-fill extreme-bearish';
    else fill.className = 'momentum-fill ' + (trendMA > 55 ? 'bullish' : trendMA < 45 ? 'bearish' : 'neutral');
  } else {
    momentumBox.style.display = 'none';
  }
  
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
  
  const trendBox = document.getElementById('trend-box');
  const trendValue = document.getElementById('trend-value');
  
  if (trendMA !== null) {
    const trend = getTrendLabel(trendMA, prevTrendMA, extremeCondition);
    trendBox.className = 'trend-box ' + trend.class + (manualTrapIndex !== null ? ' adjusted' : '');
    trendValue.textContent = trend.text;
    trendValue.style.color = trend.color;
    
    const noteEl = document.getElementById('momentum-note');
    if (trend.note) {
      noteEl.textContent = trend.note;
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }
  } else {
    trendBox.className = 'trend-box neutral' + (manualTrapIndex !== null ? ' adjusted' : '');
    trendValue.textContent = 'SIN DATOS';
    document.getElementById('momentum-note').style.display = 'none';
  }
  
  const shortTrendBox = document.getElementById('short-trend-box');
  const shortTrendValue = document.getElementById('short-trend-value');

  if (shortMA !== null) {
    const shortDiff = prevShortMA !== null ? shortMA - prevShortMA : 0;
    let shortText = 'NEUTRAL →';
    let shortClass = 'neutral';
    let shortColor = 'var(--gold)';
    let shortNote = '';
    
    if (shortMA > 66) {
      shortText = shortDiff > 10 ? 'ALCISTA ↑↑' : 'ALCISTA ↑';
      shortClass = 'bullish';
      shortColor = 'var(--green)';
      shortNote = shortDiff > 0 ? `(+${shortDiff.toFixed(1)}%)` : 'Estable';
    } else if (shortMA < 34) {
      shortText = shortDiff < -10 ? 'BAJISTA ↓↓' : 'BAJISTA ↓';
      shortClass = 'bearish';
      shortColor = 'var(--red)';
      shortNote = shortDiff < 0 ? `(${shortDiff.toFixed(1)}%)` : 'Estable';
    } else {
      shortNote = shortDiff > 5 ? `Subiendo (+${shortDiff.toFixed(1)}%)` : 
                  shortDiff < -5 ? `Bajando (${shortDiff.toFixed(1)}%)` : 'Sin dirección';
    }
    
    shortTrendBox.className = 'trend-box ' + shortClass;
    shortTrendValue.textContent = shortText;
    shortTrendValue.style.color = shortColor;
    document.getElementById('short-momentum-note').textContent = shortNote;
  } else {
    shortTrendBox.className = 'trend-box neutral';
    shortTrendValue.textContent = 'SIN DATOS';
  }
  
  const maResults = adjustedResult.crosses;
  document.getElementById('ma-grid').innerHTML = maResults.map(r => {
    const isExtreme = r.maFast >= 90 || r.maSlow >= 90 || r.maFast <= 10 || r.maSlow <= 10;
    const trapLabel = r.trap && r.trapReason ? `⚠️ ${r.trapReason}` : r.trap ? '⚠️ TRAMPA' : '';
    return `<div class="ma-item ${r.crossed ? 'active' : ''} ${r.trap ? 'trap' : ''} ${isExtreme ? 'extreme' : ''}" title="${r.trap ? r.trapReason : ''}">
      <div class="ma-name">${r.pair}</div>
      <div class="ma-val ${r.diff > 0 ? 'ma-up' : 'ma-down'} ${isExtreme ? 'ma-extreme' : ''}">${r.maFast.toFixed(0)}|${r.maSlow.toFixed(0)}</div>
      <div style="font-size:0.65em;color:${r.trap ? 'var(--purple)' : r.crossed ? 'var(--gold)' : isExtreme ? 'var(--red)' : '#666'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${r.trapReason || ''}">${trapLabel || (r.crossed ? '✓ CRUCE' : isExtreme ? 'EXTREMO' : r.type)}</div>
    </div>`;
  }).join('');
  
  const activeCross = maResults.find(r => r.crossed && !r.trap) || maResults.find(r => r.crossed);
  if (activeCross && !extremeCondition) {
    document.getElementById('cross-alert').classList.add('show');
    document.getElementById('cross-pair').textContent = activeCross.pair;
    const typeEl = document.getElementById('cross-type');
    typeEl.textContent = activeCross.crossType === 'golden' ? 'GOLDEN CROSS' : 'DEATH CROSS';
    typeEl.className = activeCross.crossType === 'golden' ? 'cross-type-golden' : 'cross-type-death';
  } else {
    document.getElementById('cross-alert').classList.remove('show');
  }
  
  const mainSignal = document.getElementById('main-signal');
  const priorityExplanation = document.getElementById('priority-explanation');
  const logicExplanation = document.getElementById('logic-explanation');
  
  let effectiveHistory = history;
  if (manualTrapIndex !== null) effectiveHistory = history.filter((_, idx) => idx !== manualTrapIndex);
  const lastTwo = effectiveHistory.slice(-2);
  const proj = lastTwo.length >= 2 ? analyzePattern(lastTwo, null, extremeCondition) : null;
  
  let finalSignal = 'wait', signalClass = 'signal-wait', signalText = 'ESPERAR';
  let showReversal = false, showExtreme = false, showCMD = false, showVP = false, logicText = '';
  
  const vp = volumeProfile;
  
  // ========== PRIORIDAD 0: EXTREMO (CORREGIDO - BLOQUEO ABSOLUTO) ==========
  if (extremeCondition && (extremeCondition.type === 'extreme_bullish' || extremeCondition.type === 'extreme_bearish')) {
    showExtreme = true;
    
    if (extremeCondition.type === 'extreme_bullish') {
      // SOBRECOMPRA EXTREMA: NUNCA comprar, solo vender o esperar
      
      // Fix 2 simétrico: Bull Trap ≥ 75% + extreme_bullish → ESPERAR
      const trapCheckBull = detectCandleTrap();
      const hasBullTrapConflict = trapCheckBull &&
        trapCheckBull.type === 'bull-trap' &&
        trapCheckBull.probability >= 0.75;

      if (currentCandle.current === 'R' && currentCandle.strength >= 2 && !hasBullTrapConflict) {
        finalSignal = 'sell'; 
        signalClass = 'signal-extreme'; 
        signalText = '🔻 VENDER EXTREMO';
        logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA.toFixed(0)}%) + reversión bajista confirmada (fuerza ${currentCandle.strength}).`;
      } else if (hasBullTrapConflict) {
        finalSignal = 'wait';
        signalClass = 'signal-conflict';
        signalText = '⚠️ ESPERAR';
        const trapPct = Math.round(trapCheckBull.probability * 100);
        logicText = `⚠️ Conflicto: Agotamiento alcista (posible corrección) vs Bull Trap ${trapPct}% (roja débil sospechosa). Esperar vela roja fuerte para confirmar.`;
      } else {
        // Incluso si es verde, es trampa - NO comprar
        finalSignal = 'wait'; 
        signalClass = 'signal-extreme'; 
        signalText = '🚫 NO COMPRAR - EXTREMO';
        logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA.toFixed(0)}%). Cualquier compra es TRAMPA. Esperar caída.`;
      }
    } else if (extremeCondition.type === 'extreme_bearish') {
      // SOBREVENTA EXTREMA: NUNCA vender, solo comprar o esperar
      
      // Fix 2: Si hay Bear Trap ≥ 75%, el rebote es sospechoso — es un conflicto real.
      // El agotamiento dice "rebote probable", el Bear Trap dice "no confíes en la verde".
      // Ambos tienen razón → señal = ESPERAR, no NO VENDER.
      const trapCheckBear = detectCandleTrap();
      const hasBearTrapConflict = trapCheckBear &&
        trapCheckBear.type === 'bear-trap' &&
        trapCheckBear.probability >= 0.75;

      if (currentCandle.current === 'G' && currentCandle.strength >= 2 && !hasBearTrapConflict) {
        if (currentCandle.strength >= 2.5) {
          finalSignal = 'buy';
          signalClass = 'signal-extreme';
          signalText  = '🔥 COMPRAR EXTREMO';
          logicText   = `🚨 SOBREVENTA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) + reversión alcista confirmada (fuerza ${currentCandle.strength}). Alta confianza.`;
        } else {
          // Fuerza 2 en extremo = señal pero débil, pedir segunda vela
          finalSignal = 'buy';
          signalClass = 'signal-buy-weak';
          signalText  = '⬆️ POSIBLE REBOTE';
          logicText   = `⚠️ Sobreventa (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) + verde fuerza ${currentCandle.strength}. Señal débil — esperar segunda vela verde para confirmar.`;
        }
      } else if (hasBearTrapConflict) {
        // Bear Trap contradice el extremo: rebote posible pero no confirmado
        finalSignal = 'wait';
        signalClass = 'signal-conflict';
        signalText = '⚠️ ESPERAR';
        const trapPct = Math.round(trapCheckBear.probability * 100);
        logicText = `⚠️ Conflicto: Agotamiento bajista (posible rebote) vs Bear Trap ${trapPct}% (verde débil sospechosa). Esperar vela verde fuerte para confirmar.`;
      } else {
        // Incluso si es rojo, es trampa - NO vender
        finalSignal = 'wait'; 
        signalClass = 'signal-extreme'; 
        signalText = '🚫 NO VENDER - EXTREMO';
        logicText = `🚨 SOBREVENTA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : '?'}%). Cualquier venta es TRAMPA. Esperar rebote.`;
      }
    }
  }
  // ========== PRIORIDAD 1: VOLUME PROFILE ==========
  else if (vp.poc !== null && history.length >= VP_CONFIG.minHistory) {
    const priceVsPOC = vp.currentPriceLevel - vp.poc;
    const nearPOC = Math.abs(priceVsPOC) < 5;
    
    if (nearPOC && currentCandle.strength >= 3) {
      showVP = true;
      if (currentCandle.current === 'G') {
        // 2ª confirmación: MA10 no debe estar bajista fuerte
        const ma10OkBuy = trendMA === null || trendMA >= 40;
        if (ma10OkBuy) {
          finalSignal = 'buy'; signalClass = 'signal-strong-reversal'; signalText = '🎯 COMPRAR';
          logicText = `🎯 REVERSIÓN EN POC (${vp.poc.toFixed(1)}%): Vela verde fuerza ${currentCandle.strength} + MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Soporte fuerte.`;
        } else {
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ REBOTE EN POC';
          logicText = `⚠️ Verde fuerza ${currentCandle.strength} en POC (${vp.poc.toFixed(1)}%) pero MA10 bajista ${trendMA.toFixed(0)}%. Rebote técnico posible — confianza media.`;
        }
      } else {
        // 2ª confirmación: MA10 no debe estar alcista fuerte
        const ma10OkSell = trendMA === null || trendMA <= 60;
        if (ma10OkSell) {
          finalSignal = 'sell'; signalClass = 'signal-strong-reversal'; signalText = '🎯 VENDER';
          logicText = `🎯 REVERSIÓN EN POC (${vp.poc.toFixed(1)}%): Vela roja fuerza ${currentCandle.strength} + MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Resistencia fuerte.`;
        } else {
          finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ PAUSA EN POC';
          logicText = `⚠️ Roja fuerza ${currentCandle.strength} en POC (${vp.poc.toFixed(1)}%) pero MA10 alcista ${trendMA.toFixed(0)}%. Pausa técnica posible — confianza media.`;
        }
      }
    } else if (nearPOC && currentCandle.strength < 3) {
      showVP = true;
      finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
      logicText = `⚠️ Precio EN POC (${vp.poc.toFixed(1)}%) con vela débil (fuerza ${currentCandle.strength}). Esperar confirmación (fuerza ≥ 3) para operar.`;

    } else if (vp.currentPosition === 'above' && currentCandle.current === 'G') {
      // ═══ CASO FALTANTE: precio SOBRE VAH + vela VERDE ═══
      // Esta es la zona más peligrosa para comprar — el precio ya está en sobrecompra VP.
      // Una vela verde aquí puede ser el último empuje antes de la reversión.
      // NUNCA dar COMPRAR en esta situación. Solo ESPERAR o PRECAUCIÓN.
      showVP = true;
      if (!extremeCondition || extremeCondition.type !== 'extreme_bullish') {
        finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ NO COMPRAR — SOBRE VAH';
        logicText = `🚫 Precio SOBRE VAH (${vp.vah.toFixed(1)}%) + vela verde. Zona de sobrecompra VP — comprar aquí es entrar en el techo. Esperar retorno al VA o señal de ruptura confirmada.`;
      }

    } else if (vp.currentPosition === 'above' && currentCandle.current === 'R' && currentCandle.strength >= 2) {
      // No vender en VP si hay extremo bajista activo
      if (!extremeCondition || extremeCondition.type !== 'extreme_bearish') {

        // ===== PUENTE PREDICCIÓN → SEÑAL =====
        // Si el panel de predicción dice ALCISTA con confianza >= 50%,
        // la vela roja sobre VAH es probablemente una pausa, no una reversión.
        // Bloquear la venta y avisar al usuario del conflicto.
        const predConflict = predictionState.ready &&
                             predictionState.direction === 'bullish' &&
                             predictionState.confidence >= 0.50;

        // Adicionalmente: no vender si MA10 es alcista fuerte (>= 60%)
        // porque significa que la tendencia domina sobre la posición VP
        const ma10Conflict = trendMA !== null && trendMA >= 60;

        // Adicionalmente: requerir 2ª vela roja como confirmación mínima
        const prevCandle = history.length >= 2 ? history[history.length - 2] : null;
        const noConfirmation = prevCandle !== 'R';

        if (predConflict) {
          showVP = true;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE ALZA — ESPERAR';
          const confPct = Math.round(predictionState.confidence * 100);
          logicText = `⚠️ Conflicto VP vs Predicción: precio sobre VAH (${vp.vah.toFixed(1)}%) pero predicción ALCISTA ${confPct}% (objetivo ${predictionState.targetPosition || 'VP'}). Esperar vela roja fuerte (≥2.5) para confirmar venta.`;
        } else if (ma10Conflict && noConfirmation) {
          showVP = true;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR CONFIRMACIÓN';
          logicText = `⚠️ Sobre VAH (${vp.vah.toFixed(1)}%) pero MA10 alcista ${trendMA.toFixed(0)}% — esperar 2ª vela roja para confirmar regreso al POC (${vp.poc.toFixed(1)}%).`;
        } else if (noConfirmation && currentCandle.strength < 2.5) {
          showVP = true;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR CONFIRMACIÓN';
          logicText = `⚠️ Sobre VAH con 1 sola vela roja (fuerza ${currentCandle.strength}). Esperar 2ª roja o fuerza ≥2.5 para confirmar venta hacia POC (${vp.poc.toFixed(1)}%).`;
        } else {
          showVP = true;
          finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '⬇️ VENDER';
          logicText = `📊 SOBRE VAH (${vp.vah.toFixed(1)}%) + reversión confirmada. Regreso al POC (${vp.poc.toFixed(1)}%) probable.`;
        }
      }
    } else if (vp.currentPosition === 'below' && currentCandle.current === 'G' && currentCandle.strength >= 2) {

      // ===== PUENTE PREDICCIÓN → SEÑAL (simétrico) =====
      const predConflictBuy = predictionState.ready &&
                              predictionState.direction === 'bearish' &&
                              predictionState.confidence >= 0.50;
      const ma10ConflictBuy = trendMA !== null && trendMA <= 40;
      const prevCandleBuy   = history.length >= 2 ? history[history.length - 2] : null;
      const noConfirmBuy    = prevCandleBuy !== 'G';

      if (predConflictBuy) {
        showVP = true;
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE BAJA — ESPERAR';
        const confPct = Math.round(predictionState.confidence * 100);
        logicText = `⚠️ Conflicto VP vs Predicción: precio bajo VAL (${vp.val.toFixed(1)}%) pero predicción BAJISTA ${confPct}%. Esperar vela verde fuerte (≥2.5) para confirmar rebote.`;
      } else if (ma10ConflictBuy && noConfirmBuy) {
        showVP = true;
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR CONFIRMACIÓN';
        logicText = `⚠️ Bajo VAL (${vp.val.toFixed(1)}%) pero MA10 bajista ${trendMA.toFixed(0)}% — esperar 2ª vela verde para confirmar rebote al POC (${vp.poc.toFixed(1)}%).`;
      } else {
        // 2ª confirmación: fuerza ≥ 2.5 O vela anterior también verde
        const hasSecondConf = currentCandle.strength >= 2.5 || !noConfirmBuy;
        if (hasSecondConf) {
          showVP = true;
          finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '⬆️ COMPRAR';
          logicText = `📊 BAJO VAL (${vp.val.toFixed(1)}%) + ${currentCandle.strength >= 2.5 ? 'fuerza '+currentCandle.strength : '2ª vela verde confirmada'}. Rebote al POC (${vp.poc.toFixed(1)}%) probable.`;
        } else {
          showVP = true;
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ POSIBLE REBOTE';
          logicText = `⚠️ Bajo VAL (${vp.val.toFixed(1)}%) + verde fuerza ${currentCandle.strength}. Solo 1 confirmación — esperar 2ª vela verde o fuerza ≥2.5 para mayor seguridad.`;
        }
      }
    } else if (vp.currentPosition === 'below' && currentCandle.current === 'R') {
      // ═══ CASO FALTANTE: precio BAJO VAL + vela ROJA ═══
      // Zona de sobreventa VP — vender aquí es entrar en el suelo.
      showVP = true;
      finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ NO VENDER — BAJO VAL';
      logicText = `🚫 Precio BAJO VAL (${vp.val.toFixed(1)}%) + vela roja. Zona de sobreventa VP — vender aquí es entrar en el suelo. Esperar rebote al VA.`;

    } else if (vp.currentPosition === 'inside' && currentCandle.strength >= 2.5) {
      showVP = true;
      if (currentCandle.current === 'G') {
        // ===== DENTRO VA + VERDE: diferenciar por posición =====
        // Si el precio está en la mitad superior del VA (más cerca de VAH),
        // una vela verde puede estar tocando techo — PRECAUCIÓN, no compra ciega.
        // Si está en la mitad inferior (más cerca de VAL/POC), tiene recorrido — COMPRAR.
        const vaRange   = vp.vah - vp.val;
        const midPoint  = vp.val + vaRange * 0.50; // punto medio del VA
        const highZone  = vp.val + vaRange * 0.70; // zona alta: 70-100% del VA
        const price     = vp.currentPriceLevel;

        if (price >= highZone) {
          // Precio en zona alta del VA + verde → puede estar cerca del techo
          finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ PRECAUCIÓN TECHO';
          logicText = `⚠️ DENTRO VA zona alta (${price.toFixed(1)}% → VAH ${vp.vah.toFixed(1)}%) + verde. Poco recorrido alcista. Esperar ruptura del VAH o retroceso al POC (${vp.poc.toFixed(1)}%).`;
        } else if (price >= midPoint) {
          // Zona media-alta: compra con confianza media
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
          logicText = `📊 DENTRO VA zona media (${price.toFixed(1)}%) + verde fuerza ${currentCandle.strength}. Objetivo VAH (${vp.vah.toFixed(1)}%) — confianza media, vigilar rechazo.`;
        } else {
          // Zona baja del VA: tiene recorrido hasta POC y VAH
          // 2ª confirmación: MA10 alcista O fuerza ≥ 3
          const hasSecondConfInside = (trendMA !== null && trendMA >= 50) || currentCandle.strength >= 3;
          if (hasSecondConfInside) {
            finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '⬆️ COMPRAR';
            logicText = `📊 DENTRO VA zona baja (${price.toFixed(1)}%) + verde fuerza ${currentCandle.strength} + MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Recorrido hacia POC (${vp.poc.toFixed(1)}%) y VAH (${vp.vah.toFixed(1)}%).`;
          } else {
            finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
            logicText = `⚠️ DENTRO VA zona baja + verde fuerza ${currentCandle.strength} pero MA10 bajista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Confianza media — vigilar.`;
          }
        }
      } else {
        // Verde simétrico para venta dentro VA
        const vaRange  = vp.vah - vp.val;
        const lowZone  = vp.val + vaRange * 0.30;
        const price    = vp.currentPriceLevel;

        if (price <= lowZone) {
          finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ PRECAUCIÓN SUELO';
          logicText = `⚠️ DENTRO VA zona baja (${price.toFixed(1)}% → VAL ${vp.val.toFixed(1)}%) + roja. Poco recorrido bajista. Esperar ruptura del VAL o rebote al POC (${vp.poc.toFixed(1)}%).`;
        } else {
          // 2ª confirmación: MA10 bajista O fuerza ≥ 3
          const hasSecondConfSell = (trendMA !== null && trendMA <= 50) || currentCandle.strength >= 3;
          if (hasSecondConfSell) {
            finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '⬇️ VENDER';
            logicText = `📊 DENTRO VA momentum bajista (${price.toFixed(1)}%) + roja fuerza ${currentCandle.strength} + MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Hacia VAL (${vp.val.toFixed(1)}%).`;
          } else {
            finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ VENDER DÉBIL';
            logicText = `⚠️ DENTRO VA roja fuerza ${currentCandle.strength} pero MA10 alcista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Confianza media — vigilar rebote.`;
          }
        }
      }
    }
  }
  
  // ========== PRIORIDADES 2-6: solo si NO hay extremo activo ==========
  // Bug corregido: antes, el bloque if(finalSignal==='wait') se ejecutaba
  // incluso cuando Prioridad 0 ya había puesto finalSignal='wait' por extremo,
  // lo que permitía que Prioridad 6 sobreescribiera la señal 'NO VENDER'.
  if (finalSignal === 'wait' && !showExtreme) {
    if (cmdState.phase === 'distribution' && cmdState.probability > 0.6) {
      // ===== PUENTE: CMD DISTRIBUCIÓN vs PREDICCIÓN =====
      // Si predicción dice ALCISTA con confianza >= 55%, el CMD podría estar
      // detectando una pausa institucional, no una distribución real todavía.
      const predBlocksDist = predictionState.ready &&
                             predictionState.direction === 'bullish' &&
                             predictionState.confidence >= 0.55;
      if (predBlocksDist) {
        showCMD = true;
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ CONFLICTO CMD';
        logicText = `⚠️ CMD detecta Distribución (${Math.round(cmdState.probability*100)}%) pero Predicción dice ALCISTA ${Math.round(predictionState.confidence*100)}%. Señales opuestas — esperar claridad.`;
      } else {
        // 2ª confirmación: vela actual roja O MA10 no alcista extremo
        const candleSupportsSell = currentCandle.current === 'R' && currentCandle.strength >= 2;
        const ma10SupportsSell   = trendMA === null || trendMA <= 65;
        if (candleSupportsSell && ma10SupportsSell) {
          showCMD = true;
          finalSignal = 'sell'; signalClass = 'signal-distribution'; signalText = '🏦 VENDER';
          logicText = `🏦 DISTRIBUCIÓN (${Math.round(cmdState.probability*100)}%) + vela roja fuerza ${currentCandle.strength}. Smart money vendiendo — alta confianza.`;
        } else if (ma10SupportsSell) {
          showCMD = true;
          finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '🏦 POSIBLE VENTA';
          logicText = `🏦 DISTRIBUCIÓN (${Math.round(cmdState.probability*100)}%) detectada pero vela actual verde. Esperar vela roja para confirmar salida.`;
        } else {
          showCMD = true;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Distribución (${Math.round(cmdState.probability*100)}%) pero MA10 alcista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Esperar confirmación bajista.`;
        }
      }
    }
    else if (cmdState.phase === 'accumulation' && cmdState.probability > 0.6) {
      // ===== PUENTE: CMD ACUMULACIÓN vs PREDICCIÓN =====
      const predBlocksAccum = predictionState.ready &&
                              predictionState.direction === 'bearish' &&
                              predictionState.confidence >= 0.55;
      if (predBlocksAccum) {
        showCMD = true;
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ CONFLICTO CMD';
        logicText = `⚠️ CMD detecta Acumulación (${Math.round(cmdState.probability*100)}%) pero Predicción dice BAJISTA ${Math.round(predictionState.confidence*100)}%. Señales opuestas — esperar claridad.`;
      } else {
        // 2ª confirmación: vela actual verde O MA10 no bajista extremo
        const candleSupports = currentCandle.current === 'G' && currentCandle.strength >= 2;
        const ma10Supports   = trendMA === null || trendMA >= 35;
        if (candleSupports && ma10Supports) {
          showCMD = true;
          finalSignal = 'buy'; signalClass = 'signal-accumulation'; signalText = '📥 COMPRAR';
          logicText = `📥 ACUMULACIÓN (${Math.round(cmdState.probability*100)}%) + vela verde fuerza ${currentCandle.strength}. Smart money comprando — alta confianza.`;
        } else if (ma10Supports) {
          showCMD = true;
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '📥 POSIBLE COMPRA';
          logicText = `📥 ACUMULACIÓN (${Math.round(cmdState.probability*100)}%) detectada pero vela actual roja. Esperar vela verde para confirmar entrada.`;
        } else {
          showCMD = true;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Acumulación (${Math.round(cmdState.probability*100)}%) pero MA10 bajista ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'N/A'}. Esperar confirmación alcista.`;
        }
      }
    }
    else if (cmdState.phase === 'manipulation' && cmdState.probability > 0.7) {
      showCMD = true;
      finalSignal = 'wait'; signalClass = 'signal-manipulation'; signalText = '🎭 ESPERAR';
      logicText = `🎭 MANIPULACIÓN detectada (${Math.round(cmdState.probability * 100)}%). Falso quiebre posible. NO operar.`;
    }
    // ========== PRIORIDAD 3: REVERSIÓN FUERTE ==========
    else if (currentCandle.isReversal && currentCandle.strength >= 3) {
      showReversal = true;
      if (currentCandle.current === 'G') {
        // Verificar contexto: ¿es reversión real o continuación disfrazada?
        // Si MA10 ya es alcista fuerte (>65%) y hay pocas rojas previas, es continuación
        const prevReds = (() => {
          let c = 0;
          for (let i = history.length - 2; i >= 0 && history[i] === 'R'; i--) c++;
          return c;
        })();
        const isGenuineReversal = prevReds >= 2 || (trendMA !== null && trendMA <= 50);

        if (isGenuineReversal) {
          finalSignal = 'buy'; signalClass = 'signal-strong-reversal'; signalText = '🔄 COMPRAR FUERTE';
          logicText = `🔄 Reversión alcista CONFIRMADA — ${prevReds} velas rojas previas + fuerza ${currentCandle.strength}. Alta confianza.`;
        } else {
          // Verde fuerte pero sin rojas previas suficientes = continuación, no reversión
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ CONTINÚA ALZA';
          logicText = `📈 Verde fuerza ${currentCandle.strength} en tendencia alcista (MA10 ${trendMA !== null ? trendMA.toFixed(0) : '?'}%). Continuación — no es reversión nueva.`;
        }
      } else {
        const prevGreens = (() => {
          let c = 0;
          for (let i = history.length - 2; i >= 0 && history[i] === 'G'; i--) c++;
          return c;
        })();
        const isGenuineReversalSell = prevGreens >= 2 || (trendMA !== null && trendMA >= 50);

        if (isGenuineReversalSell) {
          finalSignal = 'sell'; signalClass = 'signal-strong-reversal'; signalText = '🔄 VENDER FUERTE';
          logicText = `🔄 Reversión bajista CONFIRMADA — ${prevGreens} velas verdes previas + fuerza ${currentCandle.strength}. Alta confianza.`;
        } else {
          finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ CONTINÚA BAJA';
          logicText = `📉 Roja fuerza ${currentCandle.strength} en tendencia bajista (MA10 ${trendMA !== null ? trendMA.toFixed(0) : '?'}%). Continuación — no es reversión nueva.`;
        }
      }
    }
    // ========== PRIORIDAD 4: CONFLICTO MOMENTUM ==========
    else if (recentTrend.warning === 'momentum_change') {
      finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
      logicText = `⚠️ Conflicto momentum: ${recentTrend.reason}. Esperar confirmación.`;
    }
    // ========== PRIORIDAD 5: CRUCE VÁLIDO ==========
    else if (activeCross && !activeCross.trap) {
      // VERIFICAR: No operar en contra del extremo aunque haya cruce
      if (trendMA >= 85 && activeCross.crossType === 'golden') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Golden Cross ignorado: MA10 al ${trendMA.toFixed(0)}% (cerca de extremo).`;
      } else if (trendMA <= 15 && activeCross.crossType === 'death') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Death Cross ignorado: MA10 al ${trendMA.toFixed(0)}% (cerca de extremo).`;

      // FIX CASO 1: Golden Cross SOBRE VAH → precio en zona de sobrecompra VP
      // La resistencia del VAH invalida la señal alcista sin confirmación de ruptura
      } else if (activeCross.crossType === 'golden' && vp.poc !== null && vp.currentPosition === 'above') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Golden Cross ignorado: precio SOBRE VAH (${vp.vah.toFixed(1)}%) — zona de sobrecompra VP. Esperar pullback al VA o vela fuerte de ruptura.`;

      // FIX CASO 1 simétrico: Death Cross BAJO VAL → precio en zona de sobreventa VP
      } else if (activeCross.crossType === 'death' && vp.poc !== null && vp.currentPosition === 'below') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Death Cross ignorado: precio BAJO VAL (${vp.val.toFixed(1)}%) — zona de sobreventa VP. Esperar rebote al VA o vela fuerte de ruptura.`;

      // FIX existente: Death/Golden Cross en POC
      // del VP invalida la señal de venta sin confirmación adicional.
      } else if (activeCross.crossType === 'death' && vp.poc !== null && vp.currentPosition === 'poc') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Death Cross ignorado: precio EN POC (${vp.poc.toFixed(1)}%) — soporte máximo del VP. Esperar ruptura confirmada.`;

      // FIX 1b: Golden Cross en POC también → resistencia máxima, no comprar directamente
      } else if (activeCross.crossType === 'golden' && vp.poc !== null && vp.currentPosition === 'poc') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Golden Cross ignorado: precio EN POC (${vp.poc.toFixed(1)}%) — resistencia máxima del VP. Esperar ruptura confirmada.`;

      // FIX 2: Bear Trap con confianza >= 55% contradice un Death Cross
      // (el mercado parece querer subir aunque el cruce diga vender)
      } else if (activeCross.crossType === 'death') {
        const candleTrapCheck = detectCandleTrap();
        if (candleTrapCheck && candleTrapCheck.type === 'bear-trap' && candleTrapCheck.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Death Cross vs Bear Trap (${Math.round(candleTrapCheck.probability*100)}%) — señales contradictorias. ${candleTrapCheck.action}`;
        // ===== PUENTE: Death Cross vs Predicción ALCISTA =====
        } else if (predictionState.ready && predictionState.direction === 'bullish' && predictionState.confidence >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE ALZA — ESPERAR';
          logicText = `⚠️ Death Cross en ${activeCross.pair} pero Predicción dice ALCISTA ${Math.round(predictionState.confidence*100)}%. Señales contradictorias — esperar confirmación bajista.`;
        } else {
          // Death Cross limpio
          if (trendMA !== null && trendMA <= 30) {
            finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ VENDER DÉBIL';
            logicText = `⚠️ Death Cross en ${activeCross.pair} pero MA10 al ${trendMA.toFixed(0)}% — cerca de sobreventa. Confianza reducida.`;
          } else {
            finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '✅ VENDER';
            logicText = `✅ Death Cross válido en ${activeCross.pair}. Tendencia bajista. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%.`;
          }
        }

      // FIX 2b: Bull Trap contradice Golden Cross
      } else if (activeCross.crossType === 'golden') {
        const candleTrapCheck = detectCandleTrap();
        if (candleTrapCheck && candleTrapCheck.type === 'bull-trap' && candleTrapCheck.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Golden Cross vs Bull Trap (${Math.round(candleTrapCheck.probability*100)}%) — señales contradictorias. ${candleTrapCheck.action}`;
        // ===== PUENTE: Golden Cross vs Predicción BAJISTA =====
        } else if (predictionState.ready && predictionState.direction === 'bearish' && predictionState.confidence >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Golden Cross en ${activeCross.pair} pero Predicción dice BAJISTA ${Math.round(predictionState.confidence*100)}%. Señales contradictorias — esperar confirmación alcista.`;
        } else {
          // Golden Cross limpio
          if (trendMA !== null && trendMA >= 70) {
            // MA10 alta + Golden Cross = compra pero cerca de sobrecompra
            finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
            logicText = `⚠️ Golden Cross en ${activeCross.pair} pero MA10 al ${trendMA.toFixed(0)}% — cerca de sobrecompra. Confianza reducida.`;
          } else {
            finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '✅ COMPRAR';
            logicText = `✅ Golden Cross válido en ${activeCross.pair}. Tendencia alcista. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%.`;
          }
        }
      }
    }
    // ========== PRIORIDAD 6: PATRÓN + CONTEXTO ==========
    else if (proj && recentTrend.trend !== 'neutral') {
      const momentumConsistent = (recentTrend.trend === 'bullish' && trendMA > prevTrendMA) || 
                                 (recentTrend.trend === 'bearish' && trendMA < prevTrendMA) ||
                                 Math.abs(trendMA - prevTrendMA) < 5;

      // ── BLOQUEO CRÍTICO: racha extrema sin MA10 disponible ──────────────
      // Con < 10 velas no hay MA10. Si hay 3+ velas fuertes seguidas
      // el sistema llega aquí y daría COMPRAR — exactamente el caso del error.
      // Detectar el extremo por fuerza bruta aunque no haya MA10.
      const isExtremeRunWithoutMA = recentTrend.isExtreme && trendMA === null;
      if (isExtremeRunWithoutMA) {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBREEXTENSIÓN';
        logicText = `⚠️ ${recentTrend.strength} velas ${recentTrend.trend === 'bullish' ? 'verdes' : 'rojas'} seguidas (fuerza ${recentTrend.weightedScore.toFixed(1)}). Mercado sobreextendido sin historial suficiente. No entrar en la dirección de la racha.`;
      }
      // ── BLOQUEO: racha extrema alcista — no comprar en la cima ──────────
      else if (recentTrend.isExtreme && recentTrend.trend === 'bullish') {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBRECOMPRA';
        logicText = `⚠️ ${recentTrend.strength} verdes seguidas con MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'sin datos'}. Comprar aquí es entrar en el techo. Esperar corrección.`;
      }
      else if (recentTrend.isExtreme && recentTrend.trend === 'bearish') {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 ESPERAR — SOBREVENTA';
        logicText = `⚠️ ${recentTrend.strength} rojas seguidas con MA10 ${trendMA !== null ? trendMA.toFixed(0)+'%' : 'sin datos'}. Vender aquí es entrar en el suelo. Esperar rebote.`;
      }
      else if (!momentumConsistent && Math.abs(trendMA - prevTrendMA) > 10) {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Patrón detectado pero momentum en contra (${(trendMA - prevTrendMA).toFixed(1)}%).`;
      } else if (recentTrend.trend === 'bullish' && proj.ifG.sig === 'COMPRA') {
        // ===== PUENTE: patrón COMPRA vs predicción BAJISTA =====
        const predBlocksBuy = predictionState.ready &&
                              predictionState.direction === 'bearish' &&
                              predictionState.confidence >= 0.60;
        if (predBlocksBuy) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Patrón ${proj.ifG.pat} alcista pero Predicción dice BAJISTA ${Math.round(predictionState.confidence*100)}%. Señales opuestas — no entrar.`;
        } else {
          const confPct = Math.round(proj.ifG.conf * 100);
          if (confPct >= 70) {
            finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '⬆️ COMPRAR';
            logicText = `⬆️ Patrón ${proj.ifG.pat} en contexto alcista. Confianza alta: ${confPct}%`;
          } else {
            finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
            logicText = `⬆️ Patrón ${proj.ifG.pat} alcista. Confianza media: ${confPct}% — esperar confirmación.`;
          }
        }
      } else if (recentTrend.trend === 'bearish' && proj.ifR.sig === 'VENTA') {
        // ===== PUENTE: patrón VENTA vs predicción ALCISTA =====
        const predBlocksSell = predictionState.ready &&
                               predictionState.direction === 'bullish' &&
                               predictionState.confidence >= 0.60;
        if (predBlocksSell) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE ALZA — ESPERAR';
          logicText = `⚠️ Patrón ${proj.ifR.pat} bajista pero Predicción dice ALCISTA ${Math.round(predictionState.confidence*100)}%. Señales opuestas — esperar confirmación.`;
        } else {
          const confPct = Math.round(proj.ifR.conf * 100);
          if (confPct >= 70) {
            finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '⬇️ VENDER';
            logicText = `⬇️ Patrón ${proj.ifR.pat} en contexto bajista. Confianza alta: ${confPct}%`;
          } else {
            finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ VENDER DÉBIL';
            logicText = `⬇️ Patrón ${proj.ifR.pat} bajista. Confianza media: ${confPct}% — esperar confirmación.`;
          }
        }
      } else {
        logicText = `🤔 Patrón en conflicto con tendencia. Esperando.`;
      }
    } else {
      logicText = `⏸️ Sin señales claras. MA10: ${trendMA ? trendMA.toFixed(0) + '%' : 'N/A'}`;
    }
  }
  
  // ========== SAFETY NET FINAL: bloqueo de último recurso ==========
  // Cubre casos donde el extremo llegó por paths no previstos.
  // También cubre rachas extremas sin MA10 (historial corto).
  if (extremeCondition) {
    if (extremeCondition.type === 'extreme_bearish' && finalSignal === 'sell') {
      finalSignal = 'wait';
      signalClass = 'signal-extreme';
      signalText  = '🚫 NO VENDER - EXTREMO';
      logicText   = `🚨 SOBREVENTA EXTREMA (${trendMA ? trendMA.toFixed(0) : '?'}%). ${extremeCondition.message}`;
    }
    if (extremeCondition.type === 'extreme_bullish' && finalSignal === 'buy') {
      finalSignal = 'wait';
      signalClass = 'signal-extreme';
      signalText  = '🚫 NO COMPRAR - EXTREMO';
      logicText   = `🚨 SOBRECOMPRA EXTREMA (${trendMA ? trendMA.toFixed(0) : '?'}%). ${extremeCondition.message}`;
    }
  }
  // Safety net VP: precio sobre VAH nunca comprar, bajo VAL nunca vender
  // Este es el caso exacto del error — GGG disparó COMPRAR ignorando que estaba sobre VAH
  if (vp.poc !== null) {
    if (vp.currentPosition === 'above' && finalSignal === 'buy') {
      finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ NO COMPRAR — SOBRE VAH';
      logicText = `🚫 Compra bloqueada: precio SOBRE VAH (${vp.vah.toFixed(1)}%) — zona de sobrecompra VP. Esperar retorno al VA antes de comprar.`;
    }
    if (vp.currentPosition === 'below' && finalSignal === 'sell') {
      finalSignal = 'wait'; signalClass = 'signal-caution'; signalText = '⚠️ NO VENDER — BAJO VAL';
      logicText = `🚫 Venta bloqueada: precio BAJO VAL (${vp.val.toFixed(1)}%) — zona de sobreventa VP. Esperar rebote al VA antes de vender.`;
    }
  }
  // Safety net adicional: racha extrema sin MA10 que escapó todos los filtros
  if (recentTrend.isExtreme && (finalSignal === 'buy' || finalSignal === 'sell')) {
    const rachaDir = recentTrend.trend === 'bullish' ? 'verdes' : 'rojas';
    if ((recentTrend.trend === 'bullish' && finalSignal === 'buy') ||
        (recentTrend.trend === 'bearish' && finalSignal === 'sell')) {
      finalSignal = 'wait';
      signalClass = 'signal-extreme';
      signalText  = '🚫 ESPERAR — RACHA EXTREMA';
      logicText   = `🚨 ${recentTrend.strength} ${rachaDir} seguidas. Entrar en la dirección de una racha extrema tiene alta probabilidad de fallo. Esperar corrección.`;
    }
  }

  // ========== DETECCIÓN DE TRAMPA DE CRUCE (MA) ==========
  if (activeCross && activeCross.trap && !showExtreme && recentTrend.warning !== 'momentum_change' && !showCMD && !showVP && finalSignal !== 'wait') {
    signalClass = 'signal-trap';
    signalText = activeCross.crossType === 'golden' ? '❓ ¿COMPRA?' : '❓ ¿VENTA?';
    const reason = activeCross.trapReason ? ` — ${activeCross.trapReason}` : '';
    logicText = `⚠️ ${activeCross.pair}: Cruce ${activeCross.crossType} es TRAMPA${reason}.`;
    finalSignal = 'wait';
  }

  // ========== DETECCIÓN DE TRAMPA DE VELA (Bear/Bull Trap) ==========
  // Si hay una trampa de vela con probabilidad ALTA (≥60%) y el sistema
  // iba a dar una señal en esa misma dirección, la bloquea o la degrada.
  const candleTrap = detectCandleTrap();
  if (candleTrap && candleTrap.probability >= 0.60 && !showExtreme) {
    const trapDirectionBuy  = candleTrap.type === 'bear-trap'; // trampa alcista
    const trapDirectionSell = candleTrap.type === 'bull-trap'; // trampa bajista

    if ((finalSignal === 'buy'  && trapDirectionBuy) ||
        (finalSignal === 'sell' && trapDirectionSell)) {
      // Señal comprometida: convertir en advertencia de trampa
      signalClass  = 'signal-trap';
      const trapPct = Math.round(candleTrap.probability * 100);
      signalText   = trapDirectionBuy
        ? `🪤 ¿COMPRA? (${trapPct}% TRAMPA)`
        : `🪤 ¿VENTA? (${trapPct}% TRAMPA)`;
      logicText    = `🪤 ${candleTrap.typeLabel} detectada (${trapPct}%). `
                   + `${candleTrap.consecOpposite} velas previas fuerza máx ${candleTrap.maxOppStr}. `
                   + `${candleTrap.action}`;
      finalSignal  = 'wait';
    } else if (finalSignal === 'wait') {
      // Ya estaba en espera: reforzar el mensaje con info de trampa
      logicText += ` | 🪤 ${candleTrap.typeLabel} (${Math.round(candleTrap.probability * 100)}%)`;
    }
  }

  // ========== RENDERIZADO DE SEÑAL PRINCIPAL ==========
  mainSignal.className = 'main-signal ' + signalClass;

  // Badges — solo mostrar el que corresponde a la clase actual
  // Cada badge se muestra/oculta según la clase CSS del contenedor (via style.css)
  // Pero para garantizar que funcione aunque el CSS no los oculte por defecto,
  // controlamos display directamente desde JS
  const badgeMap = {
    'manual-trap-badge':   signalClass === 'signal-trap' && manualTrapIndex !== null,
    'conflict-badge':      signalClass === 'signal-conflict',
    'reversal-badge':      signalClass === 'signal-strong-reversal',
    'extreme-signal-badge':signalClass === 'signal-extreme',
    'cmd-signal-badge':    signalClass === 'signal-accumulation' || signalClass === 'signal-distribution' || signalClass === 'signal-manipulation',
    'candle-trap-badge':   signalClass === 'signal-trap',
    'weak-buy-badge':      signalClass === 'signal-buy-weak' || signalClass === 'signal-sell-weak',
    'caution-badge':       signalClass === 'signal-caution',
  };

  mainSignal.innerHTML = signalText +
    Object.entries(badgeMap).map(([cls, show]) =>
      `<div class="${cls}" style="display:${show ? 'block' : 'none'}">${
        cls === 'manual-trap-badge'    ? 'TRAMPA ACTIVA'      :
        cls === 'conflict-badge'       ? '⚠️ CONFLICTO'       :
        cls === 'reversal-badge'       ? '🔄 REVERSIÓN FUERTE':
        cls === 'extreme-signal-badge' ? '🚨 EXTREMO'         :
        cls === 'cmd-signal-badge'     ? '🎯 FASE CMD'        :
        cls === 'candle-trap-badge'    ? '🪤 POSIBLE TRAMPA'  :
        cls === 'weak-buy-badge'       ? '⚡ CONFIANZA MEDIA' :
        cls === 'caution-badge'        ? '🛑 PRECAUCIÓN'      : ''
      }</div>`
    ).join('');

  // ===== TEXTO DE VOZ: diferente según el tipo real de señal =====
  // Sin emojis — la voz los lee mal o los ignora.
  // Sin símbolos — solo texto natural hablado.
  const voiceTexts = {
    'signal-extreme':         finalSignal === 'buy'
                                ? 'Comprar extremo. Sobreventa confirmada. Alta confianza.'
                                : 'Vender extremo. Sobrecompra confirmada. Alta confianza.',
    'signal-buy':             'Comprar confirmado.',
    'signal-sell':            'Vender confirmado.',
    'signal-buy-weak':        'Posible compra. Confianza media. Verifica antes de entrar.',
    'signal-sell-weak':       'Posible venta. Confianza media. Verifica antes de entrar.',
    'signal-caution':         'Precaución. Zona límite. No operes todavía.',
    'signal-strong-reversal': finalSignal === 'buy'
                                ? 'Comprar. Reversión fuerte confirmada.'
                                : 'Vender. Reversión fuerte confirmada.',
    'signal-accumulation':    'Comprar. Acumulación institucional detectada.',
    'signal-distribution':    'Vender. Distribución institucional detectada.',
    'signal-conflict':        'Esperar. Señales contradictorias.',
    'signal-manipulation':    'Esperar. Manipulación detectada. No operes.',
    'signal-trap':            'Cuidado. Posible trampa.',
    'signal-wait':            'Esperando señal.',
  };
  // Limpiar emojis del fallback por si algún signalClass no está en el mapa
  const cleanFallback = signalText.replace(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[⬆️⬇️⚠️🔄🎯🔥📥🏦✅🚫🪤🎭🔻]/gu, '').trim();
  mainSignal.setAttribute('data-voice', voiceTexts[signalClass] || cleanFallback);
  
  const showCandleTrap = candleTrap && candleTrap.probability >= 0.60;
  priorityExplanation.classList.toggle('active', showReversal || showExtreme || recentTrend.warning === 'momentum_change' || showCMD || showVP || showCandleTrap);
  logicExplanation.classList.toggle('active', true);
  document.getElementById('logic-text').textContent = logicText;
  
  updateProjections(trendMA, prevTrendMA, activeCross, recentTrend, currentCandle, extremeCondition, proj);
  
  // ========== RENDERIZADO DE HISTORIAL CON FUERZAS CORREGIDO ==========
  document.getElementById('history').innerHTML = history.map((h, i) => {
    const isTrap = i === manualTrapIndex;
    const isNew = i === history.length - 1;
    const s = getCandleStrength(i) || 2; // Fallback a 2 si undefined
    const origin = manualStrengths[i]?.origin || 'auto';
    
    let indicator = '';
    let extraClass = '';
    
    // CORRECCIÓN: Mostrar fuerza 4 correctamente
    if (s >= 4) {
      indicator = '<span class="candle-strength strength-4-ind">4🔥</span>';
      extraClass = 'candle-extreme';
    } else if (s >= 3) {
      indicator = '<span class="candle-strength strength-3-ind">3</span>';
    } else if (s >= 2.5) {
      indicator = '<span class="candle-strength strength-2-ind">2+</span>';
      extraClass = 'candle-accelerated';
    } else if (s >= 2) {
      indicator = '<span class="candle-strength strength-2-ind">2</span>';
    } else if (s >= 1.5) {
      indicator = '<span class="candle-strength strength-1-ind">1+</span>';
    } else {
      indicator = '<span class="candle-strength strength-1-ind">1</span>';
    }
    
    const manualMark = origin === 'corrected' ? '<span style="position:absolute;top:-3px;right:-3px;width:6px;height:6px;background:var(--orange);border-radius:50%;"></span>' : 
                      origin === 'confirmed' ? '<span style="position:absolute;top:-3px;right:-3px;width:6px;height:6px;background:var(--green);border-radius:50%;"></span>' : '';
    
    const strengthLabel = STRENGTH_CONFIG.LEVELS[s]?.name || 'MEDIA';
    
    return `<div class="candle candle-${h.toLowerCase()} ${isTrap?'candle-trap':''} ${isNew&&!isTrap?'candle-new':''} ${extraClass}" 
              onclick="openEditPanel(${i})" 
              title="Vela #${i+1}: ${h}, Fuerza: ${s}/4 (${strengthLabel}), Origen: ${origin}">
            ${h}${indicator}${manualMark}
          </div>`;
  }).join('');
}

function updateProjections(trendMA, prevTrendMA, activeCross, recentTrend, currentCandle, extremeCondition, proj) {
  if (!proj) {
    document.getElementById('proj-g-seq').textContent = '--';
    document.getElementById('proj-r-seq').textContent = '--';
    return;
  }
  
  const currentInternalStrength = getCandleStrength(history.length - 1);
  
  if (currentInternalStrength === 4) {
    const capitulationType = history[history.length - 1] === 'G' ? 'bullish' : 'bearish';
    
    if (capitulationType === 'bullish') {
      document.getElementById('proj-g-extreme').textContent = '🔥 CAPITULACIÓN: Reversión alcista inminente';
      document.getElementById('proj-g-extreme').style.display = 'block';
      document.getElementById('proj-r-extreme').style.display = 'none';
    } else {
      document.getElementById('proj-r-extreme').textContent = '🔥 CAPITULACIÓN: Reversión bajista inminente';
      document.getElementById('proj-r-extreme').style.display = 'block';
      document.getElementById('proj-g-extreme').style.display = 'none';
    }
  } else {
    document.getElementById('proj-g-extreme').style.display = 'none';
    document.getElementById('proj-r-extreme').style.display = 'none';
  }
  
  if (currentInternalStrength === 2.5) {
    const trendDirection = history[history.length - 1] === 'G' ? 'bullish' : 'bearish';
    
    if (trendDirection === 'bullish') {
      const baseConf = Math.round(proj.ifG.conf * 100);
      document.getElementById('proj-g-conf').textContent = (baseConf + 15) + '% (Momentum+)';
    } else {
      const baseConf = Math.round(proj.ifR.conf * 100);
      document.getElementById('proj-r-conf').textContent = (baseConf + 15) + '% (Momentum+)';
    }
  }
  
  if (currentInternalStrength === 1.5) {
    document.getElementById('proj-g-conflict').textContent = '⚠️ Doji sesgado: Esperar claridad';
    document.getElementById('proj-r-conflict').textContent = '⚠️ Doji sesgado: Esperar claridad';
  }
  
  const gIsReversal = currentCandle.isReversal && currentCandle.current === 'G' && currentCandle.strength >= 3;
  document.getElementById('proj-g-seq').textContent = proj.ifG.pat;
  
  let gSignal = proj.ifG.sig, gClass = proj.ifG.sig === 'COMPRA' ? 'proj-signal-buy' : 'proj-signal-hold';
  let gBoxClass = 'proj-box proj-green', gConfidence = Math.round(proj.ifG.conf * 100) + '%';
  
  if (extremeCondition && extremeCondition.type === 'extreme_bullish') {
    gSignal = 'ESPERAR'; gClass = 'proj-signal-extreme'; gBoxClass = 'proj-box proj-green proj-extreme'; gConfidence = '0% - EXTREMO';
  } else if (cmdState.phase === 'distribution') {
    gSignal = 'NO COMPRAR'; gClass = 'proj-signal-hold'; gBoxClass = 'proj-box proj-green proj-conflict'; gConfidence = 'Distribución activa';
  } else if (recentTrend.warning === 'momentum_change' && recentTrend.weightedScore < 0) {
    gSignal = 'ESPERAR'; gClass = 'proj-signal-hold'; gBoxClass = 'proj-box proj-green proj-conflict'; gConfidence = 'Conflicto momentum';
  // ===== PUENTE: Predicción bajista bloquea señal de compra en proyecciones =====
  } else if (predictionState.ready && predictionState.direction === 'bearish' && predictionState.confidence >= 0.55) {
    gSignal = 'PRECAUCIÓN'; gClass = 'proj-signal-hold'; gBoxClass = 'proj-box proj-green proj-conflict';
    gConfidence = `Pred. BAJISTA ${Math.round(predictionState.confidence*100)}%`;
  }
  
  document.getElementById('proj-g-sig').textContent = gSignal;
  document.getElementById('proj-g-sig').className = 'proj-signal ' + gClass;
  document.getElementById('proj-g-conf').textContent = gConfidence;
  document.getElementById('proj-g-reason').textContent = gIsReversal ? '🔄 Reversión fuerza 3' : '';
  document.getElementById('proj-g-reversal').textContent = gIsReversal ? 'Prioridad máxima' : '';
  document.getElementById('proj-g-extreme').textContent = (extremeCondition && extremeCondition.type === 'extreme_bullish') ? '⚠️ NO COMPRAR: Sobrecompra extrema' : '';
  document.getElementById('proj-g-conflict').textContent = (recentTrend.warning === 'momentum_change') ? '⚠️ Conflicto: Momentum cambiando' : '';
  document.getElementById('proj-g-cmd').textContent = (cmdState.phase === 'distribution') ? '🏦 DISTRIBUCIÓN: Smart money vendiendo' : (cmdState.phase === 'accumulation') ? '📥 ACUMULACIÓN: Posible entrada' : '';
  document.getElementById('proj-g-box').className = gBoxClass;
  
  const rIsReversal = currentCandle.isReversal && currentCandle.current === 'R' && currentCandle.strength >= 3;
  document.getElementById('proj-r-seq').textContent = proj.ifR.pat;
  
  let rSignal = proj.ifR.sig, rClass = proj.ifR.sig === 'VENTA' ? 'proj-signal-sell' : 'proj-signal-hold';
  let rBoxClass = 'proj-box proj-red', rConfidence = Math.round(proj.ifR.conf * 100) + '%';
  
  if (extremeCondition && extremeCondition.type === 'extreme_bearish') {
    rSignal = 'ESPERAR'; rClass = 'proj-signal-extreme'; rBoxClass = 'proj-box proj-red proj-extreme'; rConfidence = '0% - EXTREMO';
  } else if (cmdState.phase === 'accumulation') {
    rSignal = 'NO VENDER'; rClass = 'proj-signal-hold'; rBoxClass = 'proj-box proj-red proj-conflict'; rConfidence = 'Acumulación activa';
  } else if (recentTrend.warning === 'momentum_change' && recentTrend.weightedScore > 0) {
    rSignal = 'ESPERAR'; rClass = 'proj-signal-hold'; rBoxClass = 'proj-box proj-red proj-conflict'; rConfidence = 'Conflicto momentum';
  // ===== PUENTE: Predicción alcista bloquea señal de venta en proyecciones =====
  } else if (predictionState.ready && predictionState.direction === 'bullish' && predictionState.confidence >= 0.55) {
    rSignal = 'PRECAUCIÓN'; rClass = 'proj-signal-hold'; rBoxClass = 'proj-box proj-red proj-conflict';
    rConfidence = `Pred. ALCISTA ${Math.round(predictionState.confidence*100)}%`;
  }
  
  document.getElementById('proj-r-sig').textContent = rSignal;
  document.getElementById('proj-r-sig').className = 'proj-signal ' + rClass;
  document.getElementById('proj-r-conf').textContent = rConfidence;
  document.getElementById('proj-r-reason').textContent = rIsReversal ? '🔄 Reversión fuerza 3' : '';
  document.getElementById('proj-r-reversal').textContent = rIsReversal ? 'Prioridad máxima' : '';
  document.getElementById('proj-r-extreme').textContent = (extremeCondition && extremeCondition.type === 'extreme_bearish') ? '⚠️ NO VENDER: Sobreventa extrema' : '';
  document.getElementById('proj-r-conflict').textContent = (recentTrend.warning === 'momentum_change') ? '⚠️ Conflicto: Momentum cambiando' : '';
  document.getElementById('proj-r-cmd').textContent = (cmdState.phase === 'accumulation') ? '📥 ACUMULACIÓN: Smart money comprando' : (cmdState.phase === 'distribution') ? '🏦 DISTRIBUCIÓN: Posible salida' : '';
  document.getElementById('proj-r-box').className = rBoxClass;
}

// ===== UTILIDADES =====

function getStrengthLabel(strength) {
  const labels = {
    1: 'DÉBIL',
    1.5: 'DÉBIL+',
    2: 'MEDIA',
    2.5: 'MEDIA+',
    3: 'FUERTE',
    4: 'EXTREMA'
  };
  return labels[strength] || 'MEDIA';
}



function closeModal() {
  document.getElementById('trap-modal').classList.remove('active');
  pendingTrapIndex = null;
}

function confirmTrap() {
  if (pendingTrapIndex !== null) {
    manualTrapIndex = pendingTrapIndex;
    closeModal();
    update();
  }
}

function clearTrap() {
  manualTrapIndex = null;
  originalTrendMA = null;
  update();
}

function reset() {
  history = [];
  manualStrengths = {};
  manualTrapIndex = null;
  pendingTrapIndex = null;
  originalTrendMA = null;
  cmdState = { phase: 'none', probability: 0, details: {} };
  
  volumeProfile = {
    poc: null, vah: null, val: null,
    histogram: [], totalVolume: 0, valueAreaVolume: 0,
    currentPriceLevel: null
  };
  
  autoSuggestedStrength = 2;
  confirmedStrength = null;
  strengthOrigin = 'pending';
  
  resetConfirmationPanel();
  document.getElementById('priority-explanation').classList.remove('active');
  document.getElementById('logic-explanation').classList.remove('active');
  
  document.getElementById('proj-g-extreme').style.display = 'none';
  document.getElementById('proj-r-extreme').style.display = 'none';
  
  closeModal();
  update();
}

// ===== EDICIÓN DE VELAS EXISTENTES =====
// (Funciones definidas arriba, cerca de línea 1758)

// ===== SELECTOR VISUAL DE VELAS JAPONESAS =====
//
// Cada definición describe la forma de una vela japonesa real.
// body: [y_top, height] como fracción del total (0=arriba, 1=abajo en SVG)
// wickTop, wickBottom: longitud de mecha como fracción del alto total (H)
// shape: 'normal' | 'dragonfly' | 'gravestone' | 'longleg'
//   - dragonfly:  cuerpo en la cima, mecha larga sólo abajo (T invertida)
//   - gravestone: cuerpo en la base, mecha larga sólo arriba (T normal)
//   - longleg:    cuerpo finísimo en el centro, mechas largas iguales (cruz)

// Shapes:
//  normal      → body + wickTop + wickBottom (proporciones como fracción de H)
//  longleg     → línea horizontal en centro exacto, mechas simétricas largas
//  dragonfly   → cuerpo pequeño arriba, mecha larga abajo, sin mecha superior
//  gravestone  → cuerpo pequeño abajo, mecha larga arriba, sin mecha inferior
//  hammer      → cuerpo [bodyPos, bodyH], wickBottom largo, wickTop corto/nulo
//  shootstar   → cuerpo [bodyPos, bodyH], wickTop largo, wickBottom corto/nulo
//  asymup      → normal pero wickTop mucho más largo que wickBottom
//  asymdown    → normal pero wickBottom mucho más largo que wickTop
//  spinning    → cuerpo pequeño centrado, mechas medianas iguales

const CANDLE_TYPES = [
  // ── Fila 1: Indecisión total ─────────────────────────────────────────────
  {
    id: 'doji',
    strength: 1,
    shape: 'normal',
    label: 'Doji',
    sublabel: 'Equilibrio puro',
    body:        [0.46, 0.06],
    wickTop:     0.40,
    wickBottom:  0.40,
  },
  {
    id: 'longleg',
    strength: 1,
    shape: 'longleg',
    label: 'Cruz',
    sublabel: 'Máx. indecisión',
  },
  {
    id: 'spinning',
    strength: 1.5,
    shape: 'spinning',
    label: 'Spinning Top',
    sublabel: 'Indec. con cuerpo',
    // cuerpo pequeño centrado, mechas medianas iguales
    bodyFrac:   0.22,   // altura del cuerpo como fracción de H
    wickFrac:   0.28,   // longitud de cada mecha como fracción de H
  },

  // ── Fila 2: Rechazos extremos (velas de pin) ─────────────────────────────
  {
    id: 'hammer',
    strength: 2,
    shape: 'hammer',
    label: 'Martillo',
    sublabel: 'Rebote desde bajo',
    // Verde = alcista (hammer), Rojo = bajista (hombre colgado)
    bodyH:      0.12,   // cuerpo pequeño en la cima
    wickLen:    0.68,   // mecha inferior larga
    topWick:    0.04,   // mecha superior mínima
  },
  {
    id: 'shootstar',
    strength: 2,
    shape: 'shootstar',
    label: 'Estrella Fugaz',
    sublabel: 'Rechazo desde alto',
    // Verde = neutral, Rojo = bajista fuerte (shooting star / hanging man)
    bodyH:      0.12,
    wickLen:    0.68,
    bottomWick: 0.04,
  },
  {
    id: 'dragonfly',
    strength: 1.5,
    shape: 'dragonfly',
    label: 'Libélula',
    sublabel: 'Pin bar alcista',
  },
  {
    id: 'gravestone',
    strength: 1.5,
    shape: 'gravestone',
    label: 'Lápida',
    sublabel: 'Pin bar bajista',
  },

  // ── Fila 3: Cuerpos medianos / asimétricas ────────────────────────────────
  {
    id: 'asymdown',
    strength: 2,
    shape: 'asymdown',
    label: 'Mecha abajo',
    sublabel: 'Cuerpo + cola ↓',
    // Cuerpo mediano arriba, mecha larga abajo, mecha corta arriba
    body:       [0.10, 0.44],
    wickTop:    0.06,
    wickBottom: 0.30,
  },
  {
    id: 'normal',
    strength: 2,
    shape: 'normal',
    label: 'Normal',
    sublabel: 'Tendencia limpia',
    body:        [0.22, 0.52],
    wickTop:     0.13,
    wickBottom:  0.13,
  },
  {
    id: 'asymup',
    strength: 2,
    shape: 'asymup',
    label: 'Mecha arriba',
    sublabel: 'Cuerpo + cola ↑',
    // Cuerpo mediano abajo, mecha larga arriba, mecha corta abajo
    body:       [0.46, 0.44],
    wickTop:    0.30,
    wickBottom: 0.06,
  },

  // ── Fila 4: Momentum / capitulación ──────────────────────────────────────
  {
    id: 'doji-bias',
    strength: 1.5,
    shape: 'normal',
    label: 'Doji Sesgado',
    sublabel: 'Ligera dirección',
    body:        [0.34, 0.20],
    wickTop:     0.28,
    wickBottom:  0.26,
  },
  {
    id: 'momentum',
    strength: 2.5,
    shape: 'normal',
    label: 'Momentum',
    sublabel: 'Presión fuerte',
    body:        [0.14, 0.64],
    wickTop:     0.08,
    wickBottom:  0.08,
  },
  {
    id: 'marubozu',
    strength: 3,
    shape: 'normal',
    label: 'Marubozu',
    sublabel: 'Control total',
    body:        [0.06, 0.82],
    wickTop:     0.03,
    wickBottom:  0.03,
  },
  {
    id: 'engulf',
    strength: 4,
    shape: 'normal',
    label: 'Engulfing',
    sublabel: 'Capitulación',
    body:        [0.02, 0.94],
    wickTop:     0.01,
    wickBottom:  0.01,
  },

  // ── Nuevas velas de alta relevancia ──────────────────────────────────────

  // Inverted Hammer: cuerpo pequeño ABAJO, mecha larga ARRIBA
  // Verde = alcista en fondos (rechazo de precios bajos)
  // Rojo  = bajista en techos (igual que Shooting Star pero se distingue visualmente)
  {
    id: 'inv-hammer',
    strength: 2,
    shape: 'inv-hammer',
    label: 'Martillo Inv.',
    sublabel: 'Rechazo desde bajo ↑',
    bodyH:      0.12,   // cuerpo pequeño en la base
    wickLen:    0.68,   // mecha superior larga
    bottomWick: 0.04,   // mecha inferior mínima
  },

  // Harami alcista/bajista: cuerpo pequeño contenido dentro del rango anterior
  // Fuerza 1.5-2 — reversión suave, necesita confirmación
  // Verde = posible suelo (harami alcista), Rojo = posible techo (harami bajista)
  {
    id: 'harami',
    strength: 1.5,
    shape: 'harami',
    label: 'Harami',
    sublabel: 'Pausa dentro de rango',
    bodyFrac:   0.16,   // cuerpo pequeño centrado
    wickFrac:   0.12,   // mechas cortas (está contenido)
  },

  // Piercing Line (verde) / Dark Cloud Cover (rojo)
  // Cuerpo grande que penetra >50% del cuerpo de la vela anterior
  // Fuerza 3 — reversión confirmada, señal fuerte
  {
    id: 'piercing',
    strength: 3,
    shape: 'piercing',
    label: 'Piercing / Nube',
    sublabel: 'Penetra 50% anterior',
    body:       [0.18, 0.58],
    wickTop:    0.08,
    wickBottom: 0.16,   // mecha inferior visible (partió desde abajo)
  },

  // Doji 4-precio: cuerpo y mechas casi nulos — puro punto
  // Fuerza 1 — máxima indecisión, mercado completamente parado
  {
    id: 'doji-4price',
    strength: 1,
    shape: 'doji-4price',
    label: 'Doji 4-Precio',
    sublabel: 'Punto puro',
  },

  // Three White Soldiers (verde) / Three Black Crows (rojo)
  // Representa la 3ª vela fuerte consecutiva sin mechas — confirmación de tendencia máxima
  // Fuerza 3 — usarlo cuando llevas 3 velas seguidas del mismo color con cuerpos limpios
  {
    id: 'three-soldiers',
    strength: 3,
    shape: 'normal',
    label: 'Three Soldiers',
    sublabel: '3ª vela confirmación',
    body:        [0.10, 0.76],
    wickTop:     0.04,
    wickBottom:  0.06,
  },

  // Morning Star / Evening Star: doji o spinning entre dos velas grandes opuestas
  // Representa el "punto de giro" central del patrón de 3 velas
  // Fuerza 2.5 — úsalo cuando la vela actual es el giro entre dos opuestas
  {
    id: 'morning-star',
    strength: 2.5,
    shape: 'spinning',
    label: 'Estrella M/E',
    sublabel: 'Giro de 3 velas',
    bodyFrac:   0.14,
    wickFrac:   0.26,
  },
];

// ===== NUEVO PICKER — 2 filas (verde / roja), 6 tamaños, 1 click = vela añadida =====
//
// Elimina el flujo anterior de 3 pasos (color → tipo → confirmar fuerza).
// Ahora: ves la vela → click en la celda del color+tamaño → añadida al instante.
//
// Los 6 tamaños mapean directamente a las 6 fuerzas:
//   Doji(F1) · Pequeña(F1.5) · Normal(F2) · Grande(F2.5) · Muy grande(F3) · Marubozu(F4)

// ── Stubs mínimos — el picker visual fue eliminado, solo queda el de precio ──
// Boston overlay sigue usando buildPickerGrid/bostonDirectAdd que están más abajo.

let pickerColor    = null;
let pickerStrength = null;
let pickerTypeId   = null;

function initCandlePicker() { /* picker visual eliminado — se usa picker de precio */ }
function buildSizePicker()  { /* eliminado */ }
function quickAddCandle(color, strength) {
  confirmedStrength = strength;
  strengthOrigin    = 'corrected';
  addCandle(color);
}
function pickerDirectAdd(typeId, strength, color) { quickAddCandle(color, strength); }
function selectCandleType(typeId, strength) {
  pickerTypeId = typeId; pickerStrength = strength; correctStrength(strength);
}
function setCandlePickColor(color) { pickerColor = color; }
function updatePickerConfirmBtn() {}
function addCandleFromPicker() {
  if (pickerColor && pickerStrength) quickAddCandle(pickerColor, pickerStrength);
}

function buildPickerGrid(color) {
  // Solo para Boston overlay
  const grid = document.getElementById('candle-picker-grid');
  if (!grid) return;
  grid.innerHTML = CANDLE_TYPES.map(type => {
    const selG = pickerTypeId === type.id && pickerColor === 'G';
    const selR = pickerTypeId === type.id && pickerColor === 'R';
    return `<div class="candle-type-row ${selG?'sel-g':selR?'sel-r':''}" id="crow-${type.id}">
      <div class="ctr-name"><div class="ctr-label">${type.label}</div><div class="ctr-sub">${type.sublabel}</div></div>
      <button class="ctr-btn ctr-g ${selG?'ctr-active-g':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'G')">${buildCandleSVG(type,'G')}<div class="ctr-btn-label">🟢</div></button>
      <button class="ctr-btn ctr-r ${selR?'ctr-active-r':''}" onclick="bostonDirectAdd('${type.id}',${type.strength},'R')">${buildCandleSVG(type,'R')}<div class="ctr-btn-label">🔴</div></button>
    </div>`;
  }).join('');
}

function buildCandleSVG(type, color) {
  const W = 36, H = 52;
  const cx = W / 2;
  const bodyX = cx - 6;
  const bodyW = 12;

  const fill   = color === 'G' ? '#00ff88' : '#ff4444';
  const stroke = color === 'G' ? '#00cc66' : '#cc2222';

  const filterId  = `glow-${type.id}-${color}`;
  const filterDef = `<filter id="${filterId}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  const mkBody = (bTop, bH) =>
    `<rect x="${bodyX}" y="${bTop.toFixed(1)}" width="${bodyW}" height="${Math.max(bH,2).toFixed(1)}" fill="${fill}" rx="2" filter="url(#${filterId})" opacity="0.93"/>`;
  const mkWick = (y1, y2) =>
    (y1 < y2 - 0.5)
      ? `<line x1="${cx}" y1="${y1.toFixed(1)}" x2="${cx}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/>`
      : '';

  let svgBody = '';

  const s = type.shape;

  if (s === 'normal' || s === 'asymup' || s === 'asymdown') {
    const bTop = type.body[0] * H;
    const bH   = type.body[1] * H;
    svgBody = mkWick(type.wickTop * H, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, (1 - type.wickBottom) * H);

  } else if (s === 'spinning') {
    const mid  = H * 0.50;
    const bH   = (type.bodyFrac || 0.22) * H;
    const bTop = mid - bH / 2;
    const wLen = (type.wickFrac || 0.28) * H;
    svgBody = mkWick(bTop - wLen, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, bTop + bH + wLen);

  } else if (s === 'dragonfly') {
    const bTop = H * 0.05;
    const bH   = H * 0.11;
    svgBody = mkBody(bTop, bH) + mkWick(bTop + bH, H * 0.94);

  } else if (s === 'gravestone') {
    const bH  = H * 0.11;
    const bTop = H * 0.84;
    svgBody = mkWick(H * 0.06, bTop) + mkBody(bTop, bH);

  } else if (s === 'hammer') {
    const bH   = (type.bodyH || 0.12) * H;
    const bTop = H * 0.07;
    const botW = bTop + bH + (type.wickLen || 0.68) * H;
    const topW = (type.topWick || 0.02) * H;
    svgBody = mkWick(topW, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, Math.min(botW, H * 0.97));

  } else if (s === 'shootstar') {
    const bH   = (type.bodyH || 0.12) * H;
    const bTop = H * 0.81;
    const topW = H * 0.06;
    const botW = bTop + bH + (type.bottomWick || 0.04) * H;
    svgBody = mkWick(topW, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, Math.min(botW, H * 0.97));

  } else if (s === 'longleg') {
    const midY = H * 0.50;
    const hw   = 9;
    const col  = fill;
    svgBody = `<line x1="${cx}" y1="${(H*0.06).toFixed(1)}" x2="${cx}" y2="${(midY-1).toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`
            + `<line x1="${(cx-hw).toFixed(1)}" y1="${midY}" x2="${(cx+hw).toFixed(1)}" y2="${midY}" stroke="${col}" stroke-width="2.5" stroke-linecap="round" filter="url(#${filterId})"/>`
            + `<line x1="${cx}" y1="${(midY+1).toFixed(1)}" x2="${cx}" y2="${(H*0.94).toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`;

  // Inverted Hammer: cuerpo pequeño en la BASE, mecha larga ARRIBA
  // Opuesto visual al Martillo — alcista en fondo (verde), bajista en techo (rojo)
  } else if (s === 'inv-hammer') {
    const bH     = (type.bodyH || 0.12) * H;
    const bTop   = H * 0.81;                           // cuerpo abajo
    const topW   = H * 0.06;                           // inicio mecha superior
    const botEnd = bTop + bH + (type.bottomWick || 0.04) * H;
    svgBody = mkWick(topW, bTop)                       // mecha larga arriba
            + mkBody(bTop, bH)                         // cuerpo pequeño abajo
            + mkWick(bTop + bH, Math.min(botEnd, H * 0.97)); // mecha corta abajo

  // Harami: cuerpo pequeño centrado, mechas cortas — "contenido" en rango previo
  } else if (s === 'harami') {
    const mid  = H * 0.50;
    const bH   = (type.bodyFrac || 0.16) * H;
    const bTop = mid - bH / 2;
    const wLen = (type.wickFrac || 0.12) * H;
    svgBody = mkWick(bTop - wLen, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, bTop + bH + wLen);

  // Piercing / Dark Cloud: cuerpo grande que "entra" desde un lado
  // Verde: abre bajo, cierra arriba del 50% (mecha inferior visible)
  // Rojo:  abre alto, cierra bajo del 50% (mecha superior visible)
  } else if (s === 'piercing') {
    const bTop = type.body[0] * H;
    const bH   = type.body[1] * H;
    svgBody = mkWick(type.wickTop * H, bTop)
            + mkBody(bTop, bH)
            + mkWick(bTop + bH, (1 - type.wickBottom) * H);

  // Doji 4-precio: punto casi nulo, solo línea horizontal muy corta
  } else if (s === 'doji-4price') {
    const midY = H * 0.50;
    const hw   = 5;
    svgBody = `<line x1="${(cx-hw).toFixed(1)}" y1="${midY}" x2="${(cx+hw).toFixed(1)}" y2="${midY}" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" filter="url(#${filterId})"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="candle-pick-svg"><defs>${filterDef}</defs>${svgBody}</svg>`;
}


// Badge contextual según forma y color
function buildPickerBadge(type, color) {
  if (type.shape === 'dragonfly')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">↑ alcista</span>'
                         : '<span style="color:#888;font-size:0.85em">neutro</span>';
  if (type.shape === 'gravestone')
    return color === 'R' ? '<span style="color:#cc2222;font-size:0.85em">↓ bajista</span>'
                         : '<span style="color:#888;font-size:0.85em">neutro</span>';
  if (type.shape === 'longleg')
    return '<span style="color:#888;font-size:0.85em">± neutro</span>';
  if (type.shape === 'hammer')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">Martillo ↑</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">Colgado ↓</span>';
  if (type.shape === 'shootstar')
    return color === 'G' ? '<span style="color:#888;font-size:0.85em">neutro</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">Fuga ↓ techo</span>';
  if (type.shape === 'asymdown')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">rebote bajo</span>'
                         : '<span style="color:#888;font-size:0.85em">rechazo</span>';
  if (type.shape === 'asymup')
    return color === 'R' ? '<span style="color:#cc2222;font-size:0.85em">rechazo alto</span>'
                         : '<span style="color:#888;font-size:0.85em">rechazo</span>';
  // Nuevas velas
  if (type.shape === 'inv-hammer')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">↑ alcista fondo</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">↓ bajista techo</span>';
  if (type.shape === 'harami')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">pausa alcista</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">pausa bajista</span>';
  if (type.shape === 'piercing')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">↑ penetra roja</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">↓ cubre verde</span>';
  if (type.shape === 'doji-4price')
    return '<span style="color:#888;font-size:0.85em">punto puro</span>';
  if (type.id === 'three-soldiers')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">3 soldados ↑</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">3 cuervos ↓</span>';
  if (type.id === 'morning-star')
    return color === 'G' ? '<span style="color:#00cc66;font-size:0.85em">estrella mañana</span>'
                         : '<span style="color:#cc2222;font-size:0.85em">estrella tarde</span>';
  return '';
}

// (buildPickerGrid, pickerDirectAdd, selectCandleType, setCandlePickColor,
//  updatePickerConfirmBtn, addCandleFromPicker, initCandlePicker
//  — todos reemplazados por el nuevo SIZE PICKER arriba)



function broadcastEdit() {
  // Método 1: BroadcastChannel (más rápido, en tiempo real)
  if (bc) {
    try {
      bc.postMessage({
        type: 'strength-edited',
        payload: {
          manualStrengths: manualStrengths,
          history: history,              // ← AGREGADO: incluir historial
          volumeProfile: volumeProfile,  // ← AGREGADO: incluir VP
          cmdState: cmdState,              // ← AGREGADO: incluir CMD
          timestamp: Date.now()
        }
      });
      console.log('📡 Broadcast enviado:', Object.keys(manualStrengths).length, 'ediciones');
    } catch (e) {
      console.error('Error en BroadcastChannel:', e);
    }
  }
  
  // Método 2: localStorage (fallback, persiste entre sesiones)
  try {
    const data = {
      history: history,
      manualStrengths: manualStrengths,
      volumeProfile: volumeProfile,
      cmdState: cmdState,
      timestamp: Date.now()
    };
    localStorage.setItem('cmd-vp-data', JSON.stringify(data));
  } catch (e) {
    console.error('Error en localStorage:', e);
  }
  
  // Método 3: Intentar sincronizar con ventana del monitor si existe
  if (typeof monitorWindow !== 'undefined' && monitorWindow && !monitorWindow.closed) {
    try {
      monitorWindow.postMessage({
        type: 'vp-update',
        payload: {
          history: history,
          manualStrengths: manualStrengths,
          timestamp: Date.now()
        }
      }, '*');
    } catch (e) {
      // Silenciar errores de cross-origin
    }
  }
}

// Escuchar ediciones desde el monitor (VERSIÓN CORREGIDA CON LISTENER COMPLETO)
function setupEditListener() {
  const channel = typeof BroadcastChannel !== 'undefined' ? 
    new BroadcastChannel('cmd-detector-vp') : null;
    
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type === 'strength-edited') {
        if (e.data.payload.manualStrengths) {
          manualStrengths = e.data.payload.manualStrengths;
          update();
          console.log('📡 Fuerzas sincronizadas desde monitor');
        }
      }
      if (e.data?.type === 'vp-update') {
        if (e.data.payload.manualStrengths) {
          manualStrengths = e.data.payload.manualStrengths;
        }
      }
      // NUEVO: Escuchar solicitudes de apertura de panel de edición
      if (e.data?.type === 'open-edit-panel') {
        const index = e.data.payload?.index;
        if (index !== undefined && index >= 0 && index < history.length) {
          openEditPanel(index);
        }
      }
    };
  }
  
  // También escuchar cambios en localStorage como fallback
  window.addEventListener('storage', (e) => {
    if (e.key === 'cmd-vp-data') {
      try {
        const data = JSON.parse(e.newValue || '{}');
        if (data.manualStrengths) {
          manualStrengths = data.manualStrengths;
          update();
        }
      } catch(err) {}
    }
  });
}

// Inicializar listener al cargar
setupEditListener();

// Atajos de teclado corregidos
document.addEventListener('keydown', (e) => {
  // Si el panel de edición está abierto, cerrar con Escape
  if (document.getElementById('edit-panel').style.display === 'block') {
    if (e.key === 'Escape') {
      closeEditPanel();
      return;
    }
    return; // Bloquear otros atajos mientras se edita
  }
  
  if (document.getElementById('trap-modal').classList.contains('active')) return;
  
  const key = e.key.toLowerCase();
  
  if (strengthOrigin === 'pending') {
    
    if (key === '1') { correctStrength(1); }
    if (key === '2') { correctStrength(1.5); }
    if (key === '3') { correctStrength(2); }
    if (key === '4') { correctStrength(2.5); }
    if (key === '5') { correctStrength(3); }
    if (key === '6') { correctStrength(4); }
  } else {
    if (key === 'g') { setCandlePickColor('G'); addCandle('G'); }
    if (key === 'r') { setCandlePickColor('R'); addCandle('R'); }
  }
});

// ===== PRICE PICKER =====
// La lógica del picker de precio vive en el <script> inline del index.html.
// Aquí solo se mantienen las variables de estado que logic.js necesita
// para no romper si alguna función legacy las referencia.
let ppRefPrice  = null;
let ppMinPrice  = null;
let ppMaxPrice  = null;
let ppSpread    = 1;

// Stub — la implementación real está en index.html
function ppCenterRange(price) {
  ppRefPrice = price;
  ppMinPrice = parseFloat((price - ppSpread).toFixed(4));
  ppMaxPrice = parseFloat((price + ppSpread).toFixed(4));
}
function ppRenderBar()      { /* implementado en index.html */ }
function ppSetRef(val)      { /* implementado en index.html */ }
function ppUpdateSpread()   { /* implementado en index.html */ }
function ppBarClick(e)      { /* implementado en index.html */ }
function ppBarHover(e)      { /* implementado en index.html */ }
function ppBarLeave()       { /* implementado en index.html */ }
function ppRebuild()        { if (ppRefPrice !== null) ppCenterRange(ppRefPrice); }
function ppManualEnter()    { /* obsoleto */ }
function ppProcessPrice(p)  {
  // Fallback por si algo llama ppProcessPrice directamente
  if (typeof quickAddCandle === 'function' && ppMinPrice !== null) {
    const range = ppMaxPrice - ppMinPrice;
    const pct = range > 0 ? Math.min(100, Math.abs(p - ppRefPrice) / range * 100) : 0;
    const strengths = [[85,4],[65,3],[45,2.5],[25,2],[8,1.5],[0,1]];
    const str = (strengths.find(([min]) => pct >= min) || [0,1])[1];
    quickAddCandle(p >= ppRefPrice ? 'G' : 'R', str);
    ppCenterRange(p);
  }
}

// ===== FIN PRICE PICKER =====

// Inicializar
update();
initCandlePicker();
initFocusMode();

console.log('🚀 Detector CMD + VP iniciado.');

// ===== MOTOR DE PREDICCIÓN: dirección + velas estimadas =====
//
// Combina VP (objetivo de precio) + MA (momentum) + CMD (fase) + historial
// para estimar dirección probable y cuántas velas tardará en cumplirse.

function calculatePrediction() {
  const result = {
    hasData:     false,
    direction:   'neutral',  // 'bullish' | 'bearish' | 'neutral'
    confidence:  0,           // 0–1
    targetLevel: null,        // % del rango VP (POC, VAH o VAL)
    targetName:  '',
    distancePct: null,        // distancia en % del rango
    candlesMin:  null,
    candlesMax:  null,
    reasons:     [],
  };

  if (history.length < 5) return result;

  const trendMA    = calcMA(10, false);
  const prevMA10   = calcPrevMA(10, false);
  const shortMA    = calcShortMA();
  const vp         = volumeProfile;
  const recentTrend = analyzeRecentTrend();
  const extremeCond = detectExtreme(trendMA, recentTrend);

  result.hasData = true;

  // ── 1. DETERMINAR DIRECCIÓN ─────────────────────────────────────────────
  let bullScore = 0, bearScore = 0;
  const reasons = [];

  // VP: posición actual vs objetivo magnético
  if (vp.poc !== null) {
    if (vp.currentPosition === 'below') {
      bullScore += 2.5;
      reasons.push({ text: `Precio bajo VAL (${vp.val?.toFixed(1)}%) — imán hacia POC`, strong: true });
    } else if (vp.currentPosition === 'above') {
      bearScore += 2.5;
      reasons.push({ text: `Precio sobre VAH (${vp.vah?.toFixed(1)}%) — probable regreso al VA`, strong: true });
    } else if (vp.currentPosition === 'poc') {
      // En POC: usar MA para desempatar
      reasons.push({ text: `Precio en POC (${vp.poc.toFixed(1)}%) — zona de equilibrio, MA decide` });
    } else if (vp.currentPosition === 'inside') {
      // Dentro del VA: hacia el lado que apunta MA
      if (trendMA !== null && trendMA > 55) {
        bullScore += 1.0;
        reasons.push({ text: `Dentro VA, MA10 alcista (${trendMA?.toFixed(0)}%) → hacia VAH` });
      } else if (trendMA !== null && trendMA < 45) {
        bearScore += 1.0;
        reasons.push({ text: `Dentro VA, MA10 bajista (${trendMA?.toFixed(0)}%) → hacia VAL` });
      }
    }

    // VP: volumen alcista vs bajista en las últimas 5 filas del histograma
    if (vp.histogram && vp.histogram.length > 0) {
      const topRows = vp.histogram.slice(-5); // filas superiores (precio alto)
      const botRows = vp.histogram.slice(0, 5); // filas inferiores (precio bajo)
      const topUp   = topRows.reduce((a, r) => a + r.upVolume, 0);
      const topDown = topRows.reduce((a, r) => a + r.downVolume, 0);
      const botUp   = botRows.reduce((a, r) => a + r.upVolume, 0);
      const botDown = botRows.reduce((a, r) => a + r.downVolume, 0);

      if (botUp > botDown * 1.3) {
        bullScore += 1.0;
        reasons.push({ text: `Volumen alcista dominante en zona baja del VP` });
      }
      if (topDown > topUp * 1.3) {
        bearScore += 1.0;
        reasons.push({ text: `Volumen bajista dominante en zona alta del VP` });
      }
    }
  }

  // MA10: dirección y momentum
  if (trendMA !== null) {
    const maDiff = prevMA10 !== null ? trendMA - prevMA10 : 0;
    if (trendMA > 60) {
      bullScore += 1.5;
      reasons.push({ text: `MA10 alcista (${trendMA.toFixed(0)}%)` + (maDiff > 0 ? ` +${maDiff.toFixed(1)}%` : '') });
    } else if (trendMA < 40) {
      bearScore += 1.5;
      reasons.push({ text: `MA10 bajista (${trendMA.toFixed(0)}%)` + (maDiff < 0 ? ` ${maDiff.toFixed(1)}%` : '') });
    }
    if (maDiff > 5)  { bullScore += 0.5; reasons.push({ text: `Momentum alcista creciente` }); }
    if (maDiff < -5) { bearScore += 0.5; reasons.push({ text: `Momentum bajista creciente` }); }
  }

  // MA3 corta
  if (shortMA !== null) {
    if (shortMA > 66) { bullScore += 1.0; }
    if (shortMA < 34) { bearScore += 1.0; }
  }

  // CMD fase
  if (cmdState.phase === 'accumulation' && cmdState.probability > 0.5) {
    bullScore += cmdState.probability * 2;
    reasons.push({ text: `CMD: Acumulación (${Math.round(cmdState.probability*100)}%)`, strong: true });
  }
  if (cmdState.phase === 'distribution' && cmdState.probability > 0.5) {
    bearScore += cmdState.probability * 2;
    reasons.push({ text: `CMD: Distribución (${Math.round(cmdState.probability*100)}%)`, strong: true });
  }
  if (cmdState.phase === 'manipulation' && cmdState.probability > 0.6) {
    reasons.push({ text: `CMD: Manipulación activa — dirección incierta` });
  }

  // Extremo activo
  if (extremeCond) {
    if (extremeCond.type === 'extreme_bearish') {
      bullScore += 2.0;
      reasons.push({ text: `Sobreventa extrema — rebote alcista probable`, strong: true });
    }
    if (extremeCond.type === 'extreme_bullish') {
      bearScore += 2.0;
      reasons.push({ text: `Sobrecompra extrema — corrección bajista probable`, strong: true });
    }
  }

  // Racha reciente ponderada
  if (recentTrend.isExtreme && recentTrend.trend === 'bearish') {
    bearScore += 1.5;
    reasons.push({ text: `Racha bajista extrema (${recentTrend.strength} velas)` });
  }
  if (recentTrend.isExtreme && recentTrend.trend === 'bullish') {
    bullScore += 1.5;
    reasons.push({ text: `Racha alcista extrema (${recentTrend.strength} velas)` });
  }

  // ── 2. DETERMINAR DIRECCIÓN FINAL ───────────────────────────────────────
  const totalScore = bullScore + bearScore;
  if (totalScore === 0) {
    result.direction  = 'neutral';
    result.confidence = 0.30;
    reasons.push({ text: `Sin señales claras de dirección` });
  } else {
    const bullPct = bullScore / totalScore;
    if (bullPct >= 0.60) {
      result.direction  = 'bullish';
      result.confidence = Math.min(0.50 + (bullPct - 0.60) * 2.0, 0.92);
    } else if (bullPct <= 0.40) {
      result.direction  = 'bearish';
      result.confidence = Math.min(0.50 + (0.40 - bullPct) * 2.0, 0.92);
    } else {
      result.direction  = 'neutral';
      result.confidence = 0.30 + Math.abs(bullPct - 0.50);
    }
  }

  result.reasons = reasons.slice(0, 5); // máximo 5 razones

  // ── 3. OBJETIVO DE PRECIO (magneto VP) ──────────────────────────────────
  if (vp.poc !== null && vp.currentPriceLevel !== null) {
    const price = vp.currentPriceLevel;

    if (result.direction === 'bullish') {
      if (price < vp.val) {
        result.targetLevel = vp.poc;
        result.targetName  = 'POC';
        result.distancePct = Math.abs(vp.poc - price);
      } else if (price < vp.poc) {
        result.targetLevel = vp.poc;
        result.targetName  = 'POC';
        result.distancePct = Math.abs(vp.poc - price);
      } else if (price < vp.vah) {
        result.targetLevel = vp.vah;
        result.targetName  = 'VAH';
        result.distancePct = Math.abs(vp.vah - price);
      } else {
        result.targetLevel = vp.vah;
        result.targetName  = 'VAH';
        result.distancePct = Math.abs(vp.vah - price);
      }
    } else if (result.direction === 'bearish') {
      if (price > vp.vah) {
        result.targetLevel = vp.poc;
        result.targetName  = 'POC';
        result.distancePct = Math.abs(price - vp.poc);
      } else if (price > vp.poc) {
        result.targetLevel = vp.poc;
        result.targetName  = 'POC';
        result.distancePct = Math.abs(price - vp.poc);
      } else if (price > vp.val) {
        result.targetLevel = vp.val;
        result.targetName  = 'VAL';
        result.distancePct = Math.abs(price - vp.val);
      } else {
        result.targetLevel = vp.val;
        result.targetName  = 'VAL';
        result.distancePct = Math.abs(price - vp.val);
      }
    }
  }

  // ── 4. ESTIMACIÓN DE VELAS ───────────────────────────────────────────────
  if (result.distancePct !== null && result.distancePct > 0) {
    // Fuerza promedio de las últimas 5 velas (excluir las muy débiles)
    const last5Str = [];
    for (let i = Math.max(0, history.length - 5); i < history.length; i++) {
      last5Str.push(getCandleStrength(i) || 2);
    }
    const avgStr = last5Str.reduce((a, b) => a + b, 0) / last5Str.length;
    const effectiveStr = Math.max(avgStr, 1.2); // mínimo 1.2 para no dividir por casi 0

    // Cada "unidad de fuerza 2" mueve ~2.5% del rango VP por vela (calibrado)
    const movePerCandle = effectiveStr * 2.5;

    // Ajuste por momentum MA
    let momentumFactor = 1.0;
    if (trendMA !== null && prevMA10 !== null) {
      const maDiff = trendMA - prevMA10;
      if (result.direction === 'bullish' && maDiff > 3)  momentumFactor = 1.25; // acelerando
      if (result.direction === 'bullish' && maDiff < -3) momentumFactor = 0.80; // frenando
      if (result.direction === 'bearish' && maDiff < -3) momentumFactor = 1.25;
      if (result.direction === 'bearish' && maDiff > 3)  momentumFactor = 0.80;
    }

    // Ajuste por CMD fase (acumulación/distribución = más rápido)
    if ((cmdState.phase === 'accumulation' || cmdState.phase === 'distribution') && cmdState.probability > 0.5) {
      momentumFactor *= 1.15;
    }

    const adjustedMove = movePerCandle * momentumFactor;
    const candlesCentral = result.distancePct / adjustedMove;

    // Rango de incertidumbre: ±35%
    result.candlesMin = Math.max(1, Math.round(candlesCentral * 0.65));
    result.candlesMax = Math.round(candlesCentral * 1.35);
    if (result.candlesMax < result.candlesMin + 1) result.candlesMax = result.candlesMin + 2;
    if (result.candlesMax > 30) result.candlesMax = 30; // cap razonable
  }

  return result;
}

function updatePredictionPanel() {
  const p = calculatePrediction();

  // ===== PUENTE: Escribir estado de predicción para que la señal principal lo lea =====
  predictionState = {
    direction:      p.direction,
    confidence:     p.confidence,
    targetPosition: p.targetName  || null,
    candlesEstimate: p.candlesMin !== null ? `${p.candlesMin}-${p.candlesMax}` : null,
    ready:          p.hasData
  };

  const notEnough  = document.getElementById('pred-not-enough');
  const dirBox     = document.getElementById('pred-direction');
  const targetRow  = document.getElementById('pred-target-row');
  const candlesBox = document.getElementById('pred-candles-box');
  const reasonsEl  = document.getElementById('pred-reasons');
  const confBar    = document.getElementById('pred-conf-bar');

  if (!p.hasData) {
    if (notEnough) notEnough.style.display = 'block';
    [dirBox, targetRow, candlesBox, reasonsEl, confBar].forEach(el => { if(el) el.style.display = 'none'; });
    return;
  }

  if (notEnough) notEnough.style.display = 'none';
  [dirBox, targetRow, candlesBox, reasonsEl, confBar].forEach(el => { if(el) el.style.display = ''; });

  // Dirección
  const icons = { bullish: '📈', bearish: '📉', neutral: '↔️' };
  const labels = { bullish: 'ALCISTA', bearish: 'BAJISTA', neutral: 'LATERAL' };
  const dirClasses = { bullish: 'pred-bullish', bearish: 'pred-bearish', neutral: 'pred-neutral' };

  if (dirBox) {
    dirBox.className = 'pred-direction ' + (dirClasses[p.direction] || '');
    document.getElementById('pred-dir-icon').textContent  = icons[p.direction];
    document.getElementById('pred-dir-value').textContent = labels[p.direction];
    document.getElementById('pred-dir-conf').textContent  =
      `Confianza: ${Math.round(p.confidence * 100)}%`;
  }

  // Objetivo
  if (p.targetLevel !== null) {
    document.getElementById('pred-target-level').textContent = `${p.targetName} ${p.targetLevel.toFixed(1)}%`;
    document.getElementById('pred-target-dist').textContent  = `${p.distancePct.toFixed(1)}% del rango`;
    if (targetRow) targetRow.style.display = '';
  } else {
    if (targetRow) targetRow.style.display = 'none';
  }

  // Velas estimadas
  if (p.candlesMin !== null) {
    document.getElementById('pred-candles-value').textContent =
      `${p.candlesMin} – ${p.candlesMax} velas`;
    document.getElementById('pred-candles-sub').textContent =
      p.direction === 'neutral'
        ? 'Movimiento lateral sin objetivo claro'
        : `Hasta alcanzar ${p.targetName || 'objetivo'}`;
    if (candlesBox) candlesBox.style.display = '';
  } else {
    if (candlesBox) candlesBox.style.display = 'none';
  }

  // Razones
  if (reasonsEl && p.reasons.length > 0) {
    reasonsEl.innerHTML = p.reasons.map(r =>
      `<div class="pred-reason-item ${r.strong ? 'strong' : ''}">
        ${r.strong ? '▸' : '·'} ${r.text}
      </div>`
    ).join('');
    reasonsEl.style.display = '';
  }

  // Barra de confianza
  const fill = document.getElementById('pred-conf-fill');
  if (fill) fill.style.width = Math.round(p.confidence * 100) + '%';
  if (confBar) confBar.style.display = '';
}


// Overlay que muestra SOLO señal + selector de vela + historial mínimo

let bostonActive  = false;
let bostonColor   = null;
let bostonTypeId  = null;
let bostonStr     = null;

function toggleBoston() {
  bostonActive = !bostonActive;
  const overlay = document.getElementById('boston-overlay');
  const btn     = document.getElementById('boston-btn-main');
  if (bostonActive) {
    overlay.classList.add('active');
    btn.classList.add('active');
    bostonColor = null; bostonTypeId = null; bostonStr = null;
    bostonRenderGrid();
    bostonSyncSignal();
    bostonSyncHistory();
  } else {
    overlay.classList.remove('active');
    btn.classList.remove('active');
  }
}

// Sincroniza la señal principal hacia el overlay Boston
function bostonSyncSignal() {
  const src   = document.getElementById('main-signal');
  const dest  = document.getElementById('boston-signal');
  const ctx   = document.getElementById('boston-context');
  const logic = document.getElementById('logic-text');
  if (!src || !dest) return;

  // Copiar clases de color y texto de la señal
  dest.className = src.className.replace('main-signal', '').trim() || 'signal-wait';

  // Texto limpio (sin los badges internos)
  const clone = src.cloneNode(true);
  clone.querySelectorAll('div').forEach(d => d.remove());
  dest.textContent = clone.textContent.trim() || 'ESPERAR';

  // Contexto: la lógica en una línea
  if (ctx && logic) ctx.textContent = logic.textContent || '';

  // Proyecciones
  const gSig  = document.getElementById('proj-g-sig');
  const gConf = document.getElementById('proj-g-conf');
  const rSig  = document.getElementById('proj-r-sig');
  const rConf = document.getElementById('proj-r-conf');
  if (gSig)  document.getElementById('boston-proj-g-sig').textContent  = gSig.textContent;
  if (gConf) document.getElementById('boston-proj-g-conf').textContent = gConf.textContent;
  if (rSig)  document.getElementById('boston-proj-r-sig').textContent  = rSig.textContent;
  if (rConf) document.getElementById('boston-proj-r-conf').textContent = rConf.textContent;

  // Colorear proyecciones
  const gBox = document.getElementById('boston-proj-g');
  const rBox = document.getElementById('boston-proj-r');
  const gsig = gSig?.textContent || '';
  const rsig = rSig?.textContent || '';
  if (gBox) gBox.style.borderColor = gsig.includes('COMPRA') ? 'var(--green)' : gsig.includes('VENTA') ? 'var(--red)' : '#333';
  if (rBox) rBox.style.borderColor = rsig.includes('VENTA') ? 'var(--red)' : rsig.includes('COMPRA') ? 'var(--green)' : '#333';
}

// Historial compacto en Boston (últimas 15 velas)
function bostonSyncHistory() {
  const container = document.getElementById('boston-history');
  if (!container) return;
  const last = history.slice(-15);
  container.innerHTML = last.map((h, i) => {
    const absIdx = history.length - last.length + i;
    const s = getCandleStrength(absIdx) || 2;
    const label = s >= 4 ? '4🔥' : s >= 3 ? '3' : s >= 2.5 ? '2+' : s >= 2 ? '2' : s >= 1.5 ? '1+' : '1';
    return `<div style="
      width:26px;height:26px;border-radius:4px;
      background:${h==='G'?'var(--green)':'var(--red)'};
      color:${h==='G'?'#000':'#fff'};
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-size:9px;font-weight:bold;cursor:default;
    " title="Vela #${absIdx+1}: ${h} fuerza ${s}">${h}<span style="font-size:7px;opacity:0.8">${label}</span></div>`;
  }).join('');
}

// Renderizar grid de velas en Boston (mismas velas que el picker principal)
function bostonRenderGrid() {
  const grid = document.getElementById('boston-candle-grid');
  if (!grid) return;

  grid.innerHTML = CANDLE_TYPES.map(type => {
    const selG = bostonTypeId === type.id && bostonColor === 'G';
    const selR = bostonTypeId === type.id && bostonColor === 'R';
    const rowClass = selG ? 'sel-g' : selR ? 'sel-r' : '';

    const strConf  = STRENGTH_CONFIG.LEVELS[type.strength] || STRENGTH_CONFIG.LEVELS[2];
    const strBars  = strConf.icon;
    const strName  = strConf.name;
    const strColor = strConf.color;

    return `<div class="candle-type-row ${rowClass}">
      <div class="ctr-name">
        <div class="ctr-label">${type.label}</div>
        <div class="ctr-sub">${type.sublabel}</div>
      </div>
      <div class="ctr-strength" title="Fuerza: ${strName} (${type.strength})">
        <div style="font-size:0.75em;letter-spacing:1px;color:${strColor};font-weight:bold;">${strBars}</div>
        <div style="font-size:0.6em;color:${strColor};white-space:nowrap;">${strName}</div>
        <div style="font-size:0.55em;color:#555;">${type.strength}/4</div>
      </div>
      <button class="ctr-btn ctr-g ${selG ? 'ctr-active-g' : ''}"
              onclick="bostonDirectAdd('${type.id}', ${type.strength}, 'G')"
              title="${type.label} verde — fuerza ${strName}">
        ${buildCandleSVG(type, 'G')}
        <div class="ctr-btn-label">🟢</div>
      </button>
      <button class="ctr-btn ctr-r ${selR ? 'ctr-active-r' : ''}"
              onclick="bostonDirectAdd('${type.id}', ${type.strength}, 'R')"
              title="${type.label} rojo — fuerza ${strName}">
        ${buildCandleSVG(type, 'R')}
        <div class="ctr-btn-label">🔴</div>
      </button>
    </div>`;
  }).join('');
}

// Un click en 🟢 o 🔴 del Boston → añade directo
function bostonDirectAdd(typeId, strength, color) {
  bostonTypeId = typeId;
  bostonStr    = strength;
  bostonColor  = color;
  document.getElementById('boston-btn-green').className =
    'boston-color-btn' + (color === 'G' ? ' active-green' : '');
  document.getElementById('boston-btn-red').className =
    'boston-color-btn' + (color === 'R' ? ' active-red' : '');
  correctStrength(strength);
  bostonAdd();
}

function bostonSetColor(color) {
  bostonColor = color;
  document.getElementById('boston-btn-green').className =
    'boston-color-btn' + (color === 'G' ? ' active-green' : '');
  document.getElementById('boston-btn-red').className =
    'boston-color-btn' + (color === 'R' ? ' active-red' : '');
  bostonRenderGrid();
  bostonUpdateAddBtn();
}

function bostonSelectType(typeId, strength) {
  bostonTypeId = typeId;
  bostonStr    = strength;
  // Sync with main picker state so correctStrength updates the suggestion panel
  correctStrength(strength);
  bostonRenderGrid();
  bostonUpdateAddBtn();
}

function bostonUpdateAddBtn() {
  const btn = document.getElementById('boston-add-btn');
  if (!btn) return;
  if (bostonColor && bostonTypeId) {
    btn.classList.add('ready');
    btn.classList.remove('green-ready','red-ready');
    const type = CANDLE_TYPES.find(t => t.id === bostonTypeId);
    const name = type ? type.label : '';
    if (bostonColor === 'G') {
      btn.classList.add('green-ready');
      btn.textContent = `🟢 Añadir VERDE — ${name}`;
    } else {
      btn.classList.add('red-ready');
      btn.textContent = `🔴 Añadir ROJO — ${name}`;
    }
  } else if (bostonColor) {
    btn.classList.remove('ready','green-ready','red-ready');
    btn.textContent = '← Selecciona el tipo de vela';
  } else {
    btn.classList.remove('ready','green-ready','red-ready');
    btn.textContent = '← Selecciona color y tipo';
  }
}

function bostonAdd() {
  if (!bostonColor || !bostonStr) return;
  // Use main addCandle — it runs all analysis and update()
  addCandle(bostonColor);
  // Reset Boston state
  bostonColor  = null;
  bostonTypeId = null;
  bostonStr    = null;
  document.getElementById('boston-btn-green').className = 'boston-color-btn';
  document.getElementById('boston-btn-red').className   = 'boston-color-btn';
  // Re-render with updated signal
  bostonRenderGrid();
  bostonUpdateAddBtn();
  bostonSyncSignal();
  bostonSyncHistory();
  // Visual flash on signal
  const sig = document.getElementById('boston-signal');
  if (sig) {
    sig.style.transform = 'scale(1.04)';
    setTimeout(() => { sig.style.transform = ''; }, 200);
  }
}

// Patch update() to also refresh Boston if it's open
const _origUpdate = update;
update = function() {
  _origUpdate();
  if (bostonActive) {
    bostonSyncSignal();
    bostonSyncHistory();
  }
};




function initFocusMode() {
  // Restaurar preferencia guardada
  try {
    focusModeActive = localStorage.getItem('focusMode') === 'true';
  } catch(e) {}
  applyFocusMode();
}

function toggleFocusMode() {
  focusModeActive = !focusModeActive;
  try { localStorage.setItem('focusMode', focusModeActive); } catch(e) {}
  applyFocusMode();
}

function applyFocusMode() {
  const btn = document.getElementById('focus-switch');
  if (focusModeActive) {
    document.body.classList.add('focus-mode');
    if (btn) btn.classList.add('active');
  } else {
    document.body.classList.remove('focus-mode');
    if (btn) btn.classList.remove('active');
  }
}




function openMonitor() {
  // Si ya hay una ventana abierta, enfocarla
  if (monitorWindow && !monitorWindow.closed) {
    monitorWindow.focus();
    console.log('📊 Monitor ya abierto, enfocando...');
    return;
  }
  
  // Abrir monitor en nueva pestaña
  monitorWindow = window.open('monitor.html', 'TradingMonitor', 'width=800,height=900,menubar=no,toolbar=no,location=no,status=no');
  
  if (!monitorWindow) {
    alert('El navegador bloqueó la ventana emergente. Por favor, permite popups para este sitio.');
    return;
  }
  
  console.log('📊 Monitor abierto en nueva pestaña');
  
  // Enviar datos actuales al monitor después de que cargue
  setTimeout(() => {
    broadcastEdit();
  }, 1000);
}

// Sincronizar automáticamente con el monitor en cada actualización
// broadcastEdit() ya maneja BroadcastChannel + localStorage en cada addCandle/edit.
// No se necesita wrapper adicional sobre update().
