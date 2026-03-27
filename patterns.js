// ═══════════════════════════════════════════════════════════
// patterns.js — Biblioteca completa de patrones de velas
// Dependencias: getCandleStrength(), calcMA() desde logic.js
// Cargado ANTES que logic.js en index.html
// ═══════════════════════════════════════════════════════════
// ===== CONFIGURACIÓN DE PATRONES DINÁMICOS =====
// Cada patrón tiene: detector de condiciones + proyecciones G/R con confianza base

const PATTERN_LIBRARY = {
  // ═══════════════════════════════════════════════════════════
  // PATRONES DE 2 VELAS (Más frecuentes, confianza media)
  // ═══════════════════════════════════════════════════════════
  
  'engulfing-bullish': {
    name: 'Engulfing Alcista',
    priority: 1,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R seguida de G fuerte que "engloba" (fuerza 4 o mucho mayor que anterior)
      if (prev !== 'R' || curr !== 'G') return null;
      const isEngulfing = currS === 4 || (currS >= 3 && prevS <= 2);
      if (!isEngulfing) return null;
      return {
        strength: (currS === 4 ? 1.0 : 0.85),
        context: `R(${prevS})→G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.05, 0.95), desc: 'Engulfing confirmado - Continuación alcista' },
      ifR: { sig: 'VENTA', conf: conf * 0.75, desc: 'Engulfing fallido - Reversión bajista' }
    })
  },

  'engulfing-bearish': {
    name: 'Engulfing Bajista',
    priority: 1,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (prev !== 'G' || curr !== 'R') return null;
      const isEngulfing = currS === 4 || (currS >= 3 && prevS <= 2);
      if (!isEngulfing) return null;
      return {
        strength: (currS === 4 ? 1.0 : 0.85),
        context: `G(${prevS})→R(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 0.75, desc: 'Engulfing fallido - Reversión alcista' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.05, 0.95), desc: 'Engulfing confirmado - Continuación bajista' }
    })
  },

  'harami-bullish': {
    name: 'Harami Alcista',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte seguida de G pequeño (doji/spinning) dentro del rango
      if (prev !== 'R' || curr !== 'G') return null;
      if (!(prevS >= 2.5 && currS <= 1.5)) return null;
      return { strength: 0.70, context: `R(${prevS})→G(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.15, 0.95), desc: 'Harami confirmado - Giro alcista' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Harami no confirmado' }
    })
  },

  'harami-bearish': {
    name: 'Harami Bajista',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (prev !== 'G' || curr !== 'R') return null;
      if (!(prevS >= 2.5 && currS <= 1.5)) return null;
      return { strength: 0.70, context: `G(${prevS})→R(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Harami no confirmado' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.15, 0.95), desc: 'Harami confirmado - Giro bajista' }
    })
  },

  'piercing-pattern': {
    name: 'Patrón de Penetración',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte seguida de G que penetra (>50% implicado por fuerza similar o mayor)
      if (prev !== 'R' || curr !== 'G') return null;
      if (!(prevS >= 2.5 && currS >= prevS)) return null;
      return { strength: 0.72, context: `R(${prevS})→G(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.10, desc: 'Penetración alcista confirmada' },
      ifR: { sig: 'VENTA', conf: conf * 0.80, desc: 'Penetración fallida' }
    })
  },

  'dark-cloud': {
    name: 'Nube Oscura',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (prev !== 'G' || curr !== 'R') return null;
      if (!(prevS >= 2.5 && currS >= prevS)) return null;
      return { strength: 0.72, context: `G(${prevS})→R(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 0.80, desc: 'Nube oscura fallida' },
      ifR: { sig: 'VENTA', conf: conf * 1.10, desc: 'Nube oscura confirmada' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES DE 3 VELAS (Reversión clásica, alta confianza)
  // ═══════════════════════════════════════════════════════════

  'morning-star': {
    name: 'Estrella de la Mañana',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji middle, not needed directly) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // R + Doji/Spinning + G fuerte
      if (!(v0 === 'R' && v2 === 'G')) return null;
      if (!(s0 >= 2 && s1 <= 1.5 && s2 >= 2.5)) return null;
      // La del medio debe ser débil (doji)
      const isMiddleWeak = s1 <= 1.5;
      if (!isMiddleWeak) return null;
      return { 
        strength: 0.85 + (s2 === 4 ? 0.08 : 0), 
        context: `R(${s0})→D(${s1})→G(${s2})` 
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.05, 0.95), desc: 'Morning Star confirmada - Reversión alcista fuerte' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Morning Star fallida - No confirmó' }
    })
  },

  'evening-star': {
    name: 'Estrella de la Tarde',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji middle, not needed directly) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // G + Doji/Spinning + R fuerte
      if (!(v0 === 'G' && v2 === 'R')) return null;
      if (!(s0 >= 2 && s1 <= 1.5 && s2 >= 2.5)) return null;
      return { 
        strength: 0.85 + (s2 === 4 ? 0.08 : 0), 
        context: `G(${s0})→D(${s1})→R(${s2})` 
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Evening Star fallida - No confirmó' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.05, 0.95), desc: 'Evening Star confirmada - Reversión bajista fuerte' }
    })
  },

  'three-soldiers': {
    name: 'Tres Soldados Blancos',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // GGG con cuerpos crecientes o estables, todos fuertes
      if (!(v0 === 'G' && v1 === 'G' && v2 === 'G')) return null;
      if (!(s0 >= 2.5 && s1 >= 2.5 && s2 >= 2.5)) return null;
      // Momentum creciente o estable
      const progression = s2 >= s1;
      return { 
        strength: 0.75 + (progression ? 0.05 : 0), 
        context: `G(${s0})→G(${s1})→G(${s2})` 
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: '3 Soldados - Continuación alcista' },
      ifR: { sig: 'VENTA', conf: conf * 1.10, desc: '3 Soldados anulados - Reversión inmediata' }
    })
  },

  'three-crows': {
    name: 'Tres Cuervos Negros',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // RRR con cuerpos fuertes
      if (!(v0 === 'R' && v1 === 'R' && v2 === 'R')) return null;
      if (!(s0 >= 2.5 && s1 >= 2.5 && s2 >= 2.5)) return null;
      return { 
        strength: 0.75 + (s2 > s1 ? 0.05 : 0), 
        context: `R(${s0})→R(${s1})→R(${s2})` 
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.10, desc: '3 Cuervos anulados - Reversión inmediata' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: '3 Cuervos - Continuación bajista' }
    })
  },

  'three-outside-up': {
    name: 'Tres Afuera Alcista',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // R + G engulfing + G confirmando
      if (!(v0 === 'R' && v1 === 'G' && v2 === 'G')) return null;
      // Segunda G debe ser engulfing de la R (fuerza alta)
      if (!(s1 >= 3 && s0 <= 2.5 && s2 >= 2)) return null;
      return { strength: 0.80, context: `R(${s0})→G(${s1})→G(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.08, desc: '3 Outside Up confirmado' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Confirmación fallida' }
    })
  },

  'three-outside-down': {
    name: 'Tres Afuera Bajista',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // G + R engulfing + R confirmando
      if (!(v0 === 'G' && v1 === 'R' && v2 === 'R')) return null;
      if (!(s1 >= 3 && s0 <= 2.5 && s2 >= 2)) return null;
      return { strength: 0.80, context: `G(${s0})→R(${s1})→R(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Confirmación fallida' },
      ifR: { sig: 'VENTA', conf: conf * 1.08, desc: '3 Outside Down confirmado' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES DE DOJI ESPECIALIZADOS (3 velas)
  // ═══════════════════════════════════════════════════════════

  'doji-star-bullish': {
    name: 'Estrella Doji Alcista',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji, checked via s1) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2; // Doji = 1
      const s2 = getCandleStrength(idx) || 2;
      // R + Doji puro + G
      if (!(v0 === 'R' && v2 === 'G')) return null;
      if (!(s1 === 1 && s0 >= 2 && s2 >= 2.5)) return null;
      return { strength: 0.82, context: `R(${s0})→DOJI→G(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: 'Doji Star alcista confirmada' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Doji Star fallida' }
    })
  },

  'doji-star-bearish': {
    name: 'Estrella Doji Bajista',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji, checked via s1) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // G + Doji puro + R
      if (!(v0 === 'G' && v2 === 'R')) return null;
      if (!(s1 === 1 && s0 >= 2 && s2 >= 2.5)) return null;
      return { strength: 0.82, context: `G(${s0})→DOJI→R(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Doji Star fallida' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'Doji Star bajista confirmada' }
    })
  },

  'abandoned-baby-bullish': {
    name: 'Bebé Abandonado Alcista',
    priority: 4, // Máxima prioridad, raro pero muy confiable
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji, checked via s1) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // R fuerte + Doji 4-precios aislado + G fuerte (gap implícito por fuerza)
      if (!(v0 === 'R' && v2 === 'G')) return null;
      // Doji perfecto (1) rodeado de fuerza
      if (!(s0 >= 3 && s1 === 1 && s2 >= 3)) return null;
      return { strength: 0.90, context: `R(${s0})→DOJI-PERFECTO→G(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.95, desc: 'Abandoned Baby - Reversión alcista EXTREMA' },
      ifR: { sig: 'ESPERAR', conf: 0.45, desc: 'Patrón raro fallido' }
    })
  },

  'abandoned-baby-bearish': {
    name: 'Bebé Abandonado Bajista',
    priority: 4,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], /* v1 = hist[idx-1] (doji, checked via s1) */ v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      if (!(v0 === 'G' && v2 === 'R')) return null;
      if (!(s0 >= 3 && s1 === 1 && s2 >= 3)) return null;
      return { strength: 0.90, context: `G(${s0})→DOJI-PERFECTO→R(${s2})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.45, desc: 'Patrón raro fallido' },
      ifR: { sig: 'VENTA', conf: 0.95, desc: 'Abandoned Baby - Reversión bajista EXTREMA' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES DE 4 VELAS (Continuación, alta confianza)
  // ═══════════════════════════════════════════════════════════

  'rising-three': {
    name: 'Tres Métodos Alcistas',
    priority: 3,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G fuerte + R débil + R débil + R débil + G fuerte (5 velas, simplificado a 4)
      // Patrón: G + [R/G mix débiles] + G fuerte
      if (!(v[0] === 'G' && v[3] === 'G')) return null;
      if (!(s[0] >= 3 && s[3] >= 3)) return null;
      // Las del medio deben ser débiles (consolidación)
      const middleWeak = s[1] <= 2 && s[2] <= 2;
      if (!middleWeak) return null;
      return { strength: 0.78, context: `G(${s[0]})→débil→débil→G(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.08, desc: 'Rising Three - Continuación poderosa' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Patrón de continuación fallido' }
    })
  },

  'falling-three': {
    name: 'Tres Métodos Bajistas',
    priority: 3,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R fuerte + débiles + R fuerte
      if (!(v[0] === 'R' && v[3] === 'R')) return null;
      if (!(s[0] >= 3 && s[3] >= 3)) return null;
      const middleWeak = s[1] <= 2 && s[2] <= 2;
      if (!middleWeak) return null;
      return { strength: 0.78, context: `R(${s[0]})→débil→débil→R(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Patrón de continuación fallido' },
      ifR: { sig: 'VENTA', conf: conf * 1.08, desc: 'Falling Three - Continuación poderosa' }
    })
  },

  'mat-hold-bullish': {
    name: 'Mat Hold Alcista',
    priority: 3,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G fuerte + R pequeña + R pequeña + G fuerte
      if (!(v[0] === 'G' && v[1] === 'R' && v[2] === 'R' && v[3] === 'G')) return null;
      if (!(s[0] >= 3 && s[1] <= 2 && s[2] <= 2 && s[3] >= 3)) return null;
      return { strength: 0.75, context: `G(${s[0]})→R(${s[1]})→R(${s[2]})→G(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: 'Mat Hold - Continuación alcista' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Mat Hold fallido' }
    })
  },

  'mat-hold-bearish': {
    name: 'Mat Hold Bajista',
    priority: 3,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R fuerte + G pequeña + G pequeña + R fuerte
      if (!(v[0] === 'R' && v[1] === 'G' && v[2] === 'G' && v[3] === 'R')) return null;
      if (!(s[0] >= 3 && s[1] <= 2 && s[2] <= 2 && s[3] >= 3)) return null;
      return { strength: 0.75, context: `R(${s[0]})→G(${s[1]})→G(${s[2]})→R(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Mat Hold fallido' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'Mat Hold - Continuación bajista' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES DE DOBLE TECHO/SUELO (4 velas)
  // ═══════════════════════════════════════════════════════════

  'double-bottom': {
    name: 'Doble Suelo',
    priority: 4,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R + G + R (similar fuerza a primera) + G fuerte (ruptura)
      if (!(v[0] === 'R' && v[1] === 'G' && v[2] === 'R' && v[3] === 'G')) return null;
      // Dos mínimos similares (fuerzas similares en R)
      const similarLows = Math.abs(s[0] - s[2]) <= 0.5;
      const strongBounce = s[1] >= 2;
      const strongBreak = s[3] >= 3;
      if (!(similarLows && strongBounce && strongBreak)) return null;
      return { strength: 0.82, context: `R(${s[0]})→G(${s[1]})→R(${s[2]})→G(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: 'Doble suelo confirmado - Ruptura alcista' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Doble suelo fallido' }
    })
  },

  'double-top': {
    name: 'Doble Techo',
    priority: 4,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G + R + G (similar) + R fuerte
      if (!(v[0] === 'G' && v[1] === 'R' && v[2] === 'G' && v[3] === 'R')) return null;
      const similarHighs = Math.abs(s[0] - s[2]) <= 0.5;
      const strongDrop = s[1] >= 2;
      const strongBreak = s[3] >= 3;
      if (!(similarHighs && strongDrop && strongBreak)) return null;
      return { strength: 0.82, context: `G(${s[0]})→R(${s[1]})→G(${s[2]})→R(${s[3]})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Doble techo fallido' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'Doble techo confirmado - Ruptura bajista' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES DE VENTANA (GAP) - Simulado con fuerza
  // ═══════════════════════════════════════════════════════════

  'window-up': {
    name: 'Ventana Alcista',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Dos velas verdes fuertes consecutivas, segunda más fuerte (simula gap)
      if (!(prev === 'G' && curr === 'G')) return null;
      if (!(prevS >= 3 && currS >= 3 && currS > prevS)) return null;
      return { strength: 0.70, context: `G(${prevS})→G+(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: 'Ventana alcista - Momentum explosivo' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.65, desc: 'Ventana cerrada - Precaución' }
    })
  },

  'window-down': {
    name: 'Ventana Bajista',
    priority: 2,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (!(prev === 'R' && curr === 'R')) return null;
      if (!(prevS >= 3 && currS >= 3 && currS > prevS)) return null;
      return { strength: 0.70, context: `R(${prevS})→R+(${currS})` };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.65, desc: 'Ventana cerrada - Precaución' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'Ventana bajista - Momentum explosivo' }
    })
  },

  // ═══════════════════════════════════════════════════════════
  // PATRONES CLÁSICOS ORIGINALES (mantenidos para compatibilidad)
  // ═══════════════════════════════════════════════════════════

  'simple-continuation': {
    name: 'Continuación Simple',
    priority: 0, // Baja prioridad, fallback
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      // Dos iguales seguidas, sin fuerza especial
      if (prev !== curr) return null;
      return { strength: 0.55, context: `${prev}→${curr}` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.60, desc: 'Continuación alcista simple' },
      ifR: { sig: 'VENTA', conf: 0.60, desc: 'Continuación bajista simple' }
    })
  },

  'simple-reversal': {
    name: 'Reversión Simple',
    priority: 0,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      if (prev === curr) return null;
      // Dos diferentes, sin fuerza especial
      return { strength: 0.50, context: `${prev}→${curr}` };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.55, desc: 'Reversión alcista simple' },
      ifR: { sig: 'VENTA', conf: 0.55, desc: 'Reversión bajista simple' }
    })
  }
};

// =======================================================  NUEVA CONFIGURACIÓN =============================================================================

// ═══════════════════════════════════════════════════════════
// PATRONES ADICIONALES - SINGLE CANDLE (1 VELA)
// ═══════════════════════════════════════════════════════════

const SINGLE_CANDLE_PATTERNS = {
  'hammer': {
    name: 'Martillo Alcista',
    priority: 3,
    minVelas: 1,
    // Requiere: R previa + G con mecha inferior larga (simulada por fuerza 2-2.5 tras caída)
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Debe haber caída previa (R) y ahora G con fuerza media-alta (martillo)
      if (prev !== 'R' || curr !== 'G') return null;
      // Martillo: aparece tras caída, cuerpo pequeño-medio con "cola" (simulado por fuerza 2-2.5)
      // y contexto de sobreventa implícito
      if (!(prevS >= 2 && currS >= 2 && currS <= 2.5)) return null;
      // Al menos 2 rojas previas para contexto de caída
      let consecReds = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      if (consecReds < 2) return null;
      return {
        strength: 0.78 + (consecReds >= 3 ? 0.07 : 0),
        context: `↓${consecReds}→Hammer-G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.12, 0.95), desc: 'Martillo confirmado - Reversión alcista desde soporte' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Martillo fallido - Continúa bajista' }
    })
  },

  'inverted-hammer': {
    name: 'Martillo Invertido',
    priority: 3,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Similar al martillo pero con "mecha superior" (misma lógica, diferente contexto visual)
      if (prev !== 'R' || curr !== 'G') return null;
      if (!(prevS >= 2 && currS >= 1.5 && currS <= 2.5)) return null;
      let consecReds = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      if (consecReds < 2) return null;
      // Diferencia: fuerza ligeramente menor (mecha arriba = menos compromiso alcista inicial)
      return {
        strength: 0.72 + (consecReds >= 3 ? 0.06 : 0),
        context: `↓${consecReds}→InvHammer-G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.08, 0.92), desc: 'Martillo invertido confirmado - Reversión alcista' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Inv. Hammer fallido' }
    })
  },

  'hanging-man': {
    name: 'Hombre Colgado',
    priority: 3,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Tras subida (G), aparece G débil con "cola" = agotamiento alcista
      if (prev !== 'G' || curr !== 'G') return null;
      // Fuerza débil a media (1.5-2.5) tras al menos 2 verdes
      if (!(currS <= 2.5 && currS >= 1.5)) return null;
      let consecGreens = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      if (consecGreens < 2) return null;
      // Verificar que hay momentum alcista previo (no aparece en tendencia bajista)
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA < 60) return null; // Solo en tendencia alcista establecida
      return {
        strength: 0.75 + (consecGreens >= 4 ? 0.08 : 0),
        context: `↑${consecGreens}→HangMan-G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.45, desc: 'Hombre colgado no confirmado - aún alcista' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.15, 0.95), desc: 'Hombre colgado CONFIRMADO - Reversión bajista fuerte' }
    })
  },

  'shooting-star': {
    name: 'Estrella Fugaz',
    priority: 3,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Tras subida, aparece R con mecha superior (fuerza media, no capitulación)
      if (prev !== 'G' || curr !== 'R') return null;
      // Fuerza 2-2.5: rechazo en techo pero no venta masiva aún
      if (!(currS >= 2 && currS <= 2.5)) return null;
      let consecGreens = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      if (consecGreens < 2) return null;
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA < 55) return null;
      return {
        strength: 0.78 + (consecGreens >= 4 ? 0.07 : 0),
        context: `↑${consecGreens}→ShootStar-R(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.40, desc: 'Estrella fugaz fallida' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.18, 0.95), desc: 'Estrella fugaz CONFIRMADA - Reversión bajista' }
    })
  },

  'dragonfly-doji': {
    name: 'Doji Libélula',
    priority: 4, // Alta prioridad por ser raro y confiable
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const currS = getCandleStrength(idx) || 2;
      // Doji perfecto (fuerza 1) tras caída = rechazo extremo desde abajo
      if (currS !== 1) return null;
      // Contexto: tras caída (R) o en sobreventa
      let consecReds = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      const trendMA = calcMA(10, true);
      const isOversold = trendMA !== null && trendMA <= 25;
      if (!(consecReds >= 2 || isOversold)) return null;
      // La vela actual puede ser G o R (doji es equilibrio), pero prev debe ser R
      if (prev !== 'R') return null;
      return {
        strength: 0.88 + (consecReds >= 3 ? 0.05 : 0) + (isOversold ? 0.04 : 0),
        context: `↓${consecReds}→Dragonfly-Doji`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.95, desc: 'Dragonfly Doji confirmado - Reversión alcista EXTREMA' },
      ifR: { sig: 'ESPERAR', conf: 0.50, desc: 'Doji no resuelto - esperar siguiente vela' }
    })
  },

  'gravestone-doji': {
    name: 'Doji Lápida',
    priority: 4,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const currS = getCandleStrength(idx) || 2;
      // Doji perfecto tras subida = rechazo extremo desde arriba
      if (currS !== 1) return null;
      let consecGreens = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      const trendMA = calcMA(10, true);
      const isOverbought = trendMA !== null && trendMA >= 75;
      if (!(consecGreens >= 2 || isOverbought)) return null;
      if (prev !== 'G') return null;
      return {
        strength: 0.88 + (consecGreens >= 3 ? 0.05 : 0) + (isOverbought ? 0.04 : 0),
        context: `↑${consecGreens}→Gravestone-Doji`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.50, desc: 'Doji no resuelto - esperar siguiente vela' },
      ifR: { sig: 'VENTA', conf: 0.95, desc: 'Gravestone Doji confirmado - Reversión bajista EXTREMA' }
    })
  },

  'long-legged-doji': {
    name: 'Doji Piernas Largas',
    priority: 2,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const currS = getCandleStrength(idx) || 2;
      // Doji sesgado (1.5) con alta volatilidad previa = máxima indecisión
      if (currS !== 1.5) return null;
      // Contexto: alta volatilidad previa (fuerzas altas en velas anteriores)
      const prevS = getCandleStrength(idx-1) || 2;
      const prev2S = getCandleStrength(idx-2) || 2;
      if (!(prevS >= 2.5 || prev2S >= 2.5)) return null;
      return {
        strength: 0.65,
        context: `Volatil→LongLeg-Doji`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Máxima indecisión - esperar ruptura' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Máxima indecisión - esperar ruptura' }
    })
  },

        'belt-hold-bullish': {
        name: 'Belt Hold Alcista',
        priority: 3,
        minVelas: 1,
        detect: (hist, idx) => {
          if (hist.length < 2 || idx < 1) return null;
          const prev = hist[idx-1], curr = hist[idx];
          const currS = getCandleStrength(idx) || 2;
          
          // G fuerte (3-4) que "sostiene" tras caída
          if (prev !== 'R' || curr !== 'G') return null;
          if (!(currS >= 3)) return null;
          
          // CONTAR TODAS LAS ROJAS PREVIAS CONSECUTIVAS (no solo 2)
          let consecReds = 0;
          let totalRedStrength = 0;
          for (let i = idx - 1; i >= 0 && hist[i] === 'R'; i--) {
            consecReds++;
            totalRedStrength += getCandleStrength(i) || 2;
          }
          
          // REQUERIR MÍNIMO 3 ROJAS para considerarlo reversión válida
          // Si hay menos, es debilitamiento, no capitulación
          if (consecReds < 3) return null;
          
          // Calcular fuerza promedio de las rojas previas
          const avgRedStrength = totalRedStrength / consecReds;
          
          // Si las rojas eran DÉBILES (fuerza < 2.5), es Bear Trap, no Belt Hold
          // Esto es lo que pasa en tu caso: R🔥(4) + R▰▰▰(3) + R▰(1) + R▰(1) = promedio ~2.25
          if (avgRedStrength < 2.0 && consecReds >= 4) {
            return {
              strength: 0.45,  // Baja confianza - posible trampa
              context: `↓${consecReds}→BeltHold-G(${currS})-WEAK`,
              isTrap: true,     // Flag para lógica posterior
              trapReason: 'Capitulación previa débil - posible Bear Trap'
            };
          }
          
          // Si hay 4+ rojas con fuerza mixta, requerir confirmación
          if (consecReds >= 4 && avgRedStrength < 2.5) {
            return {
              strength: 0.55,  // Media confianza - esperar confirmación
              context: `↓${consecReds}→BeltHold-G(${currS})-UNCONFIRMED`,
              needsConfirmation: true,
              confirmationReason: 'Secuencia larga con debilitamiento previo'
            };
          }
          
          // Caso ideal: 3 rojas fuertes seguidas de G fuerte
          return {
            strength: 0.82,
            context: `↓${consecReds}→BeltHold-G(${currS})`
          };
        },
        project: (conf, detectionData) => {
          // Si es trampa, proyectar espera
          if (detectionData?.isTrap) {
            return {
              ifG: { sig: 'ESPERAR', conf: 0.45, desc: 'Belt Hold en zona de trampa - NO comprar' },
              ifR: { sig: 'ESPERAR', conf: 0.55, desc: 'Confirmación de trampa bajista' }
            };
          }
          // Si necesita confirmación
          if (detectionData?.needsConfirmation) {
            return {
              ifG: { sig: 'ESPERAR', conf: 0.60, desc: 'Belt Hold alcista - Esperar segunda vela verde' },
              ifR: { sig: 'VENTA', conf: 0.70, desc: 'Belt Hold fallido - Continuación bajista' }
            };
          }
          // Caso normal
          return {
            ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.08, 0.95), desc: 'Belt Hold alcista - Reversión poderosa' },
            ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Belt Hold fallido' }
          };
        }
      },

  'belt-hold-bearish': {
    name: 'Belt Hold Bajista',
    priority: 3,
    minVelas: 1,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const currS = getCandleStrength(idx) || 2;
      if (prev !== 'G' || curr !== 'R') return null;
      if (!(currS >= 3)) return null;
      let consecGreens = 0;
      for (let i = idx - 1; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      if (consecGreens < 2) return null;
      return {
        strength: 0.82,
        context: `↑${consecGreens}→BeltHold-R(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Belt Hold fallido' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.08, 0.95), desc: 'Belt Hold bajista - Reversión poderosa' }
    })
  }
};

// ═══════════════════════════════════════════════════════════
// PATRONES ADICIONALES - 2 VELAS
// ═══════════════════════════════════════════════════════════

const TWO_CANDLE_PATTERNS = {
  'tweezer-tops': {
    name: 'Pinzas Techo',
    priority: 4,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // Dos máximos similares: G fuerte seguida de R que "pinza" el mismo nivel
      // Simulado por: G fuerza 2.5-3 seguida de R fuerza similar (rechazo doble)
      if (!(prev === 'G' && curr === 'R')) return null;
      if (!(prevS >= 2.5 && currS >= 2 && Math.abs(prevS - currS) <= 0.5)) return null;
      // Contexto alcista previo
      let consecGreens = 0;
      for (let i = idx - 2; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      if (consecGreens < 1) return null;
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA < 60) return null;
      return {
        strength: 0.85,
        context: `↑${consecGreens+1}→TweezerTop G(${prevS})-R(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.45, desc: 'Pinzas no confirmadas' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.12, 0.95), desc: 'Pinzas techo CONFIRMADAS - Doble rechazo' }
    })
  },

  'tweezer-bottoms': {
    name: 'Pinzas Suelo',
    priority: 4,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R seguida de G en mismo "suelo"
      if (!(prev === 'R' && curr === 'G')) return null;
      if (!(prevS >= 2.5 && currS >= 2 && Math.abs(prevS - currS) <= 0.5)) return null;
      let consecReds = 0;
      for (let i = idx - 2; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      if (consecReds < 1) return null;
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA > 40) return null;
      return {
        strength: 0.85,
        context: `↓${consecReds+1}→TweezerBot R(${prevS})-G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.12, 0.95), desc: 'Pinzas suelo CONFIRMADAS - Doble rechazo' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.45, desc: 'Pinzas no confirmadas' }
    })
  },

  'harami-cross-bullish': {
    name: 'Harami Cross Alcista',
    priority: 4, // Más fuerte que Harami normal
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte + Doji perfecto (fuerza 1) = Harami Cross
      if (!(prev === 'R' && curr === 'G')) return null; // Doji puede ser G o R, usamos G como "doji alcista"
      if (!(prevS >= 3 && currS === 1)) return null;
      return {
        strength: 0.88,
        context: `R(${prevS})→DojiCross-G(1)`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.95, desc: 'Harami Cross confirmado - Reversión alcista muy fuerte' },
      ifR: { sig: 'ESPERAR', conf: 0.40, desc: 'Harami Cross fallido' }
    })
  },

  'harami-cross-bearish': {
    name: 'Harami Cross Bajista',
    priority: 4,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (!(prev === 'G' && curr === 'R')) return null;
      if (!(prevS >= 3 && currS === 1)) return null;
      return {
        strength: 0.88,
        context: `G(${prevS})→DojiCross-R(1)`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.40, desc: 'Harami Cross fallido' },
      ifR: { sig: 'VENTA', conf: 0.95, desc: 'Harami Cross confirmado - Reversión bajista muy fuerte' }
    })
  },

  'kicker-bullish': {
    name: 'Kicker Alcista',
    priority: 5, // Máxima prioridad - muy potente
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      // Patrón: R + (doji/debil) + G FUERTE = gap up simulado por momentum explosivo
      // O versión simple: R fuerte seguida INMEDIATAMENTE de G muy fuerte (sin consolidación)
      if (!(v0 === 'R' && v1 === 'R' && v2 === 'G')) return null;
      // La segunda R debe ser débil (pausa) y la G explosiva
      if (!(s0 >= 2.5 && s1 <= 2 && s2 >= 3.5)) return null;
      // Gap implícito: fuerza 4 en G tras debilidad = gap
      return {
        strength: 0.92,
        context: `R(${s0})→R-weak(${s1})→Kicker-G(${s2})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.97, desc: 'Kicker alcista - Gap explosivo confirmado' },
      ifR: { sig: 'ESPERAR', conf: 0.35, desc: 'Kicker fallido - anomalía rara' }
    })
  },

  'kicker-bearish': {
    name: 'Kicker Bajista',
    priority: 5,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v0 = hist[idx-2], v1 = hist[idx-1], v2 = hist[idx];
      const s0 = getCandleStrength(idx-2) || 2;
      const s1 = getCandleStrength(idx-1) || 2;
      const s2 = getCandleStrength(idx) || 2;
      if (!(v0 === 'G' && v1 === 'G' && v2 === 'R')) return null;
      if (!(s0 >= 2.5 && s1 <= 2 && s2 >= 3.5)) return null;
      return {
        strength: 0.92,
        context: `G(${s0})→G-weak(${s1})→Kicker-R(${s2})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.35, desc: 'Kicker fallido - anomalía rara' },
      ifR: { sig: 'VENTA', conf: 0.97, desc: 'Kicker bajista - Gap explosivo confirmado' }
    })
  },

  'tasuki-gap-up': {
    name: 'Tasuki Gap Alcista',
    priority: 2,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G + G (gap simulado por fuerza creciente) + R que NO cierra gap
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'R')) return null;
      // Gap: segunda G más fuerte que primera
      if (!(s[1] > s[0] && s[0] >= 2.5)) return null;
      // R de "tasuki" no debe ser fuerte (no cierra el gap)
      if (!(s[2] <= 2)) return null;
      return {
        strength: 0.68,
        context: `G(${s[0]})→GapG(${s[1]})→Tasuki-R(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.05, desc: 'Tasuki gap - Continuación alcista' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.65, desc: 'Gap cerrado - precaución' }
    })
  },

  'tasuki-gap-down': {
    name: 'Tasuki Gap Bajista',
    priority: 2,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'G')) return null;
      if (!(s[1] > s[0] && s[0] >= 2.5)) return null;
      if (!(s[2] <= 2)) return null;
      return {
        strength: 0.68,
        context: `R(${s[0]})→GapR(${s[1]})→Tasuki-G(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.65, desc: 'Gap cerrado - precaución' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'Tasuki gap - Continuación bajista' }
    })
  }
};

// ═══════════════════════════════════════════════════════════
// PATRONES ADICIONALES - 3+ VELAS
// ═══════════════════════════════════════════════════════════

const THREE_CANDLE_PATTERNS = {
  'three-inside-up': {
    name: 'Three Inside Up',
    priority: 4,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R + G dentro de R (Harami) + G confirma = Three Inside Up
      if (!(v[0] === 'R' && v[1] === 'G' && v[2] === 'G')) return null;
      // Segunda G debe ser más débil que R (Harami)
      if (!(s[0] >= 2.5 && s[1] < s[0] && s[2] >= 2.5)) return null;
      // Tercera G confirma con fuerza
      return {
        strength: 0.85,
        context: `R(${s[0]})→HaramiG(${s[1]})→ConfirmG(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.08, 0.95), desc: 'Three Inside Up confirmado - Reversión alcista fuerte' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Confirmación fallida' }
    })
  },

  'three-inside-down': {
    name: 'Three Inside Down',
    priority: 4,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'G' && v[1] === 'R' && v[2] === 'R')) return null;
      if (!(s[0] >= 2.5 && s[1] < s[0] && s[2] >= 2.5)) return null;
      return {
        strength: 0.85,
        context: `G(${s[0]})→HaramiR(${s[1]})→ConfirmR(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Confirmación fallida' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.08, 0.95), desc: 'Three Inside Down confirmado - Reversión bajista fuerte' }
    })
  },

  'three-line-strike-bullish': {
    name: 'Three Line Strike Alcista',
    priority: 4,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // RRR + G que "borra" las 3 rojas (engulfing de 3 velas)
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R' && v[3] === 'G')) return null;
      // Las 3 rojas deben ser fuertes (tendencia bajista clara)
      if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] >= 2.5)) return null;
      // La G debe ser EXTREMA (fuerza 4) para "borrar" todo
      if (!(s[3] >= 4)) return null;
      return {
        strength: 0.90,
        context: `RRR(${s[0]},${s[1]},${s[2]})→StrikeG(${s[3]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.97, desc: 'Three Line Strike - Reversión alcista MUY fuerte' },
      ifR: { sig: 'ESPERAR', conf: 0.40, desc: 'Strike fallido - anomalía' }
    })
  },

  'three-line-strike-bearish': {
    name: 'Three Line Strike Bajista',
    priority: 4,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G' && v[3] === 'R')) return null;
      if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] >= 2.5)) return null;
      if (!(s[3] >= 4)) return null;
      return {
        strength: 0.90,
        context: `GGG(${s[0]},${s[1]},${s[2]})→StrikeR(${s[3]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.40, desc: 'Strike fallido - anomalía' },
      ifR: { sig: 'VENTA', conf: 0.97, desc: 'Three Line Strike - Reversión bajista MUY fuerte' }
    })
  },

  'advance-block': {
    name: 'Advance Block',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // GGG pero con fuerza DECRECIENTE + mechas crecientes (simulado por fuerza decreciente)
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G')) return null;
      // Fuerza decreciente: 3 → 2.5 → 2 (o similar)
      if (!(s[0] >= 3 && s[1] >= 2 && s[1] < s[0] && s[2] >= 1.5 && s[2] < s[1])) return null;
      // Contexto: tendencia alcista previa establecida
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA < 60) return null;
      return {
        strength: 0.75,
        context: `WeakGGG(${s[0]}→${s[1]}→${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Advance Block - Agotamiento alcista, próxima R vendrá' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.15, 0.95), desc: 'Advance Block confirmado - Reversión bajista' }
    })
  },

  'deliberation': {
    name: 'Deliberación',
    priority: 2,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G + G + Doji/Debil = pausa en tendencia
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G')) return null;
      // Dos primeras fuertes, tercera muy débil (doji)
      if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] <= 1.5)) return null;
      return {
        strength: 0.68,
        context: `GG(${s[0]},${s[1]})→DelibG(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Deliberación - Pausa, esperar dirección' },
      ifR: { sig: 'VENTA', conf: conf * 1.10, desc: 'Deliberación resuelta bajista' }
    })
  },

    'identical-three-crows': {
      name: 'Tres Cuervos Idénticos',
      priority: 4,
      minVelas: 3,
      detect: (hist, idx) => {
        if (hist.length < 3 || idx < 2) return null;
        
        // LAS 3 VELAS DEBEN SER CONSECUTIVAS E INMEDIATAMENTE ANTERIORES
        const v = [hist[idx-2], hist[idx-1], hist[idx]];
        
        // TODAS deben ser R (no solo las 3 primeras que encuentre)
        if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R')) return null;
        
        const s = [
          getCandleStrength(idx-2) || 2,
          getCandleStrength(idx-1) || 2,
          getCandleStrength(idx) || 2
        ];
        
        // TODAS deben ser fuertes (>= 2.5)
        if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] >= 2.5)) return null;
        
        // FUERZAS CASI IDÉNTICAS (diferencia máx 0.5)
        const maxDiff = Math.max(Math.abs(s[0]-s[1]), Math.abs(s[1]-s[2]), Math.abs(s[0]-s[2]));
        if (maxDiff > 0.5) return null;
        
        // VERIFICAR: No debe haber velas verdes en las últimas 3
        // (Este check es redundante pero explícito)
        const lastThreeColors = hist.slice(-3);
        const allRed = lastThreeColors.every(c => c === 'R');
        if (!allRed) return null;  // ← ESTO FALLABA EN TU CASO
        
        return {
          strength: 0.88,
          context: `Idént-RRR(${s[0]},${s[1]},${s[2]})`
        };
      },
      project: (conf) => ({
        ifG: { sig: 'COMPRA', conf: conf * 1.12, desc: 'Cuervos idénticos anulados - Reversión violenta' },
        ifR: { sig: 'VENTA', conf: Math.min(conf * 1.05, 0.95), desc: 'Cuervos idénticos - Continuación bajista extrema' }
      })
    },

  'concealed-baby-swallow': {
    name: 'Concealed Baby Swallow',
    priority: 5, // Muy raro pero muy confiable
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 4 || idx < 3) return null;
      const v = [hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R fuerte + R dentro de primera (Harami bajista) + dos R que "tragan" todo
      // RR + "engulfing" de las 2 primeras por las 2 últimas
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R' && v[3] === 'R')) return null;
      // Primera R fuerte, segunda R débil (Harami), tercera y cuarta fuertes
      if (!(s[0] >= 3 && s[1] <= 2 && s[2] >= 3 && s[3] >= 3)) return null;
      // Contexto: sobreventa extrema
      const trendMA = calcMA(10, true);
      if (trendMA !== null && trendMA > 30) return null;
      return {
        strength: 0.92,
        context: `Concealed-Swallow(${s[0]},${s[1]},${s[2]},${s[3]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.97, desc: 'Concealed Baby Swallow - Reversión alcista EXTREMA (raro)' },
      ifR: { sig: 'ESPERAR', conf: 0.35, desc: 'Patrón raro fallido' }
    })
  },

  'stick-sandwich': {
    name: 'Stick Sandwich',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R + G + R con mismos niveles (simulado por fuerzas similares)
      if (!(v[0] === 'R' && v[1] === 'G' && v[2] === 'R')) return null;
      // Fuerzas similares en las R, G débil en medio
      if (!(Math.abs(s[0] - s[2]) <= 0.5 && s[1] <= 2 && s[0] >= 2.5)) return null;
      return {
        strength: 0.78,
        context: `Sandwich-R(${s[0]})G(${s[1]})R(${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.10, 0.95), desc: 'Stick Sandwich - Soporte confirmado' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'Sandwich fallido' }
    })
  },

  'homing-pigeon': {
    name: 'Paloma Mensajera',
    priority: 3,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R + G dentro de R, ambas con cuerpos reales (no doji)
      if (!(prev === 'R' && curr === 'G')) return null;
      // R fuerte, G más débil pero con cuerpo real (1.5-2.5)
      if (!(prevS >= 2.5 && currS >= 1.5 && currS <= 2.5 && currS < prevS)) return null;
      // Contexto: tendencia bajista previa
      let consecReds = 0;
      for (let i = idx - 2; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      if (consecReds < 1) return null;
      return {
        strength: 0.72,
        context: `↓${consecReds+1}→HomingPigeon R(${prevS})→G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.12, 0.92), desc: 'Paloma mensajera - Reversión alcista probable' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Paloma no confirmada' }
    })
  }
};

// ═══════════════════════════════════════════════════════════
// PATRONES ADICIONALES - GAPS E ISLAS
// ═══════════════════════════════════════════════════════════

const GAP_PATTERNS = {
  'island-reversal-bullish': {
    name: 'Isla de Reversión Alcista',
    priority: 5, // Máxima prioridad
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      // Secuencia: caída + gap down + "isla" + gap up + alza
      // Simulado: R fuertes + R muy débil (isla) + G explosiva
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R + R + Doji/Isla + G + G (la isla es la vela del medio, aislada)
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R' && v[3] === 'G' && v[4] === 'G')) return null;
      // "Isla": vela débil rodeada de fuerza (gap implícito por cambio drástico)
      if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] <= 1.5 && s[3] >= 3 && s[4] >= 2.5)) return null;
      return {
        strength: 0.95,
        context: `Island-Rev↑(${s[0]},${s[1]},${s[2]},${s[3]},${s[4]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.98, desc: 'Isla de reversión ALCISTA - Gap + Gap opuesto confirmado' },
      ifR: { sig: 'ESPERAR', conf: 0.30, desc: 'Isla fallida - patrón raro invalidado' }
    })
  },

  'island-reversal-bearish': {
    name: 'Isla de Reversión Bajista',
    priority: 5,
    minVelas: 4,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G' && v[3] === 'R' && v[4] === 'R')) return null;
      if (!(s[0] >= 2.5 && s[1] >= 2.5 && s[2] <= 1.5 && s[3] >= 3 && s[4] >= 2.5)) return null;
      return {
        strength: 0.95,
        context: `Island-Rev↓(${s[0]},${s[1]},${s[2]},${s[3]},${s[4]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.30, desc: 'Isla fallida - patrón raro invalidado' },
      ifR: { sig: 'VENTA', conf: 0.98, desc: 'Isla de reversión BAJISTA - Gap + Gap opuesto confirmado' }
    })
  },

  'breakaway-bullish': {
    name: 'Breakaway Alcista',
    priority: 4,
    minVelas: 5,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // R fuerte + gap (R débil) + R + G que rompe
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R' && v[3] === 'R' && v[4] === 'G')) return null;
      // Primera R fuerte, segunda débil (gap), tercera continúa, cuarta G rompe
      if (!(s[0] >= 3 && s[1] <= 2 && s[2] >= 2 && s[3] >= 2.5 && s[4] >= 3)) return null;
      return {
        strength: 0.88,
        context: `Breakaway↑(${s[0]},${s[1]},${s[2]},${s[3]},${s[4]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.95, desc: 'Breakaway alcista - Reversión desde gap de agotamiento' },
      ifR: { sig: 'ESPERAR', conf: 0.40, desc: 'Breakaway fallido' }
    })
  },

  'breakaway-bearish': {
    name: 'Breakaway Bajista',
    priority: 4,
    minVelas: 5,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G' && v[3] === 'G' && v[4] === 'R')) return null;
      if (!(s[0] >= 3 && s[1] <= 2 && s[2] >= 2 && s[3] >= 2.5 && s[4] >= 3)) return null;
      return {
        strength: 0.88,
        context: `Breakaway↓(${s[0]},${s[1]},${s[2]},${s[3]},${s[4]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.40, desc: 'Breakaway fallido' },
      ifR: { sig: 'VENTA', conf: 0.95, desc: 'Breakaway bajista - Reversión desde gap de agotamiento' }
    })
  },

  'upside-gap-three-methods': {
    name: 'Upside Gap Three Methods',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // G fuerte + G más fuerte (gap) + R que cierra parcialmente pero no del todo
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'R')) return null;
      // Gap: segunda G más fuerte
      if (!(s[1] > s[0] && s[0] >= 2.5)) return null;
      // R no debe ser fuerte (no cierra gap)
      if (!(s[2] >= 2 && s[2] < s[1])) return null;
      return {
        strength: 0.75,
        context: `Gap3Methods↑(${s[0]},${s[1]},${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: conf * 1.08, desc: 'Gap Three Methods - Continuación alcista tras cierre parcial' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Gap cerrado completamente - precaución' }
    })
  },

  'downside-gap-three-methods': {
    name: 'Downside Gap Three Methods',
    priority: 3,
    minVelas: 3,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const v = [hist[idx-2], hist[idx-1], hist[idx]];
      const s = [
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'G')) return null;
      if (!(s[1] > s[0] && s[0] >= 2.5)) return null;
      if (!(s[2] >= 2 && s[2] < s[1])) return null;
      return {
        strength: 0.75,
        context: `Gap3Methods↓(${s[0]},${s[1]},${s[2]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Gap cerrado completamente - precaución' },
      ifR: { sig: 'VENTA', conf: conf * 1.08, desc: 'Gap Three Methods - Continuación bajista tras cierre parcial' }
    })
  }
};

// ═══════════════════════════════════════════════════════════
// PATRONES ADICIONALES - OTROS AVANZADOS
// ═══════════════════════════════════════════════════════════

const ADVANCED_PATTERNS = {
  'counterattack-bullish': {
    name: 'Contraataque Alcista',
    priority: 3,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte seguida de G fuerte MISMO TAMAÑO (lucha equilibrada, gana toros)
      if (!(prev === 'R' && curr === 'G')) return null;
      if (!(prevS >= 3 && currS >= 3 && Math.abs(prevS - currS) <= 0.5)) return null;
      // Contexto: al menos una R previa más
      let consecReds = 0;
      for (let i = idx - 2; i >= 0 && hist[i] === 'R'; i--) consecReds++;
      if (consecReds < 1) return null;
      return {
        strength: 0.78,
        context: `Counter↑ R(${prevS})=G(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.10, 0.92), desc: 'Contraataque alcista - Empate resuelto al alza' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Contraataque fallido' }
    })
  },

  'counterattack-bearish': {
    name: 'Contraataque Bajista',
    priority: 3,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (!(prev === 'G' && curr === 'R')) return null;
      if (!(prevS >= 3 && currS >= 3 && Math.abs(prevS - currS) <= 0.5)) return null;
      let consecGreens = 0;
      for (let i = idx - 2; i >= 0 && hist[i] === 'G'; i--) consecGreens++;
      if (consecGreens < 1) return null;
      return {
        strength: 0.78,
        context: `Counter↓ G(${prevS})=R(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'Contraataque fallido' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.10, 0.92), desc: 'Contraataque bajista - Empate resuelto a la baja' }
    })
  },

  'on-neck': {
    name: 'On Neck',
    priority: 1,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte + G débil que cierra "en el cuello" (mismo nivel aprox)
      // Simulado: G mucho más débil que R
      if (!(prev === 'R' && curr === 'G')) return null;
      if (!(prevS >= 3 && currS <= 1.5)) return null;
      return {
        strength: 0.55,
        context: `OnNeck R(${prevS})→G-weak(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.50, desc: 'On Neck - Rebote débil, continúa bajista' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'On Neck confirmado - Continuación bajista' }
    })
  },

  'in-neck': {
    name: 'In Neck',
    priority: 1,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 2 || idx < 1) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // R fuerte + G que penetra ligeramente pero no supera
      if (!(prev === 'R' && curr === 'G')) return null;
      if (!(prevS >= 3 && currS >= 1.5 && currS <= 2)) return null;
      return {
        strength: 0.58,
        context: `InNeck R(${prevS})→G-pen(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.55, desc: 'In Neck - Penetración insuficiente' },
      ifR: { sig: 'VENTA', conf: conf * 1.05, desc: 'In Neck confirmado - Continuación bajista' }
    })
  },

  'ladder-bottom': {
    name: 'Escalera Suelo',
    priority: 4,
    minVelas: 5,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      // 5 R con mechas inferiores crecientes (simulado: fuerza decreciente = agotamiento)
      // RRRRR con s: 3 → 2.5 → 2 → 1.5 → (espera G)
      if (!(v[0] === 'R' && v[1] === 'R' && v[2] === 'R' && v[3] === 'R')) return null;
      // Fuerza decreciente progresiva
      if (!(s[0] >= 2.5 && s[1] >= 2 && s[1] <= s[0] && s[2] >= 1.5 && s[2] <= s[1] && s[3] <= 2)) return null;
      return {
        strength: 0.85,
        context: `LadderBot(${s[0]}→${s[1]}→${s[2]}→${s[3]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: 0.95, desc: 'Ladder Bottom - Suelo escalonado confirmado' },
      ifR: { sig: 'ESPERAR', conf: 0.45, desc: 'Escalera extendida - esperar' }
    })
  },

  'ladder-top': {
    name: 'Escalera Techo',
    priority: 4,
    minVelas: 5,
    detect: (hist, idx) => {
      if (hist.length < 5 || idx < 4) return null;
      const v = [
        hist[idx-4], hist[idx-3], hist[idx-2], hist[idx-1], hist[idx]
      ];
      const s = [
        getCandleStrength(idx-4) || 2,
        getCandleStrength(idx-3) || 2,
        getCandleStrength(idx-2) || 2,
        getCandleStrength(idx-1) || 2,
        getCandleStrength(idx) || 2
      ];
      if (!(v[0] === 'G' && v[1] === 'G' && v[2] === 'G' && v[3] === 'G')) return null;
      if (!(s[0] >= 2.5 && s[1] >= 2 && s[1] <= s[0] && s[2] >= 1.5 && s[2] <= s[1] && s[3] <= 2)) return null;
      return {
        strength: 0.85,
        context: `LadderTop(${s[0]}→${s[1]}→${s[2]}→${s[3]})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: 0.45, desc: 'Escalera extendida - esperar' },
      ifR: { sig: 'VENTA', conf: 0.95, desc: 'Ladder Top - Techo escalonado confirmado' }
    })
  },

  'rising-window': {
    name: 'Ventana Alcista',
    priority: 3,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      // G fuerte + G más fuerte (gap simulado) + G que no cierra gap
      if (!(prev === 'G' && curr === 'G')) return null;
      // Gap: curr más fuerte que prev, y prev ya era fuerte
      if (!(prevS >= 2.5 && currS > prevS)) return null;
      // Verificar que hay momentum previo (no es inicio de tendencia)
      const prev2 = hist[idx-2];
      const prev2S = getCandleStrength(idx-2) || 2;
      if (!(prev2 === 'G' && prev2S >= 2)) return null;
      return {
        strength: 0.78,
        context: `RisingWindow G(${prev2S})→G(${prevS})→G+(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'COMPRA', conf: Math.min(conf * 1.10, 0.95), desc: 'Rising Window - Gap alcista, no operar en contra' },
      ifR: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Ventana cerrada - precaución' }
    })
  },

  'falling-window': {
    name: 'Ventana Bajista',
    priority: 3,
    minVelas: 2,
    detect: (hist, idx) => {
      if (hist.length < 3 || idx < 2) return null;
      const prev = hist[idx-1], curr = hist[idx];
      const prevS = getCandleStrength(idx-1) || 2;
      const currS = getCandleStrength(idx) || 2;
      if (!(prev === 'R' && curr === 'R')) return null;
      if (!(prevS >= 2.5 && currS > prevS)) return null;
      const prev2 = hist[idx-2];
      const prev2S = getCandleStrength(idx-2) || 2;
      if (!(prev2 === 'R' && prev2S >= 2)) return null;
      return {
        strength: 0.78,
        context: `FallingWindow R(${prev2S})→R(${prevS})→R+(${currS})`
      };
    },
    project: (conf) => ({
      ifG: { sig: 'ESPERAR', conf: conf * 0.60, desc: 'Ventana cerrada - precaución' },
      ifR: { sig: 'VENTA', conf: Math.min(conf * 1.10, 0.95), desc: 'Falling Window - Gap bajista, no operar en contra' }
    })
  }
};

// ═══════════════════════════════════════════════════════════
// FUSIÓN DE TODOS LOS PATRONES EN PATTERN_LIBRARY
// ═══════════════════════════════════════════════════════════

// Merge todos los patrones adicionales al PATTERN_LIBRARY existente
Object.assign(PATTERN_LIBRARY, 
  SINGLE_CANDLE_PATTERNS,
  TWO_CANDLE_PATTERNS,
  THREE_CANDLE_PATTERNS,
  GAP_PATTERNS,
  ADVANCED_PATTERNS
);

console.log('📚 patterns.js cargado:', Object.keys(PATTERN_LIBRARY).length, 'patrones totales');
