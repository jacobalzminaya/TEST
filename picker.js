// ===== picker.js — Picker de precio (pp-bar) =====
// Dependencias: quickAddCandle(), showPPProjection(), hidePPProjection() desde logic.js
// Cargado DESPUÉS que logic.js en index.html

  (function() {
    var ppRef = null, ppSpread = 1, ppMin = 0, ppMax = 0;
    var ZONES = [
      { min:80, max:100, str:4,   label:'Engulfing/Cap', gBg:'rgba(0,210,80,0.24)',  rBg:'rgba(210,50,50,0.24)'  },
      { min:60, max:80,  str:3,   label:'Muy grande',    gBg:'rgba(0,210,80,0.16)',  rBg:'rgba(210,50,50,0.16)'  },
      { min:40, max:60,  str:2.5, label:'Grande',        gBg:'rgba(0,210,80,0.10)',  rBg:'rgba(210,50,50,0.10)'  },
      { min:22, max:40,  str:2,   label:'Normal',        gBg:'rgba(0,210,80,0.06)',  rBg:'rgba(210,50,50,0.06)'  },
      { min:8,  max:22,  str:1.5, label:'Pequeña',       gBg:'rgba(0,210,80,0.03)',  rBg:'rgba(210,50,50,0.03)'  },
      { min:0,  max:8,   str:1,   label:'Doji',          gBg:'rgba(130,130,130,0.07)',rBg:'rgba(130,130,130,0.07)'},
    ];

    function getZone(pct) {
      for (var i=0;i<ZONES.length;i++) { if (pct >= ZONES[i].min) return ZONES[i]; }
      return ZONES[ZONES.length-1];
    }

    function centerRange(price) {
      ppRef = price; ppMin = price - ppSpread; ppMax = price + ppSpread;
      if (typeof ppRefPrice !== 'undefined') { window.ppRefPrice = price; window.ppMinPrice = ppMin; window.ppMaxPrice = ppMax; }
      renderBar();
    }

    var _ppLastSide = 'G';

    function renderBar(side) {
      var bar = document.getElementById('pp-bar');
      if (!bar || ppMax <= ppMin) return;
      if (side) _ppLastSide = side;
      var isRed = _ppLastSide === 'R';
      var range = ppMax - ppMin, html = '';
      ZONES.forEach(function(z,i) {
        var top = (100 - z.max)+'%', h = (z.max - z.min)+'%';
        var priceHi = (ppMin + z.max/100*range).toFixed(2);
        var bg = isRed ? z.rBg : z.gBg;
        var labelCol = isRed ? 'rgba(255,80,80,0.9)' : 'rgba(0,210,80,0.9)';
        html += '<div class="ppz" id="ppz'+i+'" style="position:absolute;left:0;right:0;top:'+top+';height:'+h+';background:'+bg+';display:flex;align-items:center;justify-content:space-between;padding:0 8px;border-bottom:1px solid rgba(255,255,255,0.04);transition:background .08s;">'
          +'<span style="font-size:10px;font-weight:500;color:'+labelCol+';pointer-events:none;">'+z.label+' · F'+z.str+'</span>'
          +'<span style="font-size:9px;color:rgba(255,255,255,0.35);pointer-events:none;">'+priceHi+'</span>'
          +'</div>';
      });
      [25,50,75].forEach(function(p) {
        var price = (ppMin + p/100*range).toFixed(2);
        html += '<div style="position:absolute;left:0;right:0;top:'+(100-p)+'%;height:1px;background:rgba(255,255,255,0.07);pointer-events:none;">'
          +'<span style="position:absolute;left:50%;transform:translateX(-50%);bottom:2px;font-size:9px;color:rgba(255,255,255,0.35);">'+price+'</span></div>';
      });
      html += '<div style="position:absolute;top:3px;left:7px;font-size:9px;color:rgba(255,255,255,0.4);pointer-events:none;">'+ppMax.toFixed(2)+' ↑</div>';
      html += '<div style="position:absolute;bottom:3px;left:7px;font-size:9px;color:rgba(255,255,255,0.4);pointer-events:none;">'+ppMin.toFixed(2)+' ↓</div>';
      if (ppRef !== null) {
        var refPct = Math.max(0,Math.min(100,((ppRef-ppMin)/range)*100));
        html += '<div style="position:absolute;left:0;right:0;top:'+(100-refPct).toFixed(1)+'%;height:2px;background:#4499ff;z-index:4;pointer-events:none;">'
          +'<span style="position:absolute;left:7px;bottom:3px;font-size:9px;color:#4499ff;font-weight:bold;">ref '+ppRef.toFixed(2)+'</span></div>';
      }
      html += '<div id="pp-hline" style="position:absolute;left:0;right:0;height:2px;display:none;pointer-events:none;z-index:6;">'
        +'<span id="pp-hprice" style="position:absolute;right:7px;top:-15px;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px;"></span>'
        +'<span id="pp-hdir" style="position:absolute;left:7px;top:-15px;font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px;"></span>'
        +'</div>';
      bar.innerHTML = html;
    }

    window.ppBarHover = function(e) {
      var bar = document.getElementById('pp-bar');
      if (!bar || ppRef === null) return;
      var rect = bar.getBoundingClientRect();
      var price = ppMax - ((e.clientY - rect.top)/rect.height)*(ppMax-ppMin);
      var isGreen = price >= ppRef;
      var newSide = isGreen ? 'G' : 'R';
      if (newSide !== _ppLastSide) renderBar(newSide);
      var pct = Math.min(100, Math.abs(price-ppRef)/ppSpread*100);
      var z = getZone(pct), zi = ZONES.indexOf(z);
      var col = isGreen ? '#00cc66' : '#ff4444';
      ZONES.forEach(function(zd,i) {
        var el = document.getElementById('ppz'+i);
        if (!el) return;
        el.style.background = (i===zi) ? (isGreen ? 'rgba(0,210,80,0.42)' : 'rgba(210,50,50,0.42)') : (isGreen ? zd.gBg : zd.rBg);
        el.firstElementChild.style.color = (i===zi) ? col : (isGreen ? 'rgba(0,210,80,0.75)' : 'rgba(210,70,70,0.75)');
      });
      var yPx = e.clientY - rect.top;
      var hl=document.getElementById('pp-hline'), hp=document.getElementById('pp-hprice'), hd=document.getElementById('pp-hdir');
      if (!hl) return;
      hl.style.display='block'; hl.style.top=yPx+'px'; hl.style.background=col;
      hp.textContent=price.toFixed(2); hp.style.color=col; hp.style.background=isGreen?'rgba(0,170,60,0.18)':'rgba(190,40,40,0.18)';
      hd.textContent=(isGreen?'▲ VERDE':'▼ ROJA')+' · '+z.label+' · F'+z.str; hd.style.color=col; hd.style.background=hp.style.background;

      if (typeof window.showPPProjection === 'function') {
        window.showPPProjection(isGreen ? 'G' : 'R', z.str, e.clientX, e.clientY);
      }
    };

    window.ppBarLeave = function() {
      ZONES.forEach(function(z,i) {
        var el=document.getElementById('ppz'+i);
        if (el) { el.style.background=z.gBg; if(el.firstElementChild) el.firstElementChild.style.color='rgba(0,210,80,0.75)'; }
      });
      if (typeof window.hidePPProjection === 'function') { window.hidePPProjection(); }
      var hl=document.getElementById('pp-hline'); if(hl) hl.style.display='none';
    };

    window.ppBarClick = function(e) {
      var bar=document.getElementById('pp-bar');
      if (!bar) return;
      if (ppRef === null) {
        document.getElementById('pp-result').innerHTML='<span style="color:#ff4444">Primero ingresa el precio base en el campo Ref</span>';
        document.getElementById('pp-ref-manual').focus();
        return;
      }
      var rect=bar.getBoundingClientRect();
      var price=Math.max(ppMin,Math.min(ppMax, ppMax-((e.clientY-rect.top)/rect.height)*(ppMax-ppMin)));
      // pct: distancia desde el centro (ppRef) como % del half-range (ppSpread)
      // ppMax-ppMin = 2*spread, pero la distancia máxima desde ref es 1*spread
      // Dividir por ppSpread (half-range) para mapear correctamente 0–100%
      var pct=Math.min((Math.abs(price-ppRef)/ppSpread)*100,100);
      var isGreen=price>=ppRef, z=getZone(pct), col=isGreen?'#00cc66':'#ff4444', arrow=isGreen?'▲':'▼';
      var res=document.getElementById('pp-result');
      res.style.cssText='margin-top:6px;padding:6px 10px;border-radius:6px;font-size:0.75em;font-weight:bold;border:1px solid '+col+'44;background:'+(isGreen?'rgba(0,190,70,0.1)':'rgba(200,50,50,0.1)')+';color:'+col+';';
      res.innerHTML=arrow+' <b>'+(isGreen?'VERDE':'ROJA')+'</b> &nbsp;·&nbsp; Cierre <b>'+price.toFixed(2)+'</b> &nbsp;·&nbsp; Recorrió <b>'+pct.toFixed(0)+'%</b> &nbsp;·&nbsp; <b>F'+z.str+' '+z.label+'</b>';
      ppRef=price;
      document.getElementById('pp-ref-manual').value=price.toFixed(2);
      document.getElementById('pp-ref-label').textContent='';
      centerRange(price);
      if (typeof quickAddCandle==='function') quickAddCandle(isGreen?'G':'R', z.str);
      if (typeof window.hidePPProjection === 'function') { window.hidePPProjection(); }
    };

    window.ppSetRef = function(val) {
      var price=parseFloat(val); if (isNaN(price)) return;
      centerRange(price);
      document.getElementById('pp-ref-label').textContent='✓';
      var res=document.getElementById('pp-result');
      res.style.cssText='margin-top:6px;padding:6px 10px;border-radius:6px;font-size:0.75em;font-weight:bold;border:1px solid #3366ff44;background:rgba(51,102,255,0.08);color:#4499ff;';
      res.innerHTML='Ref fijada en <b>'+price.toFixed(2)+'</b> · Spread ±'+ppSpread+' · Haz click donde cerró la vela';
    };

    window.ppUpdateSpread = function() {
      var v=parseFloat(document.getElementById('pp-spread').value);
      if (!isNaN(v)&&v>0) { ppSpread=v; if(ppRef!==null) centerRange(ppRef); }
    };

    window.ppRebuild = function() { if (ppRef!==null) centerRange(ppRef); };

    document.addEventListener('DOMContentLoaded', function() {
      var sp=document.getElementById('pp-spread');
      var rf=document.getElementById('pp-ref-manual');
      if (sp) sp.addEventListener('input', window.ppUpdateSpread);
      if (rf) {
        rf.addEventListener('change', function() { window.ppSetRef(this.value); });
        rf.addEventListener('keydown', function(e) { if(e.key==='Enter') window.ppSetRef(this.value); });
      }
    });
  })();
  </script>

  <!-- PANEL DE VISIBILIDAD DE SECCIONES -->
  <div id="view-panel" style="display:none;position:fixed;top:0;right:0;height:100vh;width:230px;background:#0f0f0f;border-left:1px solid #222;z-index:8000;overflow-y:auto;padding:12px 0;box-shadow:-8px 0 32px rgba(0,0,0,0.8);">
    <div style="padding:8px 14px 10px;border-bottom:1px solid #1e1e1e;display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:0.75em;font-weight:bold;color:#aaa;letter-spacing:0.05em;">👁 PERSONALIZAR VISTA</span>
      <button onclick="toggleViewPanel()" style="background:none;border:none;color:#555;cursor:pointer;font-size:0.9em;padding:2px 5px;">✕</button>
    </div>
    <div style="padding:8px 14px 4px;">
      <div style="font-size:0.6em;color:#444;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Columna izquierda</div>
      <div id="view-items-left"></div>
      <div style="font-size:0.6em;color:#444;text-transform:uppercase;letter-spacing:0.06em;margin:10px 0 6px;">Columna derecha</div>
      <div id="view-items-right"></div>
    </div>
    <div style="padding:10px 14px;border-top:1px solid #1e1e1e;margin-top:6px;">
      <button onclick="resetViewPanel()" style="width:100%;background:#1a1a1a;border:1px solid #333;color:#888;padding:6px;border-radius:6px;cursor:pointer;font-size:0.7em;">↺ Mostrar todo</button>
    </div>
  </div>
  <div id="view-overlay" onclick="toggleViewPanel()" style="display:none;position:fixed;inset:0;z-index:7999;background:rgba(0,0,0,0.4);"></div>

  <!-- PANEL FLOTANTE PROYECCION HOVER -->
  <div id="hover-proj-panel" style="display:none;position:fixed;z-index:9999;width:324px;background:#0a0a0a;border:1px solid #252525;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.9),0 0 0 1px rgba(255,255,255,0.03);">
    <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid #181818;background:#0f0f0f;">
      <span id="hover-proj-mode-badge" style="font-size:0.6em;font-weight:bold;padding:2px 8px;border-radius:10px;background:#1a1a1a;color:#ffd700;white-space:nowrap;letter-spacing:0.05em;">VELA ACTUAL</span>
      <span id="hover-proj-candle-info" style="flex:1;font-size:0.6em;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <button onclick="closeHoverProj()" style="background:none;border:none;color:#444;cursor:pointer;font-size:0.8em;padding:2px 5px;border-radius:3px;line-height:1;transition:color 0.15s;" onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color='#444'">&#x2715;</button>
    </div>
    <div id="hover-proj-current-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px 6px;border-bottom:1px solid #141414;">
      <div id="hover-proj-current-label-title" style="font-size:0.58em;color:#444;white-space:nowrap;min-width:44px;">Vela actual</div>
      <div id="hover-proj-current-candles" style="display:flex;align-items:center;gap:3px;flex:1;"></div>
      <div id="hover-proj-current-label" style="font-size:0.62em;color:#666;text-align:right;"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:8px;">
      <div id="hover-proj-g-box" style="padding:8px 10px;border-radius:8px;border:1px solid #1a1a1a;border-top:2px solid rgba(0,255,136,0.4);background:#080808;transition:border-color 0.2s;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <svg width="10" height="14" viewBox="0 0 10 14"><rect x="2" y="1" width="6" height="10" fill="#00ff88" rx="1"/><line x1="5" y1="0" x2="5" y2="1" stroke="#00cc66" stroke-width="1"/><line x1="5" y1="11" x2="5" y2="14" stroke="#00cc66" stroke-width="1"/></svg>
          <span style="font-size:0.6em;color:#00ff88;font-weight:bold;letter-spacing:0.04em;">SI VERDE</span>
        </div>
        <div id="hover-proj-g-seq" style="display:flex;align-items:center;gap:2px;margin-bottom:6px;min-height:20px;">--</div>
        <div id="hover-proj-g-sig" class="hover-proj-sig sig-wait" style="font-size:0.85em;font-weight:bold;margin-bottom:3px;">--</div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
          <div id="hover-proj-g-bar" style="flex:1;height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
            <div id="hover-proj-g-fill" style="height:100%;width:0%;background:#00ff88;border-radius:2px;transition:width 0.3s;"></div>
          </div>
          <span id="hover-proj-g-pct" style="font-size:0.6em;color:#555;white-space:nowrap;">0%</span>
        </div>
        <div id="hover-proj-g-conf" style="font-size:0.58em;color:#444;line-height:1.3;">--</div>
      </div>
      <div id="hover-proj-r-box" style="padding:8px 10px;border-radius:8px;border:1px solid #1a1a1a;border-top:2px solid rgba(255,68,68,0.4);background:#080808;transition:border-color 0.2s;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <svg width="10" height="14" viewBox="0 0 10 14"><rect x="2" y="3" width="6" height="10" fill="#ff4444" rx="1"/><line x1="5" y1="0" x2="5" y2="3" stroke="#cc2222" stroke-width="1"/><line x1="5" y1="13" x2="5" y2="14" stroke="#cc2222" stroke-width="1"/></svg>
          <span style="font-size:0.6em;color:#ff4444;font-weight:bold;letter-spacing:0.04em;">SI ROJO</span>
        </div>
        <div id="hover-proj-r-seq" style="display:flex;align-items:center;gap:2px;margin-bottom:6px;min-height:20px;">--</div>
        <div id="hover-proj-r-sig" class="hover-proj-sig sig-wait" style="font-size:0.85em;font-weight:bold;margin-bottom:3px;">--</div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
          <div id="hover-proj-r-bar" style="flex:1;height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
            <div id="hover-proj-r-fill" style="height:100%;width:0%;background:#ff4444;border-radius:2px;transition:width 0.3s;"></div>
          </div>
          <span id="hover-proj-r-pct" style="font-size:0.6em;color:#555;white-space:nowrap;">0%</span>
        </div>
        <div id="hover-proj-r-conf" style="font-size:0.58em;color:#444;line-height:1.3;">--</div>
      </div>
    </div>
    <div style="padding:4px 10px 6px;text-align:center;">
      <span id="hover-proj-pin-hint" style="font-size:0.56em;color:#333;">Hover para ver proyeccion  |  Click para registrar</span>
    </div>
  </div>

