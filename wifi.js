// ===== wifi.js — Selector de fuerza WiFi con proyecciones en hover =====
// Dependencias: showPPProjection(), hidePPProjection(), quickAddCandle() desde logic.js
// Cargado DESPUÉS que logic.js en index.html

(function() {
  'use strict';

  var STR_LABELS = {
    '1':   'Doji',
    '1.5': 'Pequeña',
    '2':   'Normal',
    '2.5': 'Grande',
    '3':   'Muy grande',
    '4':   'Engulfing'
  };

  var _selectedG = null, _selectedR = null;

  // Mapa de fuerza a índice de barra (0-5)
  var STR_TO_IDX = { '1':0, '1.5':1, '2':2, '2.5':3, '3':4, '4':5 };

  function wifiSetup(groupId, side) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var bars = group.querySelectorAll('.wifi-bar');
    var labelEl = document.getElementById('wifi-label-' + side.toLowerCase());

    bars.forEach(function(bar, idx) {

      // ── HOVER: ilumina hasta este bar + muestra proyección ──
      bar.addEventListener('mouseenter', function(e) {
        bars.forEach(function(b, i) {
          b.classList.toggle('active', i <= idx);
          b.classList.remove('selected');
        });
        var str = parseFloat(bar.getAttribute('data-str'));
        if (labelEl) labelEl.textContent = 'F' + str + ' · ' + (STR_LABELS[String(str)] || '');

        // Mostrar proyección igual que el pp-bar hacía en mousemove
        if (typeof window.showPPProjection === 'function') {
          window.showPPProjection(side, str, e.clientX, e.clientY);
        }
      });

      // Actualizar posición del panel al mover el mouse dentro de la barra
      bar.addEventListener('mousemove', function(e) {
        if (typeof window.showPPProjection === 'function') {
          var str = parseFloat(bar.getAttribute('data-str'));
          window.showPPProjection(side, str, e.clientX, e.clientY);
        }
      });

      // ── MOUSE LEAVE del GRUPO: restaurar selección + ocultar proyección ──
      group.addEventListener('mouseleave', function() {
        var sel = side === 'G' ? _selectedG : _selectedR;
        bars.forEach(function(b, i) {
          b.classList.remove('active');
          b.classList.toggle('selected', sel !== null && i <= sel);
        });
        if (labelEl) {
          if (sel !== null) {
            var selBar = bars[sel];
            var s = selBar.getAttribute('data-str');
            labelEl.textContent = 'F' + s + ' · ' + (STR_LABELS[s] || '');
          } else {
            labelEl.textContent = '';
          }
        }
        if (typeof window.hidePPProjection === 'function') {
          window.hidePPProjection();
        }
      });

      // ── CLICK: registrar vela ──
      bar.addEventListener('click', function(e) {
        var str = parseFloat(bar.getAttribute('data-str'));
        if (side === 'G') _selectedG = idx; else _selectedR = idx;

        // Marcar visualmente (barras hasta aquí = selected)
        bars.forEach(function(b, i) {
          b.classList.remove('active');
          b.classList.toggle('selected', i <= idx);
        });
        if (labelEl) {
          labelEl.textContent = 'F' + str + ' · ' + (STR_LABELS[String(str)] || '');
        }

        // Registrar la vela
        if (typeof quickAddCandle === 'function') {
          quickAddCandle(side, str);
        } else if (typeof addCandle === 'function') {
          addCandle(side, str);
        }

        // Actualizar pp-result
        var col   = side === 'G' ? '#00cc66' : '#ff4444';
        var arrow = side === 'G' ? '▲' : '▼';
        var label = STR_LABELS[String(str)] || '';
        var res   = document.getElementById('pp-result');
        if (res) {
          res.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:6px;'
            + 'font-size:0.75em;font-weight:bold;border:1px solid ' + col + '44;'
            + 'background:' + (side==='G' ? 'rgba(0,190,70,0.1)' : 'rgba(200,50,50,0.1)') + ';color:' + col + ';';
          res.innerHTML = arrow + ' <b>' + (side==='G' ? 'VERDE' : 'ROJA') + '</b>'
            + ' &nbsp;·&nbsp; Fuerza &nbsp;·&nbsp; <b>F' + str + ' ' + label + '</b>';
        }

        // Ocultar panel de proyección tras el click (ya se registró)
        if (typeof window.hidePPProjection === 'function') {
          window.hidePPProjection();
        }

        e.stopPropagation();
      });
    });
  }

  // ── Mostrar selector siempre visible ──
  function ensureVisible() {
    var sel = document.getElementById('wifi-strength-selector');
    if (sel) sel.style.display = 'block';
  }

  // ── Inicializar ──
  function init() {
    wifiSetup('wifi-green', 'G');
    wifiSetup('wifi-red',   'R');
    ensureVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exponer para uso externo si se necesita resetear selección
  window.wifiResetSelection = function() {
    _selectedG = null;
    _selectedR = null;
    ['wifi-green','wifi-red'].forEach(function(gId) {
      var g = document.getElementById(gId);
      if (!g) return;
      g.querySelectorAll('.wifi-bar').forEach(function(b) {
        b.classList.remove('active','selected');
      });
    });
    var lg = document.getElementById('wifi-label-g');
    var lr = document.getElementById('wifi-label-r');
    if (lg) lg.textContent = '';
    if (lr) lr.textContent = '';
  };

})();
