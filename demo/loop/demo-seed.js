// Website-demo van Loop: de echte app in zijn eigen demo-modus (geen cloud),
// elke keer een verse voorbeeldlijst, donker thema en een voorbeeldteam.
(function () {
  var TEAM = ["Sanne", "Mo", "Daan", "Lisa", "Tom", "Eva"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var now = new Date(), k = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  function ago(min) { return Date.now() - min * 60000; }
  function it(q, who, min) { return { hoeveelheid: q, checked: !!who, paraaf: who || "", checkedAt: who ? ago(min) : null, note: "", steps: {} }; }
  var items = {
    "algemeen__tomatensoep": it("2", "Mo", 42),
    "algemeen__vis-van-de-dag": it("1"),
    "algemeen__buikspek-snijden": it("1", "Daan", 18),
    "algemeen__kip-snijden": it("2"),
    "algemeen__rendang": it("1", "Mo", 65),
    "algemeen__crostini": it("3"),
    "garnituur__komkommer": it("1", "Sanne", 30),
    "garnituur__rode-ui": it("2", "Sanne", 27),
    "garnituur__croutons": it("1"),
    "garnituur__cherry-tomaat": it("2"),
    "uithalen__carpaccio": it("2", "Lisa", 12),
    "uithalen__hamburgers": it("3"),
    "uithalen__cheesecake": it("1", "Lisa", 9),
    "dressing__truffelmayo": it("2"),
    "dressing__huisdressing": it("1", "Tom", 55),
    "dressing__aioli": it("1"),
    "sla__rucola": it("1", "Eva", 6),
    "sla__koolsalade": it("2")
  };
  var day = {
    workDateKey: k, workDateLabel: (function(){ var d=["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"][now.getDay()], m=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"][now.getMonth()]; return d+" "+now.getDate()+" "+m+" "+now.getFullYear(); })(), gemaaktDoor: "Daan", opmerkingen: "Vanavond groep van 24 om 19:00, extra carpaccio klaarzetten.",
    personeelsetenGisteren: "Pasta pesto", items: items, approved: false, approvedBy: "", approvedAt: null, rolloverAppliedFrom: null
  };
  try {
    Object.keys(localStorage).filter(function (x) { return x.indexOf("mep_") === 0; }).forEach(function (x) { localStorage.removeItem(x); });
    localStorage.setItem("mepTheme", "dark");
    localStorage.setItem("mep_user", "Sanne");
    localStorage.setItem("mep_team", JSON.stringify(TEAM));
    localStorage.setItem("mep_dayState_" + k, JSON.stringify(day));
    localStorage.setItem("mep_dayState_dates", JSON.stringify([k]));
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", "dark");
  window.DEFAULT_TEAM = TEAM;
  // Begin op "Alleen vandaag": wat er vandaag gemaakt moet worden.
  window.addEventListener("load", function () {
    setTimeout(function () { var b = document.getElementById("filterActiveBtn"); if (b) b.click(); }, 400);
  });
})();
