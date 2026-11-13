// ============================================================
// loop-fx.js — puur visuele "Loop"-huisstijl-afwerking (scroll-schaduw op
// de topbalk, een zachte parallax op de achtergrondgloeden, en een subtiele
// kantel-op-hover voor de categoriekaarten). Bewust een los, klein bestand
// i.p.v. dit in app.js te verwerken: het raakt nooit app-status of -logica
// aan, dus het kan nooit de eigenlijke MEP-lijst breken — hooguit ontbreekt
// er een animatie-tintje als er iets misgaat (vandaar ook de try/catch's).
// ============================================================
(function () {
  "use strict";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Topbalk krijgt iets meer schaduw zodra er gescrold is ----------
  try {
    var topbar = document.querySelector(".topbar");
    if (topbar) {
      var onScroll = function () {
        topbar.classList.toggle("scrolled", window.scrollY > 8);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();

      // ---------- Zachte parallax op de achtergrondgloeden ----------
      if (!reduceMotion) {
        var orbs = document.querySelectorAll(".loop-orb");
        if (orbs.length) {
          var onParallax = function () {
            var y = window.scrollY;
            orbs.forEach(function (orb, i) {
              var depth = 0.03 + i * 0.015;
              orb.style.transform = "translateY(" + (-y * depth).toFixed(1) + "px)";
            });
          };
          window.addEventListener("scroll", onParallax, { passive: true });
        }
      }
    }
  } catch (e) { /* puur decoratief — nooit de app blokkeren */ }

  // ---------- Kantel-op-hover voor categoriekaarten ----------
  // Via delegatie op de vaste #categoryGrid-container (niet op de kaarten
  // zelf): app.js bouwt de kaarten bij elke wijziging opnieuw op
  // (grid.innerHTML = ""), maar de container zelf blijft bestaan — zo blijft
  // dit ook na elke her-render gewoon werken, zonder dat app.js iets hoeft
  // te weten van deze losse laag.
  try {
    if (!reduceMotion) {
      var grid = document.getElementById("categoryGrid");
      if (grid) {
        var activeCard = null;
        grid.addEventListener("mousemove", function (e) {
          var card = e.target.closest ? e.target.closest(".cat-card") : null;
          if (!card || !grid.contains(card)) return;
          activeCard = card;
          var r = card.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width - 0.5;
          var y = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform =
            "translateY(-4px) rotateX(" + (-y * 4).toFixed(2) + "deg) rotateY(" + (x * 5).toFixed(2) + "deg)";
        });
        grid.addEventListener(
          "mouseout",
          function (e) {
            var card = e.target.closest ? e.target.closest(".cat-card") : null;
            if (!card) return;
            if (!e.relatedTarget || !card.contains(e.relatedTarget)) {
              card.style.transform = "";
              if (activeCard === card) activeCard = null;
            }
          },
          true
        );
      }
    }
  } catch (e) { /* puur decoratief — nooit de app blokkeren */ }
})();
