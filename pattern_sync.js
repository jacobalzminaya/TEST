// ===== pattern_sync.js — Sincronización visual Patrón ↔ Acción =====
// Dependencias: update(), analyzePattern(), PATTERN_LIBRARY desde logic.js
// Cargado DESPUÉS que logic.js en index.html

  // Extensión para sincronizar visualmente patrón con acción
  (function() {
    // Esperar a que logic.js cargue
    var checkInterval = setInterval(function() {
      if (typeof update !== 'undefined' && typeof PATTERN_LIBRARY !== 'undefined') {
        clearInterval(checkInterval);
        initPatternSync();
      }
    }, 100);

    function initPatternSync() {
      // Sobrescribir analyzePattern para capturar el patrón ganador
      var originalAnalyzePattern = analyzePattern;
      
      analyzePattern = function(lastTwo, originalTwo, extremeCondition) {
        var result = originalAnalyzePattern(lastTwo, originalTwo, extremeCondition);
        
        // Guardar referencia global del patrón actual
        window.currentPatternResult = result;
        
        // Actualizar UI de patrón
        updatePatternUI(result);
        
        return result;
      };
      
      console.log('✅ Sincronización Patrón↔Acción activada');
    }

    function updatePatternUI(pattern) {
      var panel = document.getElementById('pattern-active-panel');
      var badge = document.getElementById('pattern-active-badge');
      
      if (!pattern || !pattern.patternName) {
        if (panel) panel.classList.remove('active');
        if (badge) badge.style.display = 'none';
        return;
      }
      
      // Mostrar panel — solo si el _viewState lo permite
      if (panel) {
        panel.classList.add('active', 'has-pattern');
        // NO poner display:block inline — dejar que _applyViewState lo controle
        // Si el usuario lo ocultó en el panel de VISTA, respetarlo
        if (typeof _viewState !== 'undefined' && _viewState['pattern-active-panel'] === false) {
          panel.style.removeProperty('display');
        }
      }
      
      // Actualizar badge en señal principal
      if (badge) {
        badge.style.display = 'inline-flex';
        badge.textContent = '📊 ' + pattern.patternName;
        
        // Color según prioridad
        var priority = pattern.priority || 0;
        badge.className = 'pattern-badge ' + (priority >= 4 ? 'high' : priority >= 2 ? 'medium' : 'low');
      }
      
      // Actualizar detalles del panel
      document.getElementById('pattern-name').textContent = pattern.patternName;
      
      var priorityEl = document.getElementById('pattern-priority');
      var priority = pattern.priority || 0;
      priorityEl.textContent = 'P' + priority;
      priorityEl.className = 'pattern-priority p' + priority;
      
      document.getElementById('pattern-context').textContent = pattern.context || '--';
      
      // Sincronización visual (usa finalSignalState)
      updateSyncIndicator(pattern);

      // Determinar proyección a mostrar basada en la señal final real,
      // NO en el color de la última vela (que puede contradecir overrides de prioridad)
      var finalState = window._finalSignalState || 'wait';
      var projection;
      if (finalState === 'buy') {
        projection = pattern.ifG;
      } else if (finalState === 'sell') {
        projection = pattern.ifR;
      } else {
        // ESPERAR: mostrar la proyección de mayor confianza como referencia informativa
        var gConf = pattern.ifG ? pattern.ifG.conf : 0;
        var rConf = pattern.ifR ? pattern.ifR.conf : 0;
        projection = (gConf >= rConf) ? pattern.ifG : pattern.ifR;
      }

      if (projection) {
        updatePatternAction(projection, pattern.confidence);
      }

      // Lista de candidatos
      updateCandidatesList(pattern.allCandidates);
    }

    function updateSyncIndicator(pattern) {
      var indicator = document.getElementById('sync-indicator');
      if (!indicator) return;
      
      var patternValue = document.getElementById('sync-pattern-value');
      var actionValue = document.getElementById('sync-action-value');
      var actionBox = document.getElementById('sync-action-box');
      
      patternValue.textContent = pattern.patternName.split(' ')[0]; // Nombre corto

      // Usar la señal final real si está disponible — NO la proyección raw del patrón
      var finalState = window._finalSignalState || 'wait';
      var actionMap = {
        'buy':  { text: '🟢 COMPRAR', cssClass: 'buy' },
        'sell': { text: '🔴 VENDER',  cssClass: 'sell' },
        'wait': { text: '⏸️ ESPERAR', cssClass: 'wait' }
      };
      var action = actionMap[finalState] || actionMap['wait'];
      actionValue.textContent = action.text;
      actionBox.className = 'sync-box action ' + action.cssClass;
    }

    function updatePatternAction(projection, baseConfidence) {
      var actionDiv = document.getElementById('pattern-action');
      var icon = document.getElementById('pattern-action-icon');
      var main = document.getElementById('pattern-action-main');
      var desc = document.getElementById('pattern-action-desc');
      var conf = document.getElementById('pattern-confidence');

      // Si la señal final está bloqueada (ESPERAR por extremo/trampa/conflicto),
      // el panel de patrón debe reflejarlo en lugar de mostrar la proyección raw
      var finalState = window._finalSignalState;

      var rawActionMap = {
        'COMPRA': { class: 'buy', icon: '🟢', color: '#00ff88', label: 'COMPRA' },
        'VENTA':  { class: 'sell', icon: '🔴', color: '#ff4444', label: 'VENTA' },
        'ESPERAR':{ class: 'wait', icon: '⏸️', color: '#ffd700', label: 'ESPERAR' }
      };

      var rawAction = rawActionMap[projection.sig] || rawActionMap['ESPERAR'];

      // Override: si la señal final dice ESPERAR pero el patrón dice COMPRA/VENTA,
      // mostrar la proyección del patrón entre paréntesis pero marcar como bloqueada
      if (finalState === 'wait' && projection.sig !== 'ESPERAR') {
        actionDiv.className = 'pattern-action wait';
        icon.textContent = '⏸️';
        main.textContent = 'ESPERAR';
        main.style.color = '#ffd700';
        desc.textContent = '(Patrón: ' + rawAction.label + ' ' + Math.round((projection.conf || baseConfidence || 0.5)*100) + '%) — Señal bloqueada por prioridad superior';
        var confPct = Math.round((projection.conf || baseConfidence || 0.5) * 100);
        conf.textContent = confPct + '%';
        conf.style.color = '#666';
        return;
      }

      // Si buy/sell coinciden con la señal final, mostrar normal
      actionDiv.className = 'pattern-action ' + rawAction.class;
      icon.textContent = rawAction.icon;
      main.textContent = rawAction.label;
      main.style.color = rawAction.color;
      desc.textContent = projection.desc || 'Sin descripción';
      var confidencePct = Math.round((projection.conf || baseConfidence || 0.5) * 100);
      conf.textContent = confidencePct + '%';
      conf.style.color = rawAction.color;
    }

    function updateCandidatesList(candidates) {
      var list = document.getElementById('patterns-list');
      if (!list || !candidates) return;
      
      // Solo mostrar si hay múltiples candidatos relevantes
      if (candidates.length <= 1) {
        list.style.display = 'none';
        return;
      }
      
      list.style.display = 'block';
      list.innerHTML = candidates.slice(0, 4).map(function(c, i) {
        var isWinner = i === 0;
        return '<div class="pattern-item ' + (isWinner ? 'winner' : '') + '">' +
          '<span class="p-name">' + (isWinner ? '👑 ' : '') + c.name + '</span>' +
          '<span class="p-conf">' + Math.round(c.confidence * 100) + '%</span>' +
          '</div>';
      }).join('');
    }

      // También actualizar cuando cambie la señal principal
    // Guardamos referencia a la señal final para que el panel patrón sea coherente
    var originalUpdate = update;
    update = function() {
      originalUpdate.apply(this, arguments);

      // Sincronizar panel de patrón con la señal final real
      if (window.currentPatternResult) {
        // Leer señal final del DOM (es la fuente de verdad)
        var mainSignalEl = document.getElementById('main-signal');
        var finalClass = mainSignalEl ? mainSignalEl.className : '';
        var isBuy  = finalClass.includes('signal-buy') || finalClass.includes('signal-accumulation') || finalClass.includes('signal-strong-reversal');
        var isSell = finalClass.includes('signal-sell') || finalClass.includes('signal-distribution');
        var isWait = !isBuy && !isSell;
        window._finalSignalState = isWait ? 'wait' : isBuy ? 'buy' : 'sell';
        updatePatternUI(window.currentPatternResult);
      }
    };
  })();
  </script>
