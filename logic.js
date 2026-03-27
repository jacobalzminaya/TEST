// ===== logic.js — Motor principal CMD + MA + Fibonacci + Señales =====
// DEPENDENCIAS (cargar ANTES en index.html):
//   patterns.js  — Biblioteca de patrones de velas
// FIXES APLICADOS:
//   Fix 1 (P-CMD-MANIP): Manipulacion cede a patrones con confianza >=85%
//   Fix 2 (P-CMD-CONS):  Consolidacion solo bloquea patrones debiles (<65%)
//   Fix 3 (P6-FLOOR):    Prioridad 6 requiere minimo 60% de confianza
// =======================================================================

// ======================================================= NUEVA CONFIGURACIÓN =============================================================================

// ═══════════════════════════════════════════════════════════
// SISTEMA DE FIBONACCI - RETROCESOS Y EXTENSIONES
// ═══════════════════════════════════════════════════════════

const FIBONACCI_CONFIG = {
  // Niveles clásicos de retroceso
  RETRACEMENT_LEVELS: [0.236, 0.382, 0.5, 0.618, 0.786, 0.886],
  // Niveles de extensión para targets
  EXTENSION_LEVELS: [1.272, 1.618, 2.0, 2.618, 3.618, 4.236],
  // Niveles internos para confirmación
  INTERNAL_LEVELS: [0.146, 0.854],
  // Configuración de zonas
  ZONE_TOLERANCE: 0.03, // ±3% de tolerancia para considerar "en zona"
  MIN_SWING_SIZE: 3,    // Mínimo de velas para considerar un swing válido
  MIN_SWING_STRENGTH: 4 // Fuerza mínima acumulada del movimiento
};

// Estado global de Fibonacci
let fibState = {
  active: false,
  type: null,           // 'retracement' | 'extension' | 'none'
  direction: null,      // 'bullish' | 'bearish'
  swingHigh: null,      // Índice del máximo
  swingLow: null,       // Índice del mínimo
  levels: {},           // Niveles calculados con precios simulados
  currentZone: null,    // Zona actual donde estamos
  nearestLevel: null,   // Nivel más cercano
  projection: null,     // Proyección para siguiente vela
  confluence: []        // Patrones que coinciden con niveles Fib
};

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE SWINGS (MÁXIMOS Y MÍNIMOS SIGNIFICATIVOS)
// ═══════════════════════════════════════════════════════════

function detectSignificantSwings() {
  if (history.length < FIBONACCI_CONFIG.MIN_SWING_SIZE * 2) {
    return { high: null, low: null, valid: false };
  }

  const len = history.length;
  const lookback = Math.min(20, len - 1); // Analizar últimas 20 velas
  
  // Buscar máximos y mínimos locales usando fuerza de velas
  let maxIdx = null, maxStrength = 0;
  let minIdx = null, minStrength = 0;
  
  // Encontrar máximo: secuencia alcista seguida de debilitamiento
  for (let i = len - lookback; i < len - 1; i++) {
    const color = history[i];
    const str = getCandleStrength(i) || 2;
    
    if (color === 'G') {
      // Buscar pico alcista: G fuerte seguido de debilitamiento
      const nextColor = history[i + 1];
      const nextStr = getCandleStrength(i + 1) || 2;
      
      if (str >= 2.5 && (nextColor === 'R' || nextStr < str)) {
        const swingStrength = calculateSwingStrength(i, 'high');
        if (swingStrength > maxStrength) {
          maxStrength = swingStrength;
          maxIdx = i;
        }
      }
    }
  }
  
  // Encontrar mínimo: secuencia bajista seguida de debilitamiento
  for (let i = len - lookback; i < len - 1; i++) {
    const color = history[i];
    const str = getCandleStrength(i) || 2;
    
    if (color === 'R') {
      const nextColor = history[i + 1];
      const nextStr = getCandleStrength(i + 1) || 2;
      
      if (str >= 2.5 && (nextColor === 'G' || nextStr < str)) {
        const swingStrength = calculateSwingStrength(i, 'low');
        if (swingStrength > minStrength) {
          minStrength = swingStrength;
          minIdx = i;
        }
      }
    }
  }
  
  // Validar que hay un movimiento significativo entre ellos
  const valid = maxIdx !== null && minIdx !== null && 
                Math.abs(maxIdx - minIdx) >= FIBONACCI_CONFIG.MIN_SWING_SIZE &&
                (maxStrength + minStrength) >= FIBONACCI_CONFIG.MIN_SWING_STRENGTH;
  
  return {
    high: maxIdx,
    low: minIdx,
    highStrength: maxStrength,
    lowStrength: minStrength,
    valid: valid,
    direction: maxIdx > minIdx ? 'bullish' : 'bearish'
  };
}

function calculateSwingStrength(idx, type) {
  // Calcular fuerza acumulada del movimiento hacia el swing
  let strength = 0;
  const color = type === 'high' ? 'G' : 'R';
  
  for (let i = Math.max(0, idx - 5); i <= idx; i++) {
    if (history[i] === color) {
      strength += getCandleStrength(i) || 2;
    } else {
      strength -= (getCandleStrength(i) || 2) * 0.5; // Penalizar contramovimiento
    }
  }
  
  return Math.max(0, strength);
}

// ═══════════════════════════════════════════════════════════
// CÁLCULO DE NIVELES DE FIBONACCI
// ═══════════════════════════════════════════════════════════

function calculateFibonacciLevels() {
  const swings = detectSignificantSwings();
  
  if (!swings.valid) {
    fibState = { active: false, type: 'none', levels: {}, confluence: [] };
    return fibState;
  }
  
  const { high: highIdx, low: lowIdx, direction } = swings;
  
  // "Precios" simulados basados en fuerza acumulada
  const highPrice = simulatePriceAtIndex(highIdx, 'high');
  const lowPrice = simulatePriceAtIndex(lowIdx, 'low');
  const range = highPrice - lowPrice;
  
  const levels = {};
  const isBullish = direction === 'bullish'; // Subió de low a high
  
  // Calcular retrocesos desde el punto más reciente
  FIBONACCI_CONFIG.RETRACEMENT_LEVELS.forEach(level => {
    const price = isBullish 
      ? highPrice - (range * level)  // Retroceso desde máximo
      : lowPrice + (range * level);  // Retroceso desde mínimo
    
    levels[`retrace_${Math.round(level * 1000)}`] = {
      level: level,
      price: price,
      type: 'retracement',
      label: `${(level * 100).toFixed(1)}%`
    };
  });
  
  // Calcular extensiones para targets
  FIBONACCI_CONFIG.EXTENSION_LEVELS.forEach(level => {
    const price = isBullish
      ? highPrice + (range * (level - 1))  // Extensión alcista
      : lowPrice - (range * (level - 1));  // Extensión bajista
    
    levels[`extend_${Math.round(level * 1000)}`] = {
      level: level,
      price: price,
      type: 'extension',
      label: `${level.toFixed(3)}x`
    };
  });
  
  // Nivel 0% y 100%
  levels.zero = { level: 0, price: isBullish ? highPrice : lowPrice, type: 'origin', label: '0%' };
  levels.hundred = { level: 1, price: isBullish ? lowPrice : highPrice, type: 'origin', label: '100%' };
  
  // Determinar posición actual respecto a niveles
  const currentIdx = history.length - 1;
  const currentPrice = simulatePriceAtIndex(currentIdx, 'current');
  const currentPosition = (currentPrice - lowPrice) / range;
  
  // Encontrar zona actual y nivel más cercano
  let nearestLevel = null;
  let minDistance = Infinity;
  let currentZone = null;
  
  Object.values(levels).forEach(lvl => {
    const distance = Math.abs(currentPosition - lvl.level);
    if (distance < minDistance) {
      minDistance = distance;
      nearestLevel = lvl;
    }
    if (distance < FIBONACCI_CONFIG.ZONE_TOLERANCE) {
      currentZone = lvl;
    }
  });
  
  // Generar proyección basada en nivel actual
  const projection = generateFibProjection(
    currentPosition, 
    currentZone, 
    nearestLevel, 
    isBullish,
    history[currentIdx],
    getCandleStrength(currentIdx) || 2
  );
  
  // Buscar confluencia con patrones de velas
  const confluence = findFibPatternConfluence(levels, currentZone);
  
  fibState = {
    active: true,
    type: currentZone ? 'in_zone' : 'approaching',
    direction: isBullish ? 'bullish' : 'bearish',
    swingHigh: highIdx,
    swingLow: lowIdx,
    levels: levels,
    currentZone: currentZone,
    nearestLevel: nearestLevel,
    currentPosition: currentPosition,
    projection: projection,
    confluence: confluence,
    range: range,
    highPrice: highPrice,
    lowPrice: lowPrice
  };
  
  return fibState;
}

function simulatePriceAtIndex(idx, type) {
  // Simular precio basado en secuencia de velas y fuerzas
  let price = 100; // Precio base arbitrario
  
  for (let i = 0; i <= idx && i < history.length; i++) {
    const color = history[i];
    const str = getCandleStrength(i) || 2;
    const change = (str / 4) * (color === 'G' ? 1 : -1) * (1 + Math.random() * 0.1);
    price *= (1 + change * 0.02);
  }
  
  // Ajustar según tipo
  if (type === 'high') price *= 1.005;
  if (type === 'low') price *= 0.995;
  
  return price;
}

// ═══════════════════════════════════════════════════════════
// GENERACIÓN DE PROYECCIONES FIBONACCI
// ═══════════════════════════════════════════════════════════

function generateFibProjection(currentPos, currentZone, nearestLevel, isBullish, currentColor, currentStrength) {
  const projections = {
    ifG: { target: null, confidence: 0.5, reason: '' },
    ifR: { target: null, confidence: 0.5, reason: '' }
  };
  
  // Lógica de retroceso: buscar rechazo en nivel clave
  if (currentZone && currentZone.type === 'retracement') {
    const level = currentZone.level;
    
    // Nivel 61.8% - "Golden Ratio" - mayor confianza
    if (Math.abs(level - 0.618) < 0.05) {
      if (isBullish && currentColor === 'G') {
        projections.ifG = {
          target: 'extension_1618',
          confidence: 0.85,
          reason: '🎯 Rebote en 61.8% Golden Ratio - Continuación alcista probable'
        };
        projections.ifR = {
          target: 'retrace_786',
          confidence: 0.70,
          reason: '⚠️ Pérdida de 61.8% busca 78.6%'
        };
      } else if (!isBullish && currentColor === 'R') {
        projections.ifR = {
          target: 'extension_1618',
          confidence: 0.85,
          reason: '🎯 Rebote en 61.8% Golden Ratio - Continuación bajista probable'
        };
        projections.ifG = {
          target: 'retrace_786',
          confidence: 0.70,
          reason: '⚠️ Pérdida de 61.8% busca 78.6%'
        };
      }
    }
    
    // Nivel 38.2% - retroceso débil, tendencia fuerte
    else if (Math.abs(level - 0.382) < 0.05) {
      if ((isBullish && currentColor === 'G') || (!isBullish && currentColor === 'R')) {
        const dir = isBullish ? 'ifG' : 'ifR';
        projections[dir] = {
          target: 'extension_1272',
          confidence: 0.90,
          reason: '🚀 Retroceso mínimo (38.2%) - Tendencia muy fuerte, extensión a 127.2%'
        };
      }
    }
    
    // Nivel 50% - zona de decisión
    else if (Math.abs(level - 0.5) < 0.05) {
      projections.ifG = {
        target: isBullish ? 'retrace_382' : 'retrace_618',
        confidence: 0.60,
        reason: '⚖️ Zona 50% - decisión crítica'
      };
      projections.ifR = {
        target: isBullish ? 'retrace_618' : 'retrace_382',
        confidence: 0.60,
        reason: '⚖️ Zona 50% - decisión crítica'
      };
    }
  }
  
  // Si estamos cerca de un nivel pero no en zona exacta
  else if (nearestLevel && nearestLevel.type === 'retracement') {
    const approachingLevel = nearestLevel.level;
    const distance = Math.abs(currentPos - approachingLevel);
    
    if (distance < 0.1) {
      const dir = isBullish ? 
        (currentColor === 'G' ? 'ifG' : 'ifR') :
        (currentColor === 'R' ? 'ifR' : 'ifG');
      
      projections[dir].reason = `→ Acercándose a ${nearestLevel.label} Fibonacci`;
      projections[dir].confidence = 0.55;
    }
  }
  
  // Extensión: tomar ganancias o buscar más
  if (currentPos > 1.0) {
    const extLevel = currentPos - 1;
    
    if (Math.abs(extLevel - 0.272) < 0.1) { // 127.2%
      projections.ifG = {
        target: 'extend_1618',
        confidence: 0.65,
        reason: '📍 127.2% extensión - posible pausa, buscando 161.8%'
      };
    }
    else if (Math.abs(extLevel - 0.618) < 0.1) { // 161.8%
      projections.ifG = {
        target: null,
        confidence: 0.40,
        reason: '🛑 161.8% extensión - Zona de toma de ganancias mayor'
      };
      projections.ifR = {
        target: 'retrace_100',
        confidence: 0.75,
        reason: '🔄 161.8% alcanzado - Retroceso probable a origen'
      };
    }
  }
  
  return projections;
}

// ═══════════════════════════════════════════════════════════
// CONFLUENCIA FIBONACCI + PATRONES DE VELAS
// ═══════════════════════════════════════════════════════════

function findFibPatternConfluence(levels, currentZone) {
  const confluence = [];
  
  if (!currentZone) return confluence;
  
  const currentIdx = history.length - 1;
  
  // Verificar patrones de reversión en zona Fibonacci clave
  const keyLevels = [0.382, 0.5, 0.618, 0.786];
  const isKeyLevel = keyLevels.some(l => Math.abs(currentZone.level - l) < 0.05);
  
  if (!isKeyLevel) return confluence;
  
  // Verificar Doji/Dragonfly en zona clave
  const currentStr = getCandleStrength(currentIdx) || 2;
  if (currentStr <= 1.5) {
    confluence.push({
      type: 'doji_at_fib',
      strength: 0.85,
      message: `🎯 Doji en ${currentZone.label} - Reversión alta probabilidad`
    });
  }
  
  // Verificar Engulfing en zona clave
  if (currentIdx >= 1) {
    const prevColor = history[currentIdx - 1];
    const currColor = history[currentIdx];
    const prevStr = getCandleStrength(currentIdx - 1) || 2;
    const currStr = getCandleStrength(currentIdx) || 2;
    
    if (prevColor !== currColor && currStr >= 3 && prevStr >= 2) {
      confluence.push({
        type: 'engulfing_at_fib',
        strength: 0.90,
        message: `🔥 Engulfing en ${currentZone.label} - Señal explosiva`
      });
    }
  }
  
  // Verificar Morning/Evening Star contexto
  if (currentIdx >= 2) {
    const v0 = history[currentIdx - 2];
    const v1 = history[currentIdx - 1];
    const v2 = history[currentIdx];
    const s1 = getCandleStrength(currentIdx - 1) || 2;
    
    if (s1 <= 1.5 && v0 !== v2 && v0 === v1) {
      confluence.push({
        type: 'star_at_fib',
        strength: 0.88,
        message: `⭐ Estrella en ${currentZone.label} - Patrón clásico confirmado`
      });
    }
  }
  
  return confluence;
}

// ═══════════════════════════════════════════════════════════
// INTEGRACIÓN CON SISTEMA DE SEÑALES PRINCIPAL
// ═══════════════════════════════════════════════════════════

function getFibonacciSignalModifier() {
  calculateFibonacciLevels();
  
  if (!fibState.active) return null;
  
  const modifier = {
    adjustConfidence: 0,
    adjustSignal: null,
    reason: '',
    priority: 0
  };
  
  // Alta prioridad: confluencia patrón + Fibonacci
  if (fibState.confluence.length > 0) {
    const bestConfluence = fibState.confluence.reduce((a, b) => 
      a.strength > b.strength ? a : b
    );
    
    modifier.adjustConfidence = bestConfluence.strength * 0.15;
    modifier.reason = bestConfluence.message;
    modifier.priority = 4;
  }
  
  // En zona crítica de retroceso
  if (fibState.currentZone) {
    const zone = fibState.currentZone;
    
    // Golden Ratio 61.8% es especial
    if (Math.abs(zone.level - 0.618) < 0.05) {
      modifier.adjustConfidence += 0.10;
      modifier.reason += (modifier.reason ? ' | ' : '') + '🏆 Golden Ratio 61.8%';
      modifier.priority = Math.max(modifier.priority, 5);
    }
    
    // Nivel 50% en conflicto con tendencia
    if (Math.abs(zone.level - 0.5) < 0.05 && fibState.projection) {
      const proj = fibState.projection;
      if (proj.ifG.confidence > 0.7 || proj.ifR.confidence > 0.7) {
        modifier.adjustSignal = proj.ifG.confidence > proj.ifR.confidence ? 'buy' : 'sell';
        modifier.reason += (modifier.reason ? ' | ' : '') + '⚖️ Decisión en 50%';
      }
    }
  }
  
  // Extensión 161.8% - zona de reversión probable
  if (fibState.currentPosition > 1.5) {
    modifier.adjustConfidence -= 0.15; // Reduce confianza en dirección actual
    modifier.reason += (modifier.reason ? ' | ' : '') + '🛑 Extensión 161.8% - Cautela';
    modifier.priority = Math.max(modifier.priority, 3);
  }
  
  return modifier.adjustConfidence !== 0 || modifier.adjustSignal ? modifier : null;
}

// ═══════════════════════════════════════════════════════════
// PANEL VISUAL DE FIBONACCI (para UI)
// ═══════════════════════════════════════════════════════════

function renderFibonacciPanel() {
  const container = document.getElementById('fibonacci-panel');
  if (!container) return;
  
  calculateFibonacciLevels();
  
  if (!fibState.active) {
    // FIX 2: Usar visibility:hidden en vez de display:none para que el panel
    // siempre ocupe su espacio y NO mueva el layout al aparecer/desaparecer
    container.style.visibility = 'hidden';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    return;
  }
  
  // FIX 2: Mostrar con transición suave de opacidad (sin cambio de tamaño)
  container.style.visibility = 'visible';
  container.style.opacity = '1';
  container.style.pointerEvents = '';
  
  // ── SEÑAL PRINCIPAL FIBONACCI (clara y grande) ──────────────────────────
  const proj = fibState.projection;
  const currentZone = fibState.currentZone;
  const dir = fibState.direction;

  // Determinar señal dominante
  let fibSignal = 'ESPERAR', fibSignalColor = '#ffd700', fibSignalBg = 'rgba(255,215,0,0.08)';
  let fibGConf = 50, fibRConf = 50;
  if (proj) {
    fibGConf = Math.round(proj.ifG.confidence * 100);
    fibRConf = Math.round(proj.ifR.confidence * 100);
    const gBuy  = proj.ifG.reason && proj.ifG.confidence > 0.55;
    const rSell = proj.ifR.reason && proj.ifR.confidence > 0.55;
    if (gBuy && fibGConf > fibRConf) {
      fibSignal = '🟢 COMPRAR'; fibSignalColor = '#00ff88'; fibSignalBg = 'rgba(0,255,136,0.07)';
    } else if (rSell && fibRConf > fibGConf) {
      fibSignal = '🔴 VENDER';  fibSignalColor = '#ff4444'; fibSignalBg = 'rgba(255,68,68,0.07)';
    }
  }

  // Zona actual legible
  const zoneLabel = currentZone ? currentZone.label : '—';
  const zoneColor = currentZone ? (
    currentZone.level === 0.618 ? '#ffd700' :
    currentZone.level === 0.382 ? '#00ff88' :
    currentZone.level === 0.5   ? '#ff8800' : '#aaa'
  ) : '#aaa';

  // Confluencias
  const confHtml = fibState.confluence.length > 0
    ? fibState.confluence.map(c => `<div style="color:#ffd700;font-size:0.8em;margin-top:4px;">${c.message}</div>`).join('')
    : '';

  // Proyección si/no legible
  const projRows = proj ? `
    <div style="display:flex;gap:8px;margin-top:10px;">
      <div style="flex:1;background:rgba(0,255,136,0.07);border:1px solid rgba(0,255,136,0.2);border-radius:6px;padding:8px;text-align:center;">
        <div style="color:#00ff88;font-size:1.05em;font-weight:bold;">🟢 Verde</div>
        <div style="color:#00ff88;font-size:1.4em;font-weight:bold;margin:4px 0;">${fibGConf}%</div>
        <div style="color:#666;font-size:0.72em;line-height:1.3;">${proj.ifG.reason || 'Sin target'}</div>
      </div>
      <div style="flex:1;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.2);border-radius:6px;padding:8px;text-align:center;">
        <div style="color:#ff4444;font-size:1.05em;font-weight:bold;">🔴 Roja</div>
        <div style="color:#ff4444;font-size:1.4em;font-weight:bold;margin:4px 0;">${fibRConf}%</div>
        <div style="color:#666;font-size:0.72em;line-height:1.3;">${proj.ifR.reason || 'Sin target'}</div>
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #222;">
      <span style="color:#ffd700;font-weight:bold;font-size:1em;">📐 FIBONACCI</span>
      <span style="color:${dir === 'bullish' ? '#00ff88' : '#ff4444'};font-size:0.85em;">${dir === 'bullish' ? '↗️ ALCISTA' : '↘️ BAJISTA'}</span>
    </div>
    <div style="color:#555;font-size:0.75em;margin-bottom:8px;">
      Zona actual: <span style="color:${zoneColor};font-weight:bold;">${zoneLabel}</span>
      &nbsp;·&nbsp; Swing ${fibState.swingLow + 1}→${fibState.swingHigh + 1}
    </div>
    <div style="background:${fibSignalBg};border:1px solid ${fibSignalColor}44;border-radius:8px;padding:10px;text-align:center;">
      <div style="color:${fibSignalColor};font-size:1.25em;font-weight:bold;">${fibSignal}</div>
      ${currentZone ? `<div style="color:#888;font-size:0.75em;margin-top:2px;">Nivel ${zoneLabel}</div>` : ''}
    </div>
    ${projRows}
    ${confHtml}
  `;
}

// Crear panel de Fibonacci en DOM si no existe
function ensureFibonacciPanel() {
  if (document.getElementById('fibonacci-panel')) return;
  
  const panel = document.createElement('div');
  panel.id = 'fibonacci-panel';
  panel.className = 'fibonacci-panel';
  // FIX 2: min-height reservado + visibility en vez de display:none
  // Así el panel siempre ocupa su espacio y no mueve el layout al aparecer
  panel.style.cssText = `
    background: linear-gradient(135deg, #0a0a0a 0%, #111 100%);
    border: 1px solid #333;
    border-radius: 8px;
    padding: 12px;
    margin: 10px 0;
    font-family: monospace;
    font-size: 0.85em;
    min-height: 80px;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;
  
  // Insertar después del momentum-box o en un lugar lógico
  const ref = document.getElementById('momentum-box') || 
              document.getElementById('trend-box');
  if (ref && ref.parentNode) {
    ref.parentNode.insertBefore(panel, ref.nextSibling);
  }
}

// ═══════════════════════════════════════════════════════════
// ESTILOS CSS PARA FIBONACCI (inyectar dinámicamente)
// ═══════════════════════════════════════════════════════════

function injectFibonacciStyles() {
  if (document.getElementById('fibonacci-styles')) return;
  
  const styles = document.createElement('style');
  styles.id = 'fibonacci-styles';
  styles.textContent = `
    .fibonacci-panel {
      color: #ccc;
    }
    .fib-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    }
    .fib-title {
      color: #ffd700;
      font-weight: bold;
      font-size: 1.1em;
    }
    .fib-direction.bullish {
      color: #00ff88;
    }
    .fib-direction.bearish {
      color: #ff4444;
    }
    .fib-swings {
      font-size: 0.8em;
      color: #888;
      margin-bottom: 10px;
    }
    .fib-levels {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .fib-level {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 6px;
      border-radius: 3px;
      transition: background 0.2s;
    }
    .fib-level.current {
      background: rgba(255, 215, 0, 0.15);
      border-left: 3px solid #ffd700;
    }
    .fib-level.passed {
      opacity: 0.5;
    }
    .fib-label {
      width: 45px;
      text-align: right;
      font-size: 0.85em;
      color: #aaa;
    }
    .fib-bar-container {
      flex: 1;
      height: 6px;
      background: #222;
      border-radius: 3px;
      overflow: hidden;
    }
    .fib-bar {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .fib-status {
      width: 50px;
      font-size: 0.75em;
      color: #ffd700;
    }
    .fib-projection {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid #333;
      font-size: 0.85em;
    }
    .fib-proj-g {
      color: #00ff88;
      margin: 4px 0;
    }
    .fib-proj-r {
      color: #ff4444;
      margin: 4px 0;
    }
    .fib-confluence {
      margin-top: 10px;
      padding: 8px;
      background: rgba(255, 215, 0, 0.08);
      border-radius: 4px;
      border-left: 3px solid #ffd700;
    }
    .fib-conf-item {
      margin: 4px 0;
      padding: 4px;
      font-size: 0.9em;
      color: #ffd700;
    }
    .fib-inactive {
      color: #555;
      text-align: center;
      padding: 20px;
    }

    /* ══════════════════════════════════════════════════════
       FIX 2: Alerta Trampa — sin layout shift
       Reservamos la altura siempre con min-height, usamos
       opacity + pointer-events en lugar de max-height para
       que el contenedor NO empuje elementos al aparecer.
       ══════════════════════════════════════════════════════ */
    #candle-trap-alert {
      min-height: 0 !important;
      max-height: none !important;
      overflow: hidden !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      padding: 0 !important;
      margin: 0 !important;
      transition: opacity 0.25s ease, visibility 0.25s ease !important;
    }
    #candle-trap-alert.active {
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      padding: revert !important;
      margin: revert !important;
    }
  `;
  
  document.head.appendChild(styles);
}

// ═══════════════════════════════════════════════════════════
// INTEGRACIÓN CON UPDATE() PRINCIPAL
// ═══════════════════════════════════════════════════════════

// Guardar referencia original
const _originalUpdate = update;

// Reemplazar update con versión que incluye Fibonacci
update = function() {
  // Llamar update original primero
  try { _originalUpdate.apply(this, arguments); } catch(e) { console.error('[update/core]', e); }
  
  // Actualizar Fibonacci (no puede romper la señal principal)
  try {
    ensureFibonacciPanel();
    injectFibonacciStyles();
    renderFibonacciPanel();
    const fibModifier = getFibonacciSignalModifier();
    if (fibModifier && fibModifier.priority >= 3) {
      applyFibonacciToSignal(fibModifier);
    }
  } catch(e) { console.error('[update/fibonacci]', e); }
};

function applyFibonacciToSignal(modifier) {
  const mainSignal = document.getElementById('main-signal');
  const logicText = document.getElementById('logic-text');
  
  if (!mainSignal || !modifier.reason) return;
  // No modificar la señal si hay un extremo activo (P0 tiene prioridad absoluta)
  if (mainSignal.className.includes('signal-extreme')) return;
  // No modificar si hay manipulación o trampa activa
  if (mainSignal.className.includes('signal-manipulation') || mainSignal.className.includes('signal-trap')) return;
  
  // Añadir indicador visual de Fibonacci
  const existingBadge = mainSignal.querySelector('.fib-badge');
  if (!existingBadge && modifier.adjustConfidence > 0.05) {
    const badge = document.createElement('div');
    badge.className = 'fib-badge';
    badge.style.cssText = `
      background: linear-gradient(135deg, #ffd700 0%, #ff8800 100%);
      color: #000;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7em;
      font-weight: bold;
      margin-top: 4px;
    `;
    badge.textContent = '📐 FIB ' + (modifier.adjustConfidence > 0.1 ? '++' : '+');
    mainSignal.appendChild(badge);
  }
  
  // Añadir razón al texto de lógica
  if (logicText && modifier.reason && !logicText.textContent.includes('Fibonacci')) {
    logicText.textContent += ' | ' + modifier.reason;
  }
}

console.log('📐 Sistema Fibonacci cargado:', FIBONACCI_CONFIG.RETRACEMENT_LEVELS.length, 'niveles de retroceso,', 
            FIBONACCI_CONFIG.EXTENSION_LEVELS.length, 'extensiones');
            
// ======================================================= NUEVA CONFIGURACIÓN =============================================================================

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
  distribution: { topThreshold: 70, volumePattern: 'climax', divergencePeriods: 5, weaknessSignals: 3 },
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

// Rastreador de cruce MA — guarda en qué longitud del historial se detectó el último cruce
// Un cruce solo es válido en la misma vela en que se detectó (1 vela de vida)
let lastCrossDetectedAtLength = -1;
let lastCrossSnapshot = null; // { pair, crossType, trap, trapReason }

// ── Estado de vigilancia dinámica de reversión ──
// Cuando el sistema detecta posible reversión, guarda el estado aquí.
// La siguiente vez que se registre una vela, update() lo evalúa automáticamente.
var reversalWatch = null;
// Estructura: {
//   direction: 'bullish' | 'bearish',  ← dirección de la reversión esperada
//   confirmColor: 'G' | 'R',           ← color que CONFIRMA la reversión
//   cancelColor:  'R' | 'G',           ← color que CANCELA y vuelve al original
//   confirmConf: 85,                    ← confianza de confirmación (%)
//   cancelConf:  75,                    ← confianza si cancela (%)
//   candleIndex: 5,                     ← índice de la vela en que se detectó
//   detectedAt: Date.now()
// }

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
  update();
  broadcastEdit(); // SYNC FIX: after update() so monitor gets fresh signal
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
  if (capDirStr.length === 0) return { detected: false }; // FIX: guard against division by zero
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
    if (current === 'G' && trendMA <= 15) { prob += 0.15; reasons.push(`MA10 en sobreventa (${trendMA != null ? trendMA.toFixed(0) : "?"}%) — posible spring falso`); }
    if (current === 'R' && trendMA >= 85) { prob += 0.15; reasons.push(`MA10 en sobrecompra (${trendMA != null ? trendMA.toFixed(0) : "?"}%) — posible upthrust falso`); }
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
  // ── UMBRALES REALES DE EXTREMO ──────────────────────────────────────────
  // Un "extremo" debe ser realmente extremo. Definimos los umbrales así:
  //   extreme_bullish: MA10 >= 75  (antes era 65 — demasiado sensible)
  //   extreme_bearish: MA10 <= 25  (antes era 35 — demasiado sensible)
  // Wyckoff y Exhaustion también se validan con estos umbrales para evitar
  // falsos extremos en zonas neutras (ej. MA10 = 60%).
  const REAL_EXTREME_BULL = 75;
  const REAL_EXTREME_BEAR = 25;
  const REAL_WARNING_BULL = 80;
  const REAL_WARNING_BEAR = 20;

  const ma = trendMA !== null ? trendMA : 50;

  // ── AGOTAMIENTO (Exhaustion) ─────────────────────────────────────────────
  // Solo aplica si MA10 está realmente en zona extrema, no en zona neutral.
  const exhaustion = _detectExhaustion();
  if (exhaustion.detected) {
    if (exhaustion.direction === 'bearish') {
      // Agotamiento bajista solo vale en zona de sobreventa real
      if (ma <= REAL_EXTREME_BEAR) return { type: 'extreme_bearish', level: trendMA, message: `AGOTAMIENTO BAJISTA: ${exhaustion.reason}. Alta probabilidad de reversión alcista.`, action: 'wait_buy', confidence: 0.75 };
      if (ma <= 40) return { type: 'warning_bearish', level: trendMA, message: `PAUSA BAJISTA: ${exhaustion.reason}. Posible rebote técnico (MA10 ${ma.toFixed(0)}%).`, action: 'caution', confidence: 0.55 };
      // MA10 > 40%: el "agotamiento bajista" ocurre en zona alcista — no es extremo, ignorar
    } else {
      // Agotamiento alcista solo vale en zona de sobrecompra real
      if (ma >= REAL_EXTREME_BULL) return { type: 'extreme_bullish', level: trendMA, message: `AGOTAMIENTO ALCISTA: ${exhaustion.reason}. Alta probabilidad de reversión bajista.`, action: 'wait_sell', confidence: 0.75 };
      if (ma >= 60) return { type: 'warning_bullish', level: trendMA, message: `PAUSA ALCISTA: ${exhaustion.reason}. Posible corrección técnica (MA10 ${ma.toFixed(0)}%).`, action: 'caution', confidence: 0.55 };
      // MA10 < 60%: el "agotamiento alcista" ocurre en zona neutral/bajista — no es extremo, ignorar
    }
  }

  // ── SOBREEXTENSIÓN (pocos datos) ─────────────────────────────────────────
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

  // ── WYCKOFF ──────────────────────────────────────────────────────────────
  // Wyckoff detecta estructuras de distribución/acumulación, pero SOLO es un
  // "extremo accionable" si la MA10 también está en zona compatible.
  // Distribución Wyckoff → extreme_bullish → solo si MA10 >= 65 (ya en zona alta)
  // Acumulación Wyckoff  → extreme_bearish → solo si MA10 <= 35 (ya en zona baja)
  // Si Wyckoff detecta pero MA10 está en zona neutral, devolver warning, no extremo.
  const wyckoff = _detectWyckoff();
  if (wyckoff.detected) {
    if (wyckoff.type === 'accumulation') {
      if (ma <= 40) return { type: 'extreme_bearish', level: trendMA, message: `ACUMULACIÓN WYCKOFF: SC(fuerza ${wyckoff.scStr}🔥) → rebote débil → ST(fuerza ${wyckoff.stStr}). Reversión alcista probable.`, action: 'wait_buy', confidence: wyckoff.confidence };
      // MA10 > 40% con patrón de acumulación: señal débil, no extremo
      return { type: 'warning_bearish', level: trendMA, message: `POSIBLE ACUMULACIÓN WYCKOFF (MA10 ${ma.toFixed(0)}% — zona neutral). Vigilar confirmación.`, action: 'caution', confidence: 0.45 };
    } else {
      // Distribución Wyckoff
      if (ma >= 65) return { type: 'extreme_bullish', level: trendMA, message: `DISTRIBUCIÓN WYCKOFF: BC(fuerza ${wyckoff.scStr}🔥) → rebote débil → UT(fuerza ${wyckoff.stStr}). Reversión bajista probable.`, action: 'wait_sell', confidence: wyckoff.confidence };
      // MA10 < 65% con patrón de distribución: señal débil, solo warning
      return { type: 'warning_bullish', level: trendMA, message: `POSIBLE DISTRIBUCIÓN WYCKOFF (MA10 ${ma.toFixed(0)}% — zona neutral/baja). Vigilar confirmación.`, action: 'caution', confidence: 0.45 };
    }
  }

  if (trendMA === null) return null;

  // ── EXTREMOS POR MA10 + MOMENTUM ─────────────────────────────────────────
  // Umbrales corregidos: overbought=90, oversold=10 (del EXTREME_THRESHOLDS config)
  // pero también por momentum extremo con MA10 >= 75 / <= 25
  const isExtrBull = trendMA >= EXTREME_THRESHOLDS.overbought && recentTrend.strength >= 4 && recentTrend.trend === 'bullish';
  const isExtrBear = trendMA <= EXTREME_THRESHOLDS.oversold   && recentTrend.strength >= 4 && recentTrend.trend === 'bearish';
  const momBull    = recentTrend.isExtreme && recentTrend.trend === 'bullish' && trendMA >= REAL_EXTREME_BULL;
  const momBear    = recentTrend.isExtreme && recentTrend.trend === 'bearish' && trendMA <= REAL_EXTREME_BEAR;

  if (isExtrBull || momBull) {
    const src = momBull && !isExtrBull ? `momentum extremo (${recentTrend.strength} verdes fuertes)` : `MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}%`;
    return { type: 'extreme_bullish', level: trendMA, message: `SOBRECOMPRA EXTREMA: ${src} con ${recentTrend.strength} velas verdes seguidas. Reversión bajista inminente.`, action: 'wait_sell', confidence: 0.85 };
  }
  if (isExtrBear || momBear) {
    const src = momBear && !isExtrBear ? `momentum extremo (${recentTrend.strength} rojas fuertes)` : `MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}%`;
    return { type: 'extreme_bearish', level: trendMA, message: `SOBREVENTA EXTREMA: ${src} con ${recentTrend.strength} velas rojas seguidas. Reversión alcista inminente.`, action: 'wait_buy', confidence: 0.85 };
  }
  if (trendMA >= REAL_WARNING_BULL && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) return { type: 'warning_bullish', level: trendMA, message: `Sobrecompra: MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}%. Precaución con compras.`, action: 'caution', confidence: 0.60 };
  if (trendMA <= REAL_WARNING_BEAR && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) return { type: 'warning_bearish', level: trendMA, message: `Sobreventa: MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}%. Oportunidad de compra cercana.`, action: 'caution', confidence: 0.60 };
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
  return { probability: Math.min(prob, 0.95), details: { isHighLevel, divergence, weakness, pattern, greenCount, redStrength }, description: pattern ? `🏦 DISTRIBUCIÓN: ${greenCount} verdes débiles → rojas fuertes` : isHighLevel && divergence.detected ? `📉 Divergencia bajista en nivel alto (${trendMA != null ? trendMA.toFixed(0) : "?"}%)` : weakness >= 2 ? `⚠️ ${weakness} señales de debilidad` : 'Sin distribución clara' };
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
  return { probability: Math.min(prob, 0.95), details: { isLowLevel, divergence, spring, absorption, redCount, greenStr }, description: spring.detected ? `🌱 SPRING detectado: Falso quiebre con recuperación` : absorption ? `📥 ACUMULACIÓN: ${redCount} rojas débiles → verdes fuertes` : isLowLevel && divergence.detected ? `📈 Divergencia alcista en nivel bajo (${trendMA != null ? trendMA.toFixed(0) : "?"}%)` : 'Sin acumulación clara' };
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

  // Tendencia reciente fuerte en contra del cruce → trampa
  if (crossType === 'golden' && recentTrend.trend === 'bearish' && recentTrend.strength >= 3) return true;
  if (crossType === 'death'  && recentTrend.trend === 'bullish' && recentTrend.strength >= 3) return true;

  // MA10 en territorio contrario al cruce → trampa
  // Death Cross con MA10 > 55% (alcista) es trampa — bajamos de 65 a 55
  // Golden Cross con MA10 < 45% (bajista) es trampa — subimos de 35 a 45
  if (crossType === 'golden' && trendMA < 45) return true;
  if (crossType === 'death'  && trendMA > 55) return true;

  const cm = getCrossCreatorMetrics(crossType, fastPeriod);
  if (cm.allWeak) return true;
  if (cm.forceRatio > 1.8 && !cm.anyStrong) return true;
  if (cm.recentCapitulation && cm.avgStr < 2.5) return true;
  if (crossType === 'golden' && recentTrend.weightedScore < -0.5 && cm.avgStr < 2) return true;
  if (crossType === 'death'  && recentTrend.weightedScore > 0.5  && cm.avgStr < 2) return true;

  // NUEVO: Consolidación + manipulación activa → cruce es trampa institucional
  if (cmdState && cmdState.phase === 'consolidation' && cmdState.probability > 0.7) return true;
  if (cmdState && cmdState.phase === 'manipulation'  && cmdState.probability > 0.6) return true;

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
          // FIX 1: Registrar cruce nuevo con longitud actual del historial
          if (lastCrossDetectedAtLength !== history.length) {
            lastCrossDetectedAtLength = history.length;
            lastCrossSnapshot = { pair: cfg.name, crossType: 'golden', trap, trapReason };
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
          // FIX 1: Registrar cruce nuevo con longitud actual del historial
          if (lastCrossDetectedAtLength !== history.length) {
            lastCrossDetectedAtLength = history.length;
            lastCrossSnapshot = { pair: cfg.name, crossType: 'death', trap, trapReason };
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

// ===== ANÁLISIS DE PATRONES DINÁMICO CON PRIORIDAD =====
// Evalúa TODOS los patrones y selecciona el mejor según confianza

function analyzePattern(lastTwo, originalTwo = null, extremeCondition = null) {
  if (history.length < 2) return null;
  
  const idx = history.length - 1;
  const em = extremeCondition ? 0.3 : 1; // Penalizador si hay condición extrema
  
  // Evaluar todos los patrones del library
  const candidates = [];
  
  Object.entries(PATTERN_LIBRARY).forEach(([key, pattern]) => {
    // Verificar si tenemos suficientes velas
    if (history.length < pattern.minVelas) return;
    
    // Ejecutar detector
    const detection = pattern.detect(history, idx);
    if (!detection) return; // Patrón no detectado en contexto actual
    
    // Calcular confianza ajustada
    const baseConfidence = detection.strength * em;
    
    // Obtener proyecciones
    const projections = pattern.project(baseConfidence);
    
    candidates.push({
      key,
      name: pattern.name,
      priority: pattern.priority,
      confidence: baseConfidence,
      context: detection.context,
      projections,
      // Score combinado: prioridad domina sobre confianza.
      // Prioridad 5 > Prioridad 4 > ... > Prioridad 0 siempre.
      // Dentro de la misma prioridad, gana la confianza.
      score: (pattern.priority * 2.0) + baseConfidence
    });
  });
  
  // Separar patrones reales de fallbacks (priority 0 = simple-reversal / simple-continuation)
  const realCandidates = candidates.filter(c => c.priority > 0);
  const fallbackCandidates = candidates.filter(c => c.priority === 0);

  // Si no hay patrones reales, intentar con Classic primero, luego fallback simple
  if (realCandidates.length === 0) {
    const classic = analyzePatternClassic(lastTwo, extremeCondition);
    if (classic) return classic;
    if (fallbackCandidates.length === 0) return null;
    fallbackCandidates.sort((a, b) => b.score - a.score);
    const fbWinner = fallbackCandidates[0];
    const fbPat = lastTwo.join(''); // secuencia pura G/R del slice pasado
    return {
      patternName: fbWinner.name,
      patternKey: fbWinner.key,
      confidence: fbWinner.confidence,
      context: fbWinner.context,
      allCandidates: fallbackCandidates,
      ifG: { ...fbWinner.projections.ifG, pat: fbPat + 'G', originalConf: fbWinner.projections.ifG.conf },
      ifR: { ...fbWinner.projections.ifR, pat: fbPat + 'R', originalConf: fbWinner.projections.ifR.conf }
    };
  }

  // ORDENAR POR SCORE los patrones reales (prioridad domina sobre confianza)
  realCandidates.sort((a, b) => b.score - a.score);

  // Seleccionar el MEJOR patrón real
  const winner = realCandidates[0];
  const winPat = lastTwo.join(''); // secuencia pura G/R del slice pasado
  
  // Log de competencia (para debugging, opcional)
  console.log('🏆 Patrón ganador:', winner.name, '| P'+winner.priority, '| Confianza:', (winner.confidence*100).toFixed(1)+'%');
  if (realCandidates.length > 1) {
    console.log('   Competidores:', realCandidates.slice(1,3).map(c => `${c.name}(P${c.priority},${(c.confidence*100).toFixed(0)}%)`).join(', '));
  }
  
  // Retornar en formato compatible con tu sistema actual
  return {
    // Información del patrón detectado
    patternName: winner.name,
    patternKey: winner.key,
    confidence: winner.confidence,
    context: winner.context,
    allCandidates: realCandidates, // Solo patrones reales para lista de candidatos
    
    // Proyecciones estándar
    ifG: {
      ...winner.projections.ifG,
      pat: winPat + 'G',
      originalConf: winner.projections.ifG.conf
    },
    ifR: {
      ...winner.projections.ifR,
      pat: winPat + 'R',
      originalConf: winner.projections.ifR.conf
    }
  };
}

// ===== Fallback: Tablas clásicas originales (cuando no hay patrón especial) =====
function analyzePatternClassic(lastTwo, extremeCondition) {
  const em = extremeCondition ? 0.3 : 1;
  const hasThree = lastTwo.length >= 3;
  
  // Tus tablas originales de 3 velas
  const scenarios3 = {
    'GGG': { 
      ifG: { pat: 'GGGG', sig: 'COMPRA', conf: 0.65 * em, desc: 'Continuación alcista (3 verdes)' }, 
      ifR: { pat: 'GGGR', sig: 'VENTA', conf: 0.82, desc: 'Reversión tras 3 verdes — muy probable' } 
    },
    'RRR': { 
      ifG: { pat: 'RRRG', sig: 'COMPRA', conf: 0.82, desc: 'Reversión tras 3 rojas — muy probable' }, 
      ifR: { pat: 'RRRR', sig: 'VENTA', conf: 0.65 * em, desc: 'Continuación bajista (3 rojas)' } 
    },
    'GGR': { 
      ifG: { pat: 'GGRG', sig: 'COMPRA', conf: 0.60 * em, desc: 'Rebote tras corrección' }, 
      ifR: { pat: 'GGRR', sig: 'VENTA', conf: 0.78, desc: 'Confirmación bajista fuerte' } 
    },
    'RRG': { 
      ifG: { pat: 'RRGG', sig: 'COMPRA', conf: 0.78, desc: 'Confirmación alcista fuerte' }, 
      ifR: { pat: 'RRGR', sig: 'VENTA', conf: 0.60 * em, desc: 'Rebote fallido — continúa baja' } 
    },
    'GRG': { 
      ifG: { pat: 'GRGG', sig: 'COMPRA', conf: 0.68, desc: 'Doble suelo — impulso alcista' }, 
      ifR: { pat: 'GRGR', sig: 'ESPERAR', conf: 0.50, desc: 'Alternancia — sin dirección clara' } 
    },
    'RGR': { 
      ifG: { pat: 'RGRG', sig: 'ESPERAR', conf: 0.50, desc: 'Alternancia — sin dirección clara' }, 
      ifR: { pat: 'RGRR', sig: 'VENTA', conf: 0.68, desc: 'Doble techo — impulso bajista' } 
    },
    'GRR': { 
      ifG: { pat: 'GRRG', sig: 'COMPRA', conf: 0.72, desc: 'Rebote desde soporte' }, 
      ifR: { pat: 'GRRR', sig: 'VENTA', conf: 0.70 * em, desc: 'Continuación bajista post-reversión' } 
    },
    'RGG': { 
      ifG: { pat: 'RGGG', sig: 'COMPRA', conf: 0.70 * em, desc: 'Continuación alcista post-reversión' }, 
      ifR: { pat: 'RGGR', sig: 'VENTA', conf: 0.72, desc: 'Trampa alcista — atención' } 
    },
  };

  // Tus tablas originales de 2 velas
  const scenarios2 = {
    'GG': { 
      ifG: { pat: 'GGG', sig: 'COMPRA', conf: 0.70 * em, desc: 'Continuación alcista' }, 
      ifR: { pat: 'GGR', sig: 'VENTA', conf: 0.85, desc: 'Reversión bajista FUERTE' } 
    },
    'RR': { 
      ifG: { pat: 'RRG', sig: 'COMPRA', conf: 0.85, desc: 'Reversión alcista FUERTE' }, 
      ifR: { pat: 'RRR', sig: 'VENTA', conf: 0.70 * em, desc: 'Continuación bajista' } 
    },
    'GR': { 
      ifG: { pat: 'GRG', sig: 'COMPRA', conf: 0.55 * em, desc: 'Reversión alcista' }, 
      ifR: { pat: 'GRR', sig: 'VENTA', conf: 0.65, desc: 'Confirmación bajista' } 
    },
    'RG': { 
      ifG: { pat: 'RGG', sig: 'COMPRA', conf: 0.65, desc: 'Confirmación alcista' }, 
      ifR: { pat: 'RGR', sig: 'VENTA', conf: 0.55 * em, desc: 'Reversión bajista' } 
    }
  };

  const prev2 = hasThree ? lastTwo[lastTwo.length - 3] : null;
  const prev = lastTwo[lastTwo.length - 2];
  const curr = lastTwo[lastTwo.length - 1];
  const key3 = hasThree ? (prev2 + prev + curr) : null;
  const key2 = prev + curr;

  const result = scenarios3[key3] || scenarios2[key2] || null;
  
  if (!result) return null;
  
  return {
    patternName: 'Patrón Clásico',
    patternKey: 'classic',
    confidence: 0.60,
    context: key3 || key2,
    ...result
  };
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

  resetConfirmationPanel();

  if (history.length > 500) {
    if (manualTrapIndex !== null) {
      manualTrapIndex = manualTrapIndex === 0 ? null : manualTrapIndex - 1;
    }
    const newStr = {};
    for (let i = 0; i < history.length; i++) { if (manualStrengths[i]) newStr[i - 1] = manualStrengths[i]; }
    manualStrengths = newStr;
    history.shift();
  }
  update();
  broadcastEdit(); // SYNC FIX: llamar DESPUES de update() para enviar señal actualizada al monitor
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
    document.getElementById('momentum-detail').textContent = `MA10: ${trendMA != null ? trendMA.toFixed(1) : "?"}% (${diff > 0 ? '+' : ''}${diff}%) | Fuerza sugerida: ${autoSuggestedStrength}/4`;
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
  // FIX 1: El cruce solo se muestra en la vela donde ocurrió (lastCrossDetectedAtLength === history.length)
  // En la siguiente vela, la alerta desaparece automáticamente aunque las MAs sigan cruzadas.
  const crossIsFresh = lastCrossDetectedAtLength === history.length;
  if (activeCross && crossIsFresh && !extremeCondition) {
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
  const lastTwo = effectiveHistory.slice(-3);
  const proj    = lastTwo.length >= 2 ? analyzePattern(lastTwo, null, extremeCondition) : null;

  let finalSignal = 'wait', signalClass = 'signal-wait', signalText = 'ESPERAR';
  let showReversal = false, showExtreme = false, showCMD = false, logicText = '';

  // ── EVALUACIÓN DINÁMICA DE REVERSIÓN VIGILADA ────────────────────────────
  if (reversalWatch !== null) {
    const watchIdx   = reversalWatch.candleIndex;
    const latestIdx  = history.length - 1;
    if (latestIdx > watchIdx && latestIdx === watchIdx + 1) {
      const newCandle = history[latestIdx];
      const newStr    = getCandleStrength(latestIdx) || 2;
      if (newCandle === reversalWatch.confirmColor) {
        const dir = reversalWatch.direction;
        finalSignal  = dir === 'bullish' ? 'buy'  : 'sell';
        signalClass  = dir === 'bullish' ? 'signal-buy' : 'signal-sell';
        signalText   = dir === 'bullish' ? '✅ COMPRAR — REVERSIÓN CONFIRMADA' : '✅ VENDER — REVERSIÓN CONFIRMADA';
        logicText    = `🎯 Reversión ${dir === 'bullish' ? 'alcista' : 'bajista'} confirmada. ` +
                       `Proyección ${reversalWatch.confirmConf}% se cumplió con vela ${newCandle === 'G' ? 'verde' : 'roja'} F${newStr}.`;
        showReversal = true;
        reversalWatch = null;
      } else if (newCandle === reversalWatch.cancelColor) {
        const dir = reversalWatch.direction;
        const contDir = dir === 'bullish' ? 'bearish' : 'bullish';
        finalSignal  = contDir === 'bullish' ? 'buy'  : 'sell';
        signalClass  = contDir === 'bullish' ? 'signal-buy-weak' : 'signal-sell-weak';
        signalText   = contDir === 'bullish' ? '⬆️ COMPRAR — REVERSIÓN CANCELADA' : '⬇️ VENDER — REVERSIÓN CANCELADA';
        logicText    = `↩️ Reversión ${dir === 'bullish' ? 'alcista' : 'bajista'} cancelada. ` +
                       `Vela ${newCandle === 'G' ? 'verde' : 'roja'} F${newStr} confirma continuación ${contDir === 'bullish' ? 'alcista' : 'bajista'}.`;
        reversalWatch = null;
      }
    } else if (latestIdx > watchIdx + 1) {
      reversalWatch = null;
    }
  }

  // ── GUARD: sin datos suficientes ───────────────────────────────────────
  var _sinDatos      = history.length < 3;
  var _datosLimitados = history.length >= 3 && history.length < 10;

  // PRIORIDAD 0: EXTREMO
  if (extremeCondition && (extremeCondition.type === 'extreme_bullish' || extremeCondition.type === 'extreme_bearish')) {
    showExtreme = true;
    if (extremeCondition.type === 'extreme_bullish') {
      const tc = _detectCandleTrap();
      const hasConflict = tc && tc.type === 'bull-trap' && tc.probability >= 0.75;

      // FIX: Contar cuántas velas VERDES consecutivas precedían a esta roja.
      // Si hay 3+ verdes previas con buena fuerza promedio, esta primera roja puede ser
      // simplemente la primera caída tras un impulso — NO una reversión confirmada.
      // Solo marcar VENDER EXTREMO cuando la roja rompe una tendencia ya agotada
      // (pocas verdes previas, o verdes débiles) o cuando tiene fuerza 4 (capitulación).
      let prevGreensBeforeRed = 0;
      let prevGreensTotalStr = 0;
      if (currentCandle.current === 'R') {
        for (let i = history.length - 2; i >= 0 && history[i] === 'G'; i--) {
          prevGreensBeforeRed++;
          prevGreensTotalStr += getCandleStrength(i) || 2;
        }
      }
      const avgPrevGreenStr = prevGreensBeforeRed > 0 ? prevGreensTotalStr / prevGreensBeforeRed : 0;
      // Considerar que es "impulso reciente aún vivo" si hay 3+ verdes previas con fuerza media >= 2
      // Y la roja actual NO es capitulación (fuerza 4)
      const isFirstRedAfterBullRun = prevGreensBeforeRed >= 3 &&
                                     avgPrevGreenStr >= 2.0 &&
                                     currentCandle.strength < 4;
      // Con 2 verdes previas y roja débil, también esperar confirmación
      const isWeakFirstRed = prevGreensBeforeRed >= 2 && currentCandle.strength <= 2;

      if (currentCandle.current === 'R' && currentCandle.strength >= 2 && !hasConflict) {
        if (isFirstRedAfterBullRun || isWeakFirstRed) {
          // Primera roja tras impulso alcista: esperar segunda roja o roja fuerte
          finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '⏸️ ESPERAR';
          logicText = `⚠️ Extremo alcista (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) pero hay ${prevGreensBeforeRed} verde(s) previa(s) ` +
                      `(F prom ${avgPrevGreenStr.toFixed(1)}). La roja F${currentCandle.strength} es la PRIMERA tras el impulso. ` +
                      `Esperar segunda roja F2+ o roja F3+ para confirmar reversión.`;
        } else {
          finalSignal = 'sell'; signalClass = 'signal-extreme'; signalText = '🔻 VENDER EXTREMO';
          logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : "?"  }%) + reversión bajista confirmada (fuerza ${currentCandle.strength}).` +
                      (prevGreensBeforeRed > 0 ? ` Solo ${prevGreensBeforeRed} verde(s) previa(s) — impulso agotado.` : '');
        }
      } else if (hasConflict) {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Conflicto: Agotamiento alcista vs Bull Trap ${Math.round(tc.probability*100)}%. Esperar vela roja fuerte.`;
      } else {
        finalSignal = 'wait'; signalClass = 'signal-extreme'; signalText = '🚫 NO COMPRAR - EXTREMO';
        logicText = `🚨 SOBRECOMPRA EXTREMA (${trendMA !== null ? trendMA.toFixed(0) : "?"  }%). Cualquier compra es TRAMPA.`;
      }
    } else {
      const tc = _detectCandleTrap();
      const hasConflict = tc && tc.type === 'bear-trap' && tc.probability >= 0.75;

      // FIX SIMÉTRICO: igual lógica para extremo bajista — la primera verde tras rojas
      // puede ser un rebote débil (Bear Trap), no una reversión real.
      let prevRedsBeforeGreen = 0;
      let prevRedsTotalStr = 0;
      if (currentCandle.current === 'G') {
        for (let i = history.length - 2; i >= 0 && history[i] === 'R'; i--) {
          prevRedsBeforeGreen++;
          prevRedsTotalStr += getCandleStrength(i) || 2;
        }
      }
      const avgPrevRedStr = prevRedsBeforeGreen > 0 ? prevRedsTotalStr / prevRedsBeforeGreen : 0;
      const isFirstGreenAfterBearRun = prevRedsBeforeGreen >= 3 &&
                                       avgPrevRedStr >= 2.0 &&
                                       currentCandle.strength < 4;
      const isWeakFirstGreen = prevRedsBeforeGreen >= 2 && currentCandle.strength <= 2;

      if (currentCandle.current === 'G' && currentCandle.strength >= 2 && !hasConflict) {
        if (isFirstGreenAfterBearRun || isWeakFirstGreen) {
          finalSignal = 'wait'; signalClass = 'signal-buy-weak'; signalText = '⏸️ ESPERAR REBOTE';
          logicText = `⚠️ Sobreventa (${trendMA !== null ? trendMA.toFixed(0) : '?'}%) pero hay ${prevRedsBeforeGreen} roja(s) previa(s) ` +
                      `(F prom ${avgPrevRedStr.toFixed(1)}). Verde F${currentCandle.strength} es PRIMERA tras la caída. ` +
                      `Esperar segunda verde F2+ o verde F3+ para confirmar reversión.`;
        } else if (currentCandle.strength >= 2.5) {
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
    // FIX 2: Consolidacion — bloquea solo patrones debiles (<65%), deja pasar los fuertes
    if (cmdState.phase === 'consolidation' && cmdState.probability > 0.65 && finalSignal === 'wait') {
      const _consPatConf = proj ? Math.max(proj.ifG.conf, proj.ifR.conf) : 0;
      if (_consPatConf < 0.65) {
        showCMD = true;
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '📦 CONSOLIDACIÓN';
        logicText = `📦 CONSOLIDACIÓN (${Math.round(cmdState.probability*100)}%). Rango estrecho — patrón ${Math.round(_consPatConf*100)}% insuficiente. Esperar ruptura clara.`;
      }
    }

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
      // FIX 1: Solo bloquear si CMD supera en al menos 15pp la confianza del patrón activo
      const _manipPatConf = proj ? Math.max(proj.ifG.conf, proj.ifR.conf) : 0;
      const _manipMargin  = cmdState.probability - _manipPatConf;
      if (_manipMargin >= 0.15 || _manipPatConf < 0.70) {
        showCMD = true;
        finalSignal = 'wait'; signalClass = 'signal-manipulation'; signalText = '🎭 ESPERAR';
        logicText = `🎭 MANIPULACIÓN (${Math.round(cmdState.probability*100)}%) bloquea señal${_manipPatConf > 0 ? ' · patrón ' + Math.round(_manipPatConf*100) + '% insuficiente vs CMD' : ''}. NO operar.`;
      }
      // Si el patrón es muy fuerte (≥85%) y CMD no tiene margen suficiente,
      // dejar caer a Prioridad 3 sin bloquear — showCMD queda false

    // ═══════════════════════════════════════════════════════════════════════
    // PRIORIDAD 3: REVERSIÓN FUERTE (CON CONTEXTO DE 3+ VELAS PREVIAS)
    // ═══════════════════════════════════════════════════════════════════════
    } else if (currentCandle.isReversal && currentCandle.strength >= 3) {
      showReversal = true;
      
      if (currentCandle.current === 'G') {
        // Análisis detallado de rojas previas
        let prevReds = 0;
        let weakReds = 0;        // Fuerza < 2
        let strongReds = 0;      // Fuerza >= 3
        let totalRedStrength = 0;
        let redStrengths = [];   // Para logging/debug
        
        for (let i = history.length - 2; i >= 0 && history[i] === 'R'; i--) {
          prevReds++;
          const s = getCandleStrength(i) || 2;
          redStrengths.push(s);
          totalRedStrength += s;
          if (s < 2) weakReds++;
          if (s >= 3) strongReds++;
        }
        
        const avgRedStrength = prevReds > 0 ? totalRedStrength / prevReds : 0;
        
        // CRITERIOS DE BEAR TRAP:
        // 1. 4+ rojas con 2+ débiles (debilitamiento claro)
        // 2. 4+ rojas con promedio < 2.5 (fuerza decayente)
        // 3. 3+ rojas con últimas 2 débiles y vela actual no es capitulación (fuerza < 4)
        const isBearTrapPattern = prevReds >= 4 && (weakReds >= 2 || avgRedStrength < 2.5);
        const isEarlyReversal = prevReds >= 3 && weakReds >= 2 && currentCandle.strength < 4;
        
        // DEBUG: Mostrar análisis en consola
        console.log('🐻 Bear Trap Check:', {
          prevReds, weakReds, strongReds, avgRedStrength: avgRedStrength.toFixed(2),
          currentStrength: currentCandle.strength,
          isBearTrapPattern, isEarlyReversal,
          redStrengths: redStrengths.reverse() // Orden cronológico
        });
        
        if (isBearTrapPattern || isEarlyReversal) {
          // BEAR TRAP DETECTADO: No comprar, esperar confirmación
          showReversal = false;
          finalSignal = 'wait'; 
          signalClass = 'signal-trap'; 
          signalText = '🪤 ESPERAR — POSIBLE TRAMPA';
          logicText = `🪤 Bear Trap: ${prevReds} rojas previas [${redStrengths.reverse().join('→')}] ` +
                      `promedio F${avgRedStrength.toFixed(1)}, ${weakReds} débiles. ` +
                      `La vela verde F${currentCandle.strength} aparece tras capitulación ya agotada. ` +
                      `⚡ Acción: NO COMPRAR aún — esperar segunda vela verde F3+ o confirmación con volumen.`;
          
        } else if (prevReds >= 3) {
          // Reversión válida: suficientes rojas con buena fuerza
          finalSignal = 'buy'; 
          signalClass = currentCandle.strength >= 4 ? 'signal-strong-reversal' : 'signal-buy'; 
          signalText = currentCandle.strength >= 4 ? '🔥 COMPRAR FUERTE' : '🔄 COMPRAR'; 
          logicText = `🔄 Reversión alcista — ${prevReds} rojas previas [${redStrengths.reverse().join('→')}] ` +
                      `promedio F${avgRedStrength.toFixed(1)}. ` +
                      `Vela verde F${currentCandle.strength} confirma cambio de tendencia.`;
          
        } else if (prevReds >= 2) {
          // Mínimo aceptable pero con cautela
          finalSignal = 'buy'; 
          signalClass = 'signal-buy-weak'; 
          signalText = '⬆️ COMPRAR DÉBIL'; 
          logicText = `⚠️ Reversión alcista débil — solo ${prevReds} rojas previas ` +
                      `[${redStrengths.reverse().join('→')}]. Confirmar con siguiente vela.`;
          
        } else {
          // Insuficiente contexto — probablemente continuación alcista, no reversión
          finalSignal = 'buy'; 
          signalClass = 'signal-buy-weak'; 
          signalText = '⬆️ CONTINÚA ALZA'; 
          logicText = `📈 Verde F${currentCandle.strength} con solo ${prevReds} roja(s) previa(s). ` +
                      `Posible continuación alcista más que reversión.`;
        }
        
      } else {
        // Caso simétrico para velas ROJAS (Bull Trap)
        let prevGreens = 0;
        let weakGreens = 0;
        let strongGreens = 0;
        let totalGreenStrength = 0;
        let greenStrengths = [];
        
        for (let i = history.length - 2; i >= 0 && history[i] === 'G'; i--) {
          prevGreens++;
          const s = getCandleStrength(i) || 2;
          greenStrengths.push(s);
          totalGreenStrength += s;
          if (s < 2) weakGreens++;
          if (s >= 3) strongGreens++;
        }
        
        const avgGreenStrength = prevGreens > 0 ? totalGreenStrength / prevGreens : 0;
        const isBullTrapPattern = prevGreens >= 4 && (weakGreens >= 2 || avgGreenStrength < 2.5);
        const isEarlyReversal = prevGreens >= 3 && weakGreens >= 2 && currentCandle.strength < 4;
        
        console.log('🐂 Bull Trap Check:', {
          prevGreens, weakGreens, strongGreens, avgGreenStrength: avgGreenStrength.toFixed(2),
          currentStrength: currentCandle.strength,
          isBullTrapPattern, isEarlyReversal,
          greenStrengths: greenStrengths.reverse()
        });
        
        if (isBullTrapPattern || isEarlyReversal) {
          showReversal = false;
          finalSignal = 'wait'; 
          signalClass = 'signal-trap'; 
          signalText = '🪤 ESPERAR — POSIBLE TRAMPA';
          logicText = `🪤 Bull Trap: ${prevGreens} verdes previas [${greenStrengths.reverse().join('→')}] ` +
                      `promedio F${avgGreenStrength.toFixed(1)}, ${weakGreens} débiles. ` +
                      `La vela roja F${currentCandle.strength} aparece tras agotamiento previo. ` +
                      `⚡ Acción: NO VENDER aún — esperar segunda vela roja F3+.`;
          
        } else if (prevGreens >= 3) {
          finalSignal = 'sell'; 
          signalClass = currentCandle.strength >= 4 ? 'signal-strong-reversal' : 'signal-sell'; 
          signalText = currentCandle.strength >= 4 ? '🔥 VENDER FUERTE' : '🔄 VENDER'; 
          logicText = `🔄 Reversión bajista — ${prevGreens} verdes previas [${greenStrengths.reverse().join('→')}] ` +
                      `promedio F${avgGreenStrength.toFixed(1)}. ` +
                      `Vela roja F${currentCandle.strength} confirma cambio.`;
          
        } else if (prevGreens >= 2) {
          finalSignal = 'sell'; 
          signalClass = 'signal-sell-weak'; 
          signalText = '⬇️ VENDER DÉBIL'; 
          logicText = `⚠️ Reversión bajista débil — solo ${prevGreens} verdes previas. Confirmar.`;
          
        } else {
          finalSignal = 'sell'; 
          signalClass = 'signal-sell-weak'; 
          signalText = '⬇️ CONTINÚA BAJA'; 
          logicText = `📉 Roja F${currentCandle.strength} con solo ${prevGreens} verde(s) previa(s). ` +
                      `Posible continuación bajista.`;
        }
      }
    // ═══════════════════════════════════════════════════════════════════════
    // FIN PRIORIDAD 3
    // ═══════════════════════════════════════════════════════════════════════

    // PRIORIDAD 4: CONFLICTO MOMENTUM
    } else if (recentTrend.warning === 'momentum_change') {
      finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
      logicText = `⚠️ Conflicto momentum: ${recentTrend.reason}.`;

    // PRIORIDAD 5: CRUCE VÁLIDO (solo si es fresco — detectado en esta misma vela)
    } else if (activeCross && crossIsFresh && !activeCross.trap) {
      if (trendMA >= 85 && activeCross.crossType === 'golden') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Golden Cross ignorado: MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}% (cerca de extremo).`;
      } else if (trendMA <= 15 && activeCross.crossType === 'death') {
        finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
        logicText = `⚠️ Death Cross ignorado: MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}% (cerca de extremo).`;
      } else if (activeCross.crossType === 'death') {
        const tc = detectCandleTrap();
        const _dcGConf = proj ? Math.round(proj.ifG.conf * 100) : 0;
        const _dcRConf = proj ? Math.round(proj.ifR.conf * 100) : 0;
        const _dcRevAlcista = proj && proj.ifG.sig === 'COMPRA' && proj.ifG.conf > proj.ifR.conf;
        if (tc && tc.type === 'bear-trap' && tc.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Death Cross vs Bear Trap (${Math.round(tc.probability*100)}%). ${tc.action}`;
        } else if (_dcRevAlcista) {
          const diff = _dcGConf - _dcRConf;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE REVISIÓN ALCISTA';
          logicText = `⚠️ Death Cross en ${activeCross.pair} pero proyección verde supera a roja (${_dcGConf}% vs ${_dcRConf}%, +${diff}%). Vigilando próxima vela...`;
          if (!reversalWatch || reversalWatch.candleIndex !== history.length - 1) {
            reversalWatch = { direction: 'bullish', confirmColor: 'G', cancelColor: 'R',
              confirmConf: _dcGConf, cancelConf: _dcRConf,
              candleIndex: history.length - 1, detectedAt: Date.now() };
          }
        } else if (trendMA !== null && trendMA <= 30) {
          finalSignal = 'sell'; signalClass = 'signal-sell-weak'; signalText = '⬇️ VENDER DÉBIL';
          logicText = `⚠️ Death Cross en ${activeCross.pair} pero MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}% — cerca de sobreventa.`;
        } else {
          finalSignal = 'sell'; signalClass = 'signal-sell'; signalText = '✅ VENDER';
          logicText = `✅ Death Cross válido en ${activeCross.pair}. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%. Verde ${_dcGConf}% vs Rojo ${_dcRConf}%.`;
        }
      } else if (activeCross.crossType === 'golden') {
        const tc = detectCandleTrap();
        const _gcGConf = proj ? Math.round(proj.ifG.conf * 100) : 0;
        const _gcRConf = proj ? Math.round(proj.ifR.conf * 100) : 0;
        const _gcRevBajista = proj && proj.ifR.sig === 'VENTA' && proj.ifR.conf > proj.ifG.conf;
        if (_gcRevBajista && !(tc && tc.type === 'bull-trap')) {
          const diff = _gcRConf - _gcGConf;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE REVERSIÓN BAJISTA';
          logicText = `⚠️ Golden Cross en ${activeCross.pair} pero proyección roja supera a verde (${_gcRConf}% vs ${_gcGConf}%, +${diff}%). Vigilando próxima vela...`;
          if (!reversalWatch || reversalWatch.candleIndex !== history.length - 1) {
            reversalWatch = {
              direction: 'bearish', confirmColor: 'R', cancelColor: 'G',
              confirmConf: _gcRConf, cancelConf: _gcGConf,
              candleIndex: history.length - 1, detectedAt: Date.now()
            };
          }
        } else if (tc && tc.type === 'bull-trap' && tc.probability >= 0.55) {
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ ESPERAR';
          logicText = `⚠️ Golden Cross vs Bull Trap (${Math.round(tc.probability*100)}%). ${tc.action}`;
        } else if (trendMA !== null && trendMA >= 70) {
          finalSignal = 'buy'; signalClass = 'signal-buy-weak'; signalText = '⬆️ COMPRAR DÉBIL';
          logicText = `⚠️ Golden Cross en ${activeCross.pair} pero MA10 al ${trendMA != null ? trendMA.toFixed(0) : "?"}% — cerca de sobrecompra.`;
        } else {
          const _gcConfG = proj ? Math.round(proj.ifG.conf * 100) : 0;
          const _gcConfR = proj ? Math.round(proj.ifR.conf * 100) : 0;
          if (proj && proj.ifR.sig === 'VENTA' && proj.ifR.conf > proj.ifG.conf) {
            finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE REVERSIÓN BAJISTA';
            logicText = `⚠️ Golden Cross en ${activeCross.pair} pero proyección roja ${_gcConfR}% > verde ${_gcConfG}%. Reversión probable — vigilando próxima vela.`;
            if (!reversalWatch || reversalWatch.candleIndex !== history.length - 1) {
              reversalWatch = { direction: 'bearish', confirmColor: 'R', cancelColor: 'G', confirmConf: _gcConfR, cancelConf: _gcConfG, candleIndex: history.length - 1, detectedAt: Date.now() };
            }
          } else {
            finalSignal = 'buy'; signalClass = 'signal-buy'; signalText = '✅ COMPRAR';
            logicText = `✅ Golden Cross válido en ${activeCross.pair}. MA10: ${trendMA !== null ? trendMA.toFixed(0) : '?'}%. Verde ${_gcConfG}% vs Rojo ${_gcConfR}%.`;
          }
        }
      }

    // PRIORIDAD 6: PATRÓN + CONTEXTO
    } else if (proj && recentTrend.trend !== 'neutral') {
      const _p6MinConf = Math.max(proj.ifG.conf, proj.ifR.conf);
      if (_p6MinConf < 0.60) {
        logicText = `⏸️ Patrón ${Math.round(_p6MinConf*100)}% — confianza insuficiente (<60%). Esperar señal más clara.`;
      } else {
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
        const confPctG = Math.round(proj.ifG.conf * 100);
        const confPctR = Math.round(proj.ifR.conf * 100);
        if (proj.ifR.sig === 'VENTA' && proj.ifR.conf > proj.ifG.conf) {
          const diff = confPctR - confPctG;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE REVERSIÓN BAJISTA';
          logicText = `⚠️ Tendencia alcista pero proyección roja supera a verde (${confPctR}% vs ${confPctG}%, +${diff}%). Vigilando próxima vela...`;
          if (!reversalWatch || reversalWatch.candleIndex !== history.length - 1) {
            reversalWatch = {
              direction: 'bearish',
              confirmColor: 'R', cancelColor: 'G',
              confirmConf: confPctR, cancelConf: confPctG,
              candleIndex: history.length - 1,
              detectedAt: Date.now()
            };
          }
        } else {
          finalSignal = 'buy'; signalClass = confPctG >= 70 ? 'signal-buy' : 'signal-buy-weak';
          signalText = confPctG >= 70 ? '⬆️ COMPRAR' : '⬆️ COMPRAR DÉBIL';
          logicText = `⬆️ Patrón ${proj.ifG.pat} alcista. Confianza: ${confPctG}% (verde) vs ${confPctR}% (rojo).`;
        }
      } else if (recentTrend.trend === 'bearish' && proj.ifR.sig === 'VENTA') {
        const confPctR = Math.round(proj.ifR.conf * 100);
        const confPctG = Math.round(proj.ifG.conf * 100);
        if (proj.ifG.sig === 'COMPRA' && proj.ifG.conf > proj.ifR.conf) {
          const diff = confPctG - confPctR;
          finalSignal = 'wait'; signalClass = 'signal-conflict'; signalText = '⚠️ POSIBLE REVERSIÓN ALCISTA';
          logicText = `⚠️ Tendencia bajista pero proyección verde supera a roja (${confPctG}% vs ${confPctR}%, +${diff}%). Vigilando próxima vela...`;
          if (!reversalWatch || reversalWatch.candleIndex !== history.length - 1) {
            reversalWatch = {
              direction: 'bullish',
              confirmColor: 'G', cancelColor: 'R',
              confirmConf: confPctG, cancelConf: confPctR,
              candleIndex: history.length - 1,
              detectedAt: Date.now()
            };
          }
        } else {
          finalSignal = 'sell'; signalClass = confPctR >= 70 ? 'signal-sell' : 'signal-sell-weak';
          signalText = confPctR >= 70 ? '⬇️ VENDER' : '⬇️ VENDER DÉBIL';
          logicText = `⬇️ Patrón ${proj.ifR.pat} bajista. Confianza: ${confPctR}% (rojo) vs ${confPctG}% (verde).`;
        }
      } else {
        logicText = `🤔 Patrón en conflicto con tendencia. Esperando.`;
      }
      } // end else (_p6MinConf >= 0.60)
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

  // ── Override si no hay suficientes datos ──────────────────────────────────
  if (_sinDatos) {
    finalSignal  = 'wait';
    signalClass  = 'signal-wait';
    signalText   = '⏳ ACUMULANDO DATOS';
    logicText    = 'Registra al menos 3 velas para comenzar. Llevas ' + history.length + '/3.';
    showReversal = false; showExtreme = false; showCMD = false;
  } else if (_datosLimitados) {
    var _effH = history;
    if (manualTrapIndex !== null) _effH = history.filter(function(_,i){ return i !== manualTrapIndex; });

    var _lastColor  = _effH.length > 0 ? _effH[_effH.length - 1] : null;
    var _rachaCount = 0;
    var _rachaStr   = 0;
    for (var _ri = _effH.length - 1; _ri >= 0; _ri--) {
      if (_effH[_ri] !== _lastColor) break;
      _rachaCount++;
      _rachaStr += getCandleStrength(_ri) || 2;
    }
    var _rachaAvg = _rachaCount > 0 ? _rachaStr / _rachaCount : 0;

    var _agotamiento = _rachaCount >= 3 && _rachaAvg < 2.5;
    var _continuacion = _rachaCount >= 2 && _rachaAvg >= 2.5;

    var _projGConf = proj ? proj.ifG.conf : 0;
    var _projRConf = proj ? proj.ifR.conf : 0;
    var _projGSig  = proj ? proj.ifG.sig  : '';
    var _projRSig  = proj ? proj.ifR.sig  : '';
    var _faltanVelas = 10 - history.length;

    var _projDominante = null;
    if (proj) {
      if (_projGSig === 'COMPRA' && _projGConf > _projRConf) {
        _projDominante = 'alcista';
      } else if (_projRSig === 'VENTA' && _projRConf > _projGConf) {
        _projDominante = 'bajista';
      } else if (_projGSig === 'COMPRA' && _projRSig === 'COMPRA') {
        _projDominante = 'alcista';
      } else if (_projGSig === 'VENTA' && _projRSig === 'VENTA') {
        _projDominante = 'bajista';
      }
    }

    if (_agotamiento && _lastColor === 'R' && _projDominante !== 'bajista') {
      signalText  = '⚠️ POSIBLE REVERSIÓN ALCISTA';
      signalClass = 'signal-buy-weak';
      logicText   = 'Datos insuficientes (' + history.length + '/10). '
        + _rachaCount + ' rojas débiles F' + _rachaAvg.toFixed(1) + ' — agotamiento bajista. '
        + (proj ? 'Proyección verde ' + Math.round(_projGConf*100) + '% > roja ' + Math.round(_projRConf*100) + '%. ' : '')
        + 'Espera ' + _faltanVelas + ' velas más para confirmar.';

    } else if (_agotamiento && _lastColor === 'G' && _projDominante !== 'alcista') {
      signalText  = '⚠️ POSIBLE REVERSIÓN BAJISTA';
      signalClass = 'signal-sell-weak';
      logicText   = 'Datos insuficientes (' + history.length + '/10). '
        + _rachaCount + ' verdes débiles F' + _rachaAvg.toFixed(1) + ' — agotamiento alcista. '
        + (proj ? 'Proyección roja ' + Math.round(_projRConf*100) + '% > verde ' + Math.round(_projGConf*100) + '%. ' : '')
        + 'Espera ' + _faltanVelas + ' velas más para confirmar.';

    } else if (_projDominante === 'alcista') {
      signalText  = '⚠️ POSIBLE ALZA';
      signalClass = 'signal-buy-weak';
      logicText   = 'Datos insuficientes (' + history.length + '/10). '
        + 'Proyección verde ' + Math.round(_projGConf*100) + '% supera roja ' + Math.round(_projRConf*100) + '%. '
        + 'Sin MA10 no se puede confirmar. Espera ' + _faltanVelas + ' velas más.';

    } else if (_projDominante === 'bajista') {
      signalText  = '⚠️ POSIBLE BAJA';
      signalClass = 'signal-sell-weak';
      logicText   = 'Datos insuficientes (' + history.length + '/10). '
        + 'Proyección roja ' + Math.round(_projRConf*100) + '% supera verde ' + Math.round(_projGConf*100) + '%. '
        + 'Sin MA10 no se puede confirmar. Espera ' + _faltanVelas + ' velas más.';

    } else {
      signalText  = '⚠️ ESPERAR';
      signalClass = 'signal-wait';
      logicText   = 'Datos insuficientes (' + history.length + '/10 velas). '
        + 'Sin MA10 no hay señal confiable. Espera ' + _faltanVelas + ' velas más.';
    }

    finalSignal  = 'wait';
    showReversal = false; showExtreme = false; showCMD = false;
  }

  // ── Renderizado señal ────────────────────────────────────────────────────
  window._finalSignalState = finalSignal;
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
  var _lastSignalClass = '';
  if (finalSignal === 'buy')  _lastSignalClass = 'candle-signal-buy';
  if (finalSignal === 'sell') _lastSignalClass = 'candle-signal-sell';

  const MAX_VISIBLE = 12;
  const startIdx = Math.max(0, history.length - MAX_VISIBLE);

  let html = '<div class="history-inner">';

  for (let i = startIdx; i < history.length; i++) {
      const isTrap  = (i === manualTrapIndex);
      const isNew   = (i === history.length - 1);
      const s       = getCandleStrength(i) || 2;

      let ind = '';
      if (s >= 4) ind = '🔥';
      else if (s >= 3) ind = '▰▰▰';
      else if (s >= 2.5) ind = '▰▰+';
      else if (s >= 2) ind = '▰▰';
      else if (s >= 1.5) ind = '▰+';
      else ind = '▰';

      html += `
          <div class="candle candle-${history[i].toLowerCase()} ${isTrap ? 'candle-trap' : ''} ${isNew ? 'candle-new' : ''}" 
               data-hover-idx="${i}" 
               onclick="window._candleClick(${i}, event)"
               title="Vela #${i+1} • ${history[i]} • Fuerza ${s}">
              ${history[i]}
              <span class="candle-force">${ind}</span>
          </div>`;
  }

  html += '</div>';

  if (history.length > MAX_VISIBLE) {
      html += `
          <div class="history-hidden-info">
              Mostrando últimas ${MAX_VISIBLE} velas • 
              Total real: ${history.length} (la IA ve toda la secuencia)
          </div>`;
  }

  document.getElementById('history').innerHTML = html;

  if (!update._syncTimer) {
    update._syncTimer = setTimeout(function() {
      update._syncTimer = null;
      broadcastEdit();
    }, 250);
  }
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

  // ── Resaltar el contenedor con mayor confianza ──────────────────────────
  var _gConfNum = proj.ifG.conf;
  var _rConfNum = proj.ifR.conf;
  var _gEl = document.getElementById('proj-g-box');
  var _rEl = document.getElementById('proj-r-box');
  // Solo aplicar dominancia si hay señales activas (no conflicto ni extremo)
  var _gActive = gSig === 'COMPRA';
  var _rActive = rSig === 'VENTA';
  var _diff = Math.abs(_gConfNum - _rConfNum);

  if (_gEl && _rEl) {
    // Quitar clases previas de dominancia
    _gEl.classList.remove('proj-dominant-green', 'proj-dominant-red', 'proj-subdued');
    _rEl.classList.remove('proj-dominant-green', 'proj-dominant-red', 'proj-subdued');

    if (_gActive && _rActive && _diff >= 0.05) {
      // Ambos tienen señal activa — resaltar el ganador
      if (_gConfNum > _rConfNum) {
        _gEl.classList.add('proj-dominant-green');
        _rEl.classList.add('proj-subdued');
      } else {
        _rEl.classList.add('proj-dominant-red');
        _gEl.classList.add('proj-subdued');
      }
    } else if (_gActive && !_rActive) {
      // Solo verde tiene señal activa
      _gEl.classList.add('proj-dominant-green');
    } else if (_rActive && !_gActive) {
      // Solo rojo tiene señal activa
      _rEl.classList.add('proj-dominant-red');
    }
    // Si ambos en HOLD/ESPERAR o diferencia < 5%, sin resaltado
  }
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
  reversalWatch = null;
  // FIX 1: Limpiar estado del cruce al reiniciar
  lastCrossDetectedAtLength = -1;
  lastCrossSnapshot = null;
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

// ===== SINCRONIZACIÓN AUTOMÁTICA CON BACKTESTING =====

function syncToBacktesting() {
  // Convertir historial a formato G2 R3 G1.5 etc.
  const sequence = history.map((color, idx) => {
    const str = getCandleStrength(idx) || 2;
    const strFormatted = str === 1.5 ? '1.5' : 
                        str === 2.5 ? '2.5' : 
                        String(parseInt(str));
    return color + strFormatted;
  }).join(' ');
  
  // Guardar en localStorage (disparará evento storage en otras pestañas)
  localStorage.setItem('cmd-backtest-sequence', sequence);
  localStorage.setItem('cmd-backtest-timestamp', Date.now());
  localStorage.setItem('cmd-backtest-count', history.length);
  
  // También enviar por BroadcastChannel (más rápido que storage events)
  if (bc) {
    try {
      bc.postMessage({
        type: 'candle-added',
        sequence: sequence,
        count: history.length,
        lastCandle: history.length > 0 ? {
          color: history[history.length - 1],
          strength: getCandleStrength(history.length - 1),
          index: history.length - 1
        } : null,
        timestamp: Date.now()
      });
    } catch (e) {}
  }
  
  console.log('📊 Sincronizado con backtesting:', sequence);
}

// ===== BROADCAST — solo emisor =====

function broadcastEdit() {
  // Recopilar datos de señal actual para el monitor
  const _mainSig  = document.getElementById('main-signal');
  const _logicEl  = document.getElementById('logic-text');
  const _sigClass = _mainSig ? (_mainSig.className || '').replace('main-signal','').trim() : '';
  const _sigText  = _mainSig ? _mainSig.cloneNode(true) : null;
  if (_sigText) _sigText.querySelectorAll('div').forEach(d => d.remove());
  const _sigTextStr = _sigText ? _sigText.textContent.trim() : '';
  const _logicStr  = _logicEl ? _logicEl.textContent : '';

  // Proyección actual (última calculada en update)
  const _projGSig  = document.getElementById('proj-g-sig')?.textContent || '';
  const _projRSig  = document.getElementById('proj-r-sig')?.textContent || '';
  const _projGConf = parseFloat(document.getElementById('proj-g-conf')?.textContent || '0') / 100;
  const _projRConf = parseFloat(document.getElementById('proj-r-conf')?.textContent || '0') / 100;
  const _projGDesc = document.getElementById('proj-g-reason')?.textContent || '';
  const _projRDesc = document.getElementById('proj-r-reason')?.textContent || '';
  const _projData = {
    ifG: { sig: _projGSig, conf: Math.min(_projGConf, 0.95), desc: _projGDesc },
    ifR: { sig: _projRSig, conf: Math.min(_projRConf, 0.95), desc: _projRDesc }
  };

  // Trampa de vela actual
  const _ct = _detectCandleTrap();

  const payload = {
    history, manualStrengths, cmdState,
    signalClass: _sigClass,
    signalText:  _sigTextStr,
    logicText:   _logicStr,
    proj:        _projData,
    candleTrap:  _ct ? { detected: true, typeLabel: _ct.typeLabel, probability: _ct.probability, action: _ct.action } : { detected: false },
    // Pattern activo — para monitor y backtesting
    patternResult: window.currentPatternResult || null,
    timestamp:   Date.now()
  };

  if (bc) {
    try { bc.postMessage({ type: 'strength-edited', payload }); } catch (e) { console.error('BroadcastChannel error:', e); }
  }
  try { localStorage.setItem('cmd-vp-data', JSON.stringify(payload)); } catch (e) {}
  if (typeof monitorWindow !== 'undefined' && monitorWindow && !monitorWindow.closed) {
    try { monitorWindow.postMessage({ type: 'vp-update', payload }, '*'); } catch (e) {}
  }
  
  // ← AGREGAR ESTA LÍNEA: Sincronizar con backtesting automáticamente
  syncToBacktesting();
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
update = function() { try { _origUpdate(); } catch(e) { console.error("[update/boston-pre]", e); } try { if (bostonActive) { bostonSyncSignal(); bostonSyncHistory(); } } catch(e) { console.error("[update/boston]", e); } };

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
  var lastTwo = slice.slice(-3);
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
  }, 400);
}


// Helper: construye velas SVG coloreadas para el panel hover
// seq: string como "RRG", "GRG", etc.
// nextMode: si true, la ultima vela se muestra mas grande (vela siguiente)
function buildCandleSeqHTML(seq, nextMode) {
  if (!seq || seq === '--') return '<span style="color:#333;font-size:0.7em;">--</span>';
  var html = '';
  var chars = seq.split('');
  chars.forEach(function(c, i) {
    var isLast = i === chars.length - 1;
    var isNext = nextMode && isLast;
    var isG = c === 'G';
    var fill   = isG ? '#00ff88' : '#ff4444';
    var stroke = isG ? '#00cc55' : '#cc2222';
    var glow   = isG ? 'rgba(0,255,136,0.35)' : 'rgba(255,68,68,0.35)';
    var w = isNext ? 14 : 9;
    var h = isNext ? 22 : 15;
    var bx = isNext ? 3 : 2;
    var bw = isNext ? 8 : 5;
    // vela: mecha top, cuerpo, mecha bottom
    var bodyTop    = isG ? Math.round(h * 0.15) : Math.round(h * 0.25);
    var bodyHeight = Math.round(h * 0.55);
    var cx = Math.round(w / 2);
    var shadow = isNext ? ('filter:drop-shadow(0 0 4px ' + glow + ');') : '';
    var opacity = isNext ? '1' : '0.7';
    html += '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="' + shadow + 'opacity:' + opacity + ';flex-shrink:0;">';
    // mecha top
    html += '<line x1="' + cx + '" y1="2" x2="' + cx + '" y2="' + bodyTop + '" stroke="' + stroke + '" stroke-width="1.2" stroke-linecap="round"/>';
    // cuerpo
    html += '<rect x="' + bx + '" y="' + bodyTop + '" width="' + bw + '" height="' + bodyHeight + '" fill="' + fill + '" rx="1" opacity="0.92"/>';
    // mecha bottom
    var bodyBot = bodyTop + bodyHeight;
    html += '<line x1="' + cx + '" y1="' + bodyBot + '" x2="' + cx + '" y2="' + (h - 2) + '" stroke="' + stroke + '" stroke-width="1.2" stroke-linecap="round"/>';
    html += '</svg>';
    // flecha entre velas (excepto la ultima)
    if (!isLast) {
      html += '<span style="font-size:8px;color:#333;margin:0 1px;">&#x203A;</span>';
    }
  });
  return html;
}

// Helper: actualiza los dos boxes de proyeccion con datos y barra de confianza
function fillProjBox(side, proj) {
  var seqEl  = document.getElementById('hover-proj-' + side + '-seq');
  var sigEl  = document.getElementById('hover-proj-' + side + '-sig');
  var confEl = document.getElementById('hover-proj-' + side + '-conf');
  var fillEl = document.getElementById('hover-proj-' + side + '-fill');
  var pctEl  = document.getElementById('hover-proj-' + side + '-pct');
  var boxEl  = document.getElementById('hover-proj-' + side + '-box');
  if (!seqEl) return;

  var data   = side === 'g' ? proj.ifG : proj.ifR;
  var pct    = Math.round(data.conf * 100);
  var isBuy  = data.sig === 'COMPRA';
  var isSell = data.sig === 'VENTA';

  seqEl.innerHTML   = buildCandleSeqHTML(data.pat, true);
  sigEl.textContent = data.sig;
  sigEl.className   = 'hover-proj-sig ' + (isBuy ? 'sig-buy' : isSell ? 'sig-sell' : 'sig-wait');

  var barColor = isBuy ? '#00ff88' : isSell ? '#ff4444' : '#ffd700';
  if (fillEl) { fillEl.style.width = pct + '%'; fillEl.style.background = barColor; }
  if (pctEl)  { pctEl.textContent = pct + '%'; pctEl.style.color = barColor; }
  if (confEl) { confEl.textContent = data.desc || ''; }
}

// Aplica el resaltado visual al box ganador y atenúa el perdedor
function applyWinnerStyle(proj) {
  if (!proj) return;
  var gBox   = document.getElementById('hover-proj-g-box');
  var rBox   = document.getElementById('hover-proj-r-box');
  var gSigEl = document.getElementById('hover-proj-g-sig');
  var rSigEl = document.getElementById('hover-proj-r-sig');
  var gPctEl = document.getElementById('hover-proj-g-pct');
  var rPctEl = document.getElementById('hover-proj-r-pct');
  var gFill  = document.getElementById('hover-proj-g-fill');
  var rFill  = document.getElementById('hover-proj-r-fill');
  if (!gBox || !rBox) return;

  var gConf   = proj.ifG.conf;
  var rConf   = proj.ifR.conf;
  var gWins   = gConf >= rConf;
  var diff    = Math.abs(gConf - rConf);

  // Colores base
  var gColor  = '#00ff88';
  var rColor  = '#ff4444';

  if (diff < 0.05) {
    // Empate — ambos igual de prominentes
    gBox.style.cssText += ';border-top:2px solid rgba(0,255,136,0.5);box-shadow:none;opacity:1;background:#080808;';
    rBox.style.cssText += ';border-top:2px solid rgba(255,68,68,0.5);box-shadow:none;opacity:1;background:#080808;';
  } else if (gWins) {
    // Verde GANA
    gBox.style.borderTopColor  = gColor;
    gBox.style.borderTopWidth  = '3px';
    gBox.style.boxShadow       = '0 0 16px rgba(0,255,136,0.25), inset 0 0 20px rgba(0,255,136,0.06)';
    gBox.style.background      = 'rgba(0,255,136,0.06)';
    gBox.style.opacity         = '1';
    if (gSigEl) { gSigEl.style.fontSize = '1em'; gSigEl.style.textShadow = '0 0 8px ' + gColor; }
    if (gPctEl) { gPctEl.style.fontSize = '0.78em'; gPctEl.style.fontWeight = 'bold'; }
    if (gFill)  { gFill.style.boxShadow = '0 0 6px ' + gColor; }
    // Rojo se atenúa
    rBox.style.borderTopColor  = 'rgba(255,68,68,0.2)';
    rBox.style.borderTopWidth  = '2px';
    rBox.style.boxShadow       = 'none';
    rBox.style.background      = '#080808';
    rBox.style.opacity         = '0.55';
    if (rSigEl) { rSigEl.style.fontSize = ''; rSigEl.style.textShadow = 'none'; }
    if (rPctEl) { rPctEl.style.fontSize = ''; rPctEl.style.fontWeight = ''; }
    if (rFill)  { rFill.style.boxShadow = 'none'; }
  } else {
    // Rojo GANA
    rBox.style.borderTopColor  = rColor;
    rBox.style.borderTopWidth  = '3px';
    rBox.style.boxShadow       = '0 0 16px rgba(255,68,68,0.25), inset 0 0 20px rgba(255,68,68,0.06)';
    rBox.style.background      = 'rgba(255,68,68,0.06)';
    rBox.style.opacity         = '1';
    if (rSigEl) { rSigEl.style.fontSize = '1em'; rSigEl.style.textShadow = '0 0 8px ' + rColor; }
    if (rPctEl) { rPctEl.style.fontSize = '0.78em'; rPctEl.style.fontWeight = 'bold'; }
    if (rFill)  { rFill.style.boxShadow = '0 0 6px ' + rColor; }
    // Verde se atenúa
    gBox.style.borderTopColor  = 'rgba(0,255,136,0.2)';
    gBox.style.borderTopWidth  = '2px';
    gBox.style.boxShadow       = 'none';
    gBox.style.background      = '#080808';
    gBox.style.opacity         = '0.55';
    if (gSigEl) { gSigEl.style.fontSize = ''; gSigEl.style.textShadow = 'none'; }
    if (gPctEl) { gPctEl.style.fontSize = ''; gPctEl.style.fontWeight = ''; }
    if (gFill)  { gFill.style.boxShadow = 'none'; }
  }
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

  // ── LABEL TITLE según modo ──
  var titleEl2 = document.getElementById('hover-proj-current-label-title');
  if (titleEl2) {
    var isNextMode = projectionMode === 'next';
    titleEl2.textContent = isNextMode ? 'Contexto →' : 'Vela actual';
    titleEl2.style.color = isNextMode ? '#00ffff' : '#444';
  }

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
    fillProjBox('g', proj);
    fillProjBox('r', proj);
    applyWinnerStyle(proj);
  }

  if (hint) {
    hint.textContent = pinned
      ? 'Fijado - Click en misma vela o X para cerrar'
      : 'Click en vela para fijar';
  }

  panel.setAttribute('data-idx', String(idx));
  // Posicionar con coordenadas actuales ANTES de mostrar
  var vw = window.innerWidth, vh = window.innerHeight;
  var W = panel.offsetWidth || 324, H = panel.offsetHeight || 220, gap = 16;
  var left = _hoverMouseX + gap;
  var top  = _hoverMouseY + gap;
  if (left + W > vw - 8) { left = _hoverMouseX - W - gap; }
  if (top  + H > vh - 8) { top  = _hoverMouseY - H - gap; }
  if (left < 8) { left = 8; }
  if (top  < 8) { top = 8; }
  panel.style.left = left + 'px';
  panel.style.top  = top  + 'px';
  panel.style.display = 'block';
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
  // Los eventos de cada vela van directo via onmouseenter/onmouseleave/onclick inline.
  // Aqui solo configuramos el panel y el cierre global.

  // Cancelar hide cuando el mouse entra al panel flotante
  document.addEventListener('mouseenter', function(e) {
    var panel = document.getElementById('hover-proj-panel');
    if (!panel || panel.style.display === 'none') return;
    var t = e.target;
    while (t) {
      if (t === panel) { cancelHide(); return; }
      t = t.parentElement;
    }
  }, true);

  // Ocultar cuando mouse sale del panel
  var panel = document.getElementById('hover-proj-panel');
  if (panel) {
    panel.addEventListener('mouseleave', function() { scheduleHide(); });
  }
}

// Funciones inline para las velas — expuestas en window
window._candleHoverEnter = function(idx) {
  cancelHide();
  if (hoverProjPinned) return;
  showHoverProj(idx, false);
};

// Actualizar posición del panel mientras el mouse se mueve
document.addEventListener('mousemove', function() {
  if (hoverProjPinned) return;
  var panel = document.getElementById('hover-proj-panel');
  if (panel && panel.style.display !== 'none') {
    positionHoverPanel(panel);
  }
});

window._candleHoverLeave = function() {
  scheduleHide();
};

window._candleClick = function(idx, e) {
  var panel  = document.getElementById('hover-proj-panel');
  var curIdx = panel ? parseInt(panel.getAttribute('data-idx') || '-1') : -1;
  if (hoverProjPinned && curIdx === idx) {
    // Segundo click en la misma vela: cerrar panel Y abrir editor
    closeHoverProj();
    openEditPanel(idx);
  } else {
    // Primer click: fijar panel de proyeccion
    hoverProjPinned = true;
    showHoverProj(idx, true);
  }
};

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

// ── PROYECCION DESDE EL PRICE PICKER ──
// Se llama desde ppBarHover en el index.html cada vez que el mouse
// se mueve sobre la barra de seleccion de fuerza.
// color: 'G' o 'R'  |  strength: 1, 1.5, 2, 2.5, 3, 4
// clientX/Y: posicion actual del mouse

window.showPPProjection = function(color, strength, clientX, clientY) {
  var panel  = document.getElementById('hover-proj-panel');
  var badge  = document.getElementById('hover-proj-mode-badge');
  var infoEl = document.getElementById('hover-proj-candle-info');
  var hint   = document.getElementById('hover-proj-pin-hint');
  if (!panel) return;

  var effHist = history;
  if (manualTrapIndex !== null) {
    effHist = history.filter(function(_, i) { return i !== manualTrapIndex; });
  }
  var cr = detectCrosses(false);
  var proj = null;

  if (projectionMode === 'current') {
    // MODO ACTUAL: "si esta vela cierra asi, que señal da AHORA"
    // Secuencia: [...historial, velaActual] -> proyectar lo que sigue
    var simH = effHist.concat([color]);
    if (simH.length >= 2) {
      proj = analyzePattern(simH.slice(-3), null, cr.extremeCondition);
    }
  } else {
    // MODO SIGUIENTE: "si esta vela cierra asi, que vela viene DESPUES"
    // Simular las DOS ramas posibles de la vela que sigue a la seleccionada:
    //   rama G: [...hist, color, G] -> proyeccion si la siguiente es verde
    //   rama R: [...hist, color, R] -> proyeccion si la siguiente es roja
    // ifG viene de la rama G (que pasa si tras [color] viene G)
    // ifR viene de la rama R (que pasa si tras [color] viene R)
    var simBase = effHist.concat([color]);
    if (simBase.length >= 2) {
      var projG = analyzePattern(simBase.concat(['G']).slice(-3), null, cr.extremeCondition);
      var projR = analyzePattern(simBase.concat(['R']).slice(-3), null, cr.extremeCondition);
      if (projG && projR) {
        proj = {
          ifG: projG.ifG,
          ifR: projR.ifR,
          patternName: projG.patternName || projR.patternName
        };
      } else if (projG) {
        proj = projG;
      } else if (projR) {
        proj = projR;
      }
    }
  }

  // ── BADGE DE MODO ──
  var isNext = projectionMode === 'next';
  badge.textContent = isNext ? 'VELA SIGUIENTE' : 'VELA ACTUAL';
  badge.style.color = isNext ? '#00ffff' : '#ffd700';
  badge.style.background = isNext ? 'rgba(0,255,255,0.08)' : 'rgba(255,215,0,0.06)';
  panel.classList.toggle('mode-next-active', isNext);
  panel.classList.remove('pinned');

  // ── LABEL TITLE (actualizar según modo) ──
  var titleEl = document.getElementById('hover-proj-current-label-title');
  if (titleEl) {
    titleEl.textContent = isNext ? 'Contexto →' : 'Vela actual';
    titleEl.style.color = isNext ? '#00ffff' : '#444';
  }

  // ── INFO HEADER ──
  var strLabel  = (STRENGTH_CONFIG.LEVELS[strength] || {}).name || 'MEDIA';
  var colLabel  = color === 'G' ? 'VERDE' : 'ROJA';
  infoEl.textContent = colLabel + ' F' + strength + ' ' + strLabel;

  // ── FILA DE CONTEXTO (vela actual en el selector) ──
  var rowEl  = document.getElementById('hover-proj-current-candles');
  var lblEl  = document.getElementById('hover-proj-current-label');
  var rowStyle = document.getElementById('hover-proj-current-row');
  if (rowEl) {
    // Mostrar: ultima vela registrada → vela que se está seleccionando ahora
    var prev = effHist.length > 0 ? effHist[effHist.length - 1] : null;
    var seqCtx = prev ? (prev + color) : color;

    if (isNext) {
      // Modo siguiente: resaltar que la vela actual es el contexto, la siguiente es lo que proyectamos
      // Mostrar: [prev] → [actual(seleccionada)] → [?]
      var placeholder = color === 'G' ? 'R' : 'G'; // la "opuesta" como placeholder visual
      rowEl.innerHTML = buildCandleSeqHTML(seqCtx, false)
        + '<span style="font-size:9px;color:#444;margin:0 2px;">&#x2192;</span>'
        + '<svg width="14" height="22" viewBox="0 0 14 22" style="opacity:0.25;flex-shrink:0;">'
        + '<rect x="3" y="4" width="8" height="12" fill="#888" rx="1"/>'
        + '<line x1="7" y1="1" x2="7" y2="4" stroke="#666" stroke-width="1.2"/>'
        + '<line x1="7" y1="16" x2="7" y2="21" stroke="#666" stroke-width="1.2"/>'
        + '</svg>'
        + '<span style="font-size:8px;color:#444;margin-left:2px;">?</span>';
      if (lblEl) { lblEl.textContent = 'sig.'; lblEl.style.color = '#00ffff'; }
    } else {
      rowEl.innerHTML = buildCandleSeqHTML(seqCtx, false);
      if (lblEl) {
        lblEl.textContent = 'F' + strength;
        lblEl.style.color = color === 'G' ? '#00ff88' : '#ff4444';
      }
    }
  }

  // ── PROYECCIONES ──
  if (!proj) {
    ['g','r'].forEach(function(s) {
      var seqEl  = document.getElementById('hover-proj-' + s + '-seq');
      var sigEl  = document.getElementById('hover-proj-' + s + '-sig');
      var confEl = document.getElementById('hover-proj-' + s + '-conf');
      var fillEl = document.getElementById('hover-proj-' + s + '-fill');
      var pctEl  = document.getElementById('hover-proj-' + s + '-pct');
      if (seqEl)  seqEl.innerHTML  = '<span style="color:#333;font-size:0.7em">--</span>';
      if (sigEl)  { sigEl.textContent = 'Sin datos'; sigEl.className = 'hover-proj-sig sig-wait'; }
      if (confEl) confEl.textContent = 'Registra mas velas';
      if (fillEl) fillEl.style.width = '0%';
      if (pctEl)  pctEl.textContent = '--';
    });
  } else {
    fillProjBox('g', proj);
    fillProjBox('r', proj);
    applyWinnerStyle(proj);

    // En modo SIGUIENTE: resaltar la señal dominante con borde mas fuerte
    if (isNext) {
      var gConf = proj.ifG.conf, rConf = proj.ifR.conf;
      var gBox = document.getElementById('hover-proj-g-box');
      var rBox = document.getElementById('hover-proj-r-box');
      if (gBox && rBox) {
        if (gConf > rConf && proj.ifG.sig === 'COMPRA') {
          gBox.style.borderTopColor = 'rgba(0,255,136,0.9)';
          gBox.style.boxShadow = '0 0 8px rgba(0,255,136,0.15)';
          rBox.style.borderTopColor = 'rgba(255,68,68,0.25)';
          rBox.style.boxShadow = 'none';
        } else if (rConf > gConf && proj.ifR.sig === 'VENTA') {
          rBox.style.borderTopColor = 'rgba(255,68,68,0.9)';
          rBox.style.boxShadow = '0 0 8px rgba(255,68,68,0.15)';
          gBox.style.borderTopColor = 'rgba(0,255,136,0.25)';
          gBox.style.boxShadow = 'none';
        } else {
          gBox.style.borderTopColor = 'rgba(0,255,136,0.4)';
          rBox.style.borderTopColor = 'rgba(255,68,68,0.4)';
          gBox.style.boxShadow = 'none';
          rBox.style.boxShadow = 'none';
        }
      }
    } else {
      // Modo actual: reset estilos de resaltado
      ['g','r'].forEach(function(s) {
        var b = document.getElementById('hover-proj-' + s + '-box');
        if (b) b.style.boxShadow = 'none';
      });
    }
  }

  if (hint) {
    hint.textContent = isNext
      ? 'Proyectando vela siguiente  |  Click para registrar esta'
      : 'Proyectando vela actual  |  Click para registrar';
  }

  // ── POSICIONAR ──
  var vw = window.innerWidth, vh = window.innerHeight;
  var W = panel.offsetWidth || 324, H = panel.offsetHeight || 220, gap = 18;
  var left = clientX + gap;
  var top  = clientY - H / 2;
  if (left + W > vw - 8) { left = clientX - W - gap; }
  if (top + H > vh - 8)  { top = vh - H - 8; }
  if (top < 8) { top = 8; }
  panel.style.left = left + 'px';
  panel.style.top  = top  + 'px';
  panel.style.display = 'block';
};
window.hidePPProjection = function() {
  // Solo ocultar si no esta fijado (pinned)
  var panel = document.getElementById('hover-proj-panel');
  if (panel && !hoverProjPinned) {
    panel.style.display = 'none';
  }
};

window.toggleProjectionMode = toggleProjectionMode;
window.closeHoverProj = closeHoverProj;


// ===== SISTEMA DE VISIBILIDAD DE SECCIONES =====

var VIEW_SECTIONS = [
  // { id, label, col }
  // Columna izquierda
  { id: 'extreme-alert',       label: '⚠️ Alerta extremo',       col: 'left'  },
  { id: 'candle-trap-alert',   label: '🪤 Alerta trampa vela',   col: 'left'  },
  { id: 'pattern-active-panel',label: '📊 Panel de Patrón',      col: 'left'  },
  { id: 'logic-explanation',   label: '🧠 Lógica',               col: 'left'  },
  { id: 'history-container',   label: '📋 Historial',            col: 'left'  },
  { id: 'projections',         label: '📊 Proyecciones',         col: 'left'  },
  
  // Columna derecha
  { id: 'trend-box',           label: '📈 Tendencia global MA10', col: 'right' },
  { id: 'short-trend-box',     label: '📉 Tendencia corta MA3',   col: 'right' },
  { id: 'momentum-box',        label: '⚡ Momentum MA10',         col: 'right' },
  { id: 'cmd-panel',           label: '🎯 Fases CMD',             col: 'right' },
  { id: 'cross-detector',      label: '⚔️ Cruces MA',             col: 'right' },
  { id: 'current-analysis',    label: '🕯️ Vela actual',           col: 'right' },
  { id: 'recent-box',          label: '📊 Contexto 5 velas',      col: 'right' },
  { id: 'priority-explanation',label: '⚡ Prioridad señales',     col: 'right' },
];

// Necesitamos el id correcto del cross-detector que no tiene ID propio
// Lo fijamos con un wrapper en HTML — alternativa: usar clase
// Para history-container que tampoco tiene ID:
// Lo agregamos dinámicamente

var _viewState = {};  // { sectionId: true/false (visible) }
window._viewState = _viewState; // exponer globalmente para scripts externos

function _initViewState() {
  // Cargar desde localStorage si existe
  try {
    var saved = localStorage.getItem('cmd-view-state');
    if (saved) { _viewState = JSON.parse(saved); }
  } catch(e) {}
  // Defaults: todo visible
  VIEW_SECTIONS.forEach(function(s) {
    if (_viewState[s.id] === undefined) { _viewState[s.id] = true; }
  });
  // Sincronizar referencia global (puede haber sido reasignada por JSON.parse)
  window._viewState = _viewState;
  // Asegurar IDs en elementos que no los tienen
  _ensureSectionIds();
}

function _ensureSectionIds() {
  // history-container no tiene ID en el original
  var hc = document.querySelector('.history-container');
  if (hc && !hc.id) hc.id = 'history-container';
  // cross-detector no tiene ID
  var cd = document.querySelector('.cross-detector');
  if (cd && !cd.id) cd.id = 'cross-detector';
  // short-trend-box sí tiene ID ya
}

function _applyViewState() {
  VIEW_SECTIONS.forEach(function(s) {
    var el = document.getElementById(s.id);
    if (!el) return;
    
    // Si _viewState[id] es false, ocultamos. Si es undefined o true, mostramos.
    var visible = _viewState[s.id] !== false;
    
    // Usamos 'important' para ganarle a cualquier estilo inline de otros scripts
    el.style.setProperty('display', visible ? '' : 'none', 'important');
  });
}

function _saveViewState() {
  try { localStorage.setItem('cmd-view-state', JSON.stringify(_viewState)); } catch(e) {}
}

function _buildViewPanel() {
  var leftEl  = document.getElementById('view-items-left');
  var rightEl = document.getElementById('view-items-right');
  if (!leftEl || !rightEl) return;

  function makeItem(s) {
    var visible = _viewState[s.id] !== false;
    var div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #141414;';
    div.innerHTML =
      '<span style="font-size:0.68em;color:' + (visible ? '#aaa' : '#444') + ';">' + s.label + '</span>'
      + '<div onclick="toggleSection(\'' + s.id + '\')" style="width:36px;height:18px;background:' + (visible ? '#00ffff' : '#222') + ';border-radius:10px;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;" id="vtoggle-' + s.id + '">'
      + '<div style="position:absolute;top:3px;' + (visible ? 'right:3px' : 'left:3px') + ';width:12px;height:12px;background:#fff;border-radius:50%;transition:all 0.2s;"></div>'
      + '</div>';
    return div;
  }

  leftEl.innerHTML  = '';
  rightEl.innerHTML = '';
  VIEW_SECTIONS.forEach(function(s) {
    if (s.col === 'left')  leftEl.appendChild(makeItem(s));
    else                   rightEl.appendChild(makeItem(s));
  });
}

function toggleSection(id) {
  _viewState[id] = !(_viewState[id] !== false);
  window._viewState = _viewState; // mantener referencia global sincronizada
  _saveViewState();
  _applyViewState();
  _buildViewPanel(); // re-render para actualizar colores del toggle
}

function toggleViewPanel() {
  var panel   = document.getElementById('view-panel');
  var overlay = document.getElementById('view-overlay');
  if (!panel) return;
  var isOpen = panel.style.display !== 'none';
  panel.style.display   = isOpen ? 'none' : 'block';
  overlay.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) { _buildViewPanel(); }
  var btn = document.getElementById('btn-view-toggle');
  if (btn) btn.style.color = isOpen ? '#aaa' : '#00ffff';
}

function resetViewPanel() {
  VIEW_SECTIONS.forEach(function(s) { _viewState[s.id] = true; });
  _saveViewState();
  _applyViewState();
  _buildViewPanel();
}

// Exponer globalmente
window.toggleViewPanel = toggleViewPanel;
window.toggleSection   = toggleSection;
window.resetViewPanel  = resetViewPanel;

// Inicializar
document.addEventListener('DOMContentLoaded', function() {
  _initViewState();
  _applyViewState();
});
// También aplicar inmediatamente por si DOMContentLoaded ya pasó
_ensureSectionIds();