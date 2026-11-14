// Echo · reviewsheet en analyse. Toetst reviews aan de kassadata (unTill).
// Draait in de browser (overzicht en demo). De server levert alleen de rekeningen.
//
// Een rekening ziet er zo uit (zo zet de kassa-ophaler hem in de database):
// { id, tafel, personen, geopend, geopendDoor, afgerekend, afgerekendDoor, totaal,
//   regels: [{ ts, door, artikel, groep, aantal, prijs }] }     (tijden in ms)
//
// Let op: kassatijden zijn AANSLAGtijden. Wanneer het bord echt op tafel stond weet de kassa niet.

export const SOORTEN = { drank: "Drinken", voor: "Voorgerecht", hoofd: "Hoofdgerecht", na: "Nagerecht", overig: "Overig" };
const MIN = 6e4;

// Soort van een kassaregel: eerst de instelling per kassagroep, anders de gang uit de kassa (voor/hoofd/na).
export function soortVan(regel, S) {
  if (regel.soort && SOORTEN[regel.soort]) return regel.soort;
  const g = String(regel.groep || "").trim().toLowerCase();
  const m = S.kassaGroepen.find(x => x.groep.trim().toLowerCase() === g);
  if (m) return m.soort === "negeren" ? "negeren" : m.soort;
  if (["voor", "hoofd", "na"].includes(regel.gang)) return regel.gang;
  return "overig";
}
// Kassagebruikers die geen mens zijn (bv. Guestplan die de tafel opent, een sluitpas).
const isSysteem = (naam, S) => !naam || (S.systeemGebruikers || []).some(x => x.trim().toLowerCase() === String(naam).trim().toLowerCase());
const tafelGelijk = (a, b) => String(a || "").trim().toLowerCase().replace(/^0+/, "") === String(b || "").trim().toLowerCase().replace(/^0+/, "") && String(a || "").trim() !== "";

// ---------- koppeling review ↔ rekening ----------
// Volgorde: 1) handmatig gekozen, 2) zelfde tafel + passende tijd, 3) zelf kiezen uit kandidaten.
export function kandidaten(f, lijst, S) {
  const na = S.sheet.koppelNa * MIN;
  const mail = f.bron === "mail";
  return lijst.map(r => {
    const eind = r.afgerekend || Infinity;
    const open = r.geopend <= f.ts && eind >= f.ts;
    const netDicht = !open && r.afgerekend && r.afgerekend < f.ts && f.ts - r.afgerekend <= na;
    const zelfdeTafel = tafelGelijk(r.tafel, f.tafel);
    // mail na bezoek: review komt later binnen, dan telt elke rekening van de afgelopen 36 uur
    const mailOk = mail && r.geopend < f.ts && f.ts - r.geopend < 36 * 60 * MIN;
    let punten = 0; const waarom = [];
    if (zelfdeTafel) { punten += 10; waarom.push("zelfde tafel"); }
    if (mail) { // gast is al thuis: alleen eerdere bezoeken, meest recente eerst
      if (!mailOk || !r.afgerekend || r.afgerekend > f.ts) return null;
      punten += 2 - (f.ts - r.geopend) / (36 * 60 * MIN); waarom.push("bezoek " + Math.round((f.ts - r.afgerekend) / (60 * MIN)) + " uur vóór de mail-review");
    } else if (open) { punten += 5; waarom.push("tafel was open tijdens de review"); }
    else if (netDicht) { punten += 3 - (f.ts - r.afgerekend) / na; waarom.push(Math.round((f.ts - r.afgerekend) / MIN) + " min na afrekenen"); }
    else return null;
    return { r, punten, waarom, tafelEnTijd: zelfdeTafel };
  }).filter(Boolean).sort((a, b) => b.punten - a.punten);
}

export function koppel(f, lijst, S) {
  const k = kandidaten(f, lijst, S);
  if (f.rekening) {
    const r = lijst.find(x => String(x.id) === String(f.rekening));
    if (r) return { r, hoe: "handmatig", kandidaten: k };
  }
  const t = k.filter(x => x.tafelEnTijd);
  if (t.length) return { r: t[0].r, hoe: "tafel", kandidaten: k };
  return { r: null, hoe: null, kandidaten: k };
}
export const HOE = { handmatig: "zelf gekozen", tafel: "tafelnummer + tijd" };

// ---------- analyse van één rekening ----------
export function analyseer(r, S, normen = {}) {
  const T = S.sheet;
  const regels = (r.regels || []).map(x => ({ ...x, soort: soortVan(x, S), aantal: Number(x.aantal) || 0, prijs: Number(x.prijs) || 0, door: isSysteem(x.door, S) ? "" : x.door }))
    .filter(x => x.soort !== "negeren").sort((a, b) => a.ts - b.ts);
  const telSoort = s => regels.filter(x => x.soort === s).reduce((n, x) => n + x.aantal, 0);
  const geannuleerd = regels.filter(x => x.aantal < 0).reduce((n, x) => n - x.aantal, 0);

  // rondes: alles wat binnen 2 minuten na elkaar is aangeslagen
  const rondes = [];
  for (const x of regels.filter(x => x.aantal > 0)) {
    const laatst = rondes[rondes.length - 1];
    if (laatst && x.ts - laatst.ts <= 2 * MIN) laatst.items.push(x);
    else rondes.push({ ts: x.ts, door: x.door, items: [x] });
  }
  rondes.forEach(rd => { rd.soorten = [...new Set(rd.items.map(i => i.soort))]; });

  const hoofd = telSoort("hoofd");
  let personen = Number(r.personen) || 0, personenGeschat = false;
  // kassa weet het aantal personen niet (of staat op 1 terwijl er meer hoofdgerechten zijn): tel de hoofdgerechten
  if (T.personenUitHoofd && hoofd > personen) { personen = hoofd; personenGeschat = true; }
  const totaal = r.totaal != null ? Number(r.totaal) : regels.reduce((s, x) => s + x.aantal * x.prijs, 0);
  const drank = telSoort("drank");
  const laatsteRonde = rondes.length ? rondes[rondes.length - 1].ts : r.geopend;
  const eind = r.afgerekend || laatsteRonde;

  const eersteVan = s => { const x = regels.find(y => y.soort === s && y.aantal > 0); return x ? x.ts : null; };
  const gangen = { drank: eersteVan("drank"), voor: eersteVan("voor"), hoofd: eersteVan("hoofd"), na: eersteVan("na") };

  // "droog gestaan": langste tijd zonder drankbestelling, van het eerste drankje tot de laatste bestelling.
  // (Tijdens het eten wordt er vaak niets besteld, maar een leeg glas valt altijd op.)
  const drankRondes = rondes.filter(x => x.soorten.includes("drank")).map(x => x.ts);
  const momenten = drankRondes.length ? [...drankRondes, ...(laatsteRonde > drankRondes[drankRondes.length - 1] ? [laatsteRonde] : [])] : [];
  const gaten = [];
  for (let i = 1; i < momenten.length; i++) gaten.push({ van: momenten[i - 1], tot: momenten[i], min: (momenten[i] - momenten[i - 1]) / MIN });
  const langsteGat = gaten.length ? gaten.reduce((a, b) => (b.min > a.min ? b : a)) : null;

  // medewerkers
  const aangeslagen = {};
  rondes.forEach(rd => { if (rd.door) aangeslagen[rd.door] = (aangeslagen[rd.door] || 0) + 1; });
  const opener = isSysteem(r.geopendDoor, S) ? (rondes.find(x => x.door)?.door || null) : r.geopendDoor;
  const betaler = isSysteem(r.afgerekendDoor, S) ? null : r.afgerekendDoor;
  const mensen = new Set([opener, betaler, ...Object.keys(aangeslagen)].filter(Boolean));
  const hoofdbediening = Object.entries(aangeslagen).sort((a, b) => b[1] - a[1])[0]?.[0] || opener || null;
  const drankPrijs = regels.filter(x => x.soort === "drank" && x.aantal > 0 && x.prijs > 0);

  const a = {
    r, regels, rondes, gaten, langsteGat, gangen, personen, personenGeschat, totaal, drank,
    drankPrijs: drankPrijs.length ? drankPrijs.reduce((s, x) => s + x.prijs, 0) / drankPrijs.length : null,
    verblijf: (eind - r.geopend) / MIN,
    eersteDrank: gangen.drank ? (gangen.drank - r.geopend) / MIN : null,
    tussenGangen: gangen.voor && gangen.hoofd ? (gangen.hoofd - gangen.voor) / MIN : null,
    naLaatste: r.afgerekend && rondes.length ? (r.afgerekend - laatsteRonde) / MIN : null,
    drankPP: personen ? drank / personen : null,
    bestedingPP: personen ? totaal / personen : null,
    medewerkers: { geopend: opener, geopendSysteem: isSysteem(r.geopendDoor, S) && r.geopendDoor ? r.geopendDoor : null, afgerekend: betaler, aangeslagen, aantal: mensen.size, hoofd: hoofdbediening },
    geannuleerd
  };
  a.checks = checks(a, S, normen);
  a.missers = a.checks.filter(c => c.status === "let").length;
  return a;
}

// Norm voor drankjes / besteding p.p.: handmatig, of een % van het eigen gemiddelde.
export function norm(S, normen, sleutel) {
  const hand = S.sheet[sleutel === "drankPP" ? "minDrankPP" : "minBestedingPP"];
  if (hand != null && hand !== "" && !isNaN(hand)) return { waarde: Number(hand), auto: false };
  const gem = normen[sleutel];
  return gem ? { waarde: gem * S.sheet.normProcent / 100, auto: true, gem } : null;
}

const minTxt = m => Math.round(m) + " min";
const euro = n => "€" + n.toFixed(2).replace(".", ",");
const een = n => n.toFixed(1).replace(".", ",");

// Alle toetsen. status: goed | let | info
export const CHECKS = {
  eersteDrank: { label: "Eerste drankje", tags: ["Wachttijd", "Drinken", "Bediening"] },
  langsteGat: { label: "Langst zonder drankje", tags: ["Bediening", "Wachttijd"] },
  tussenGangen: { label: "Voor- naar hoofdgerecht", tags: ["Wachttijd", "Eten"] },
  naLaatste: { label: "Wachten op de rekening", tags: ["Bediening", "Wachttijd"] },
  drankPP: { label: "Drankjes per persoon", tags: ["Drinken", "Bediening"] },
  bestedingPP: { label: "Besteding per persoon", tags: ["Prijs"] },
  medewerkers: { label: "Medewerkers aan tafel", tags: ["Bediening"] },
  geannuleerd: { label: "Geannuleerd", tags: ["Eten", "Drinken"] }
};

function checks(a, S, normen) {
  const T = S.sheet, uit = [];
  const add = (id, waarde, getal, normTxt, status, uitleg) => uit.push({ id, ...CHECKS[id], waarde, getal, norm: normTxt, status, uitleg });
  if (a.eersteDrank != null) add("eersteDrank", minTxt(a.eersteDrank), a.eersteDrank, "max " + T.maxEersteDrankje + " min", a.eersteDrank <= T.maxEersteDrankje ? "goed" : "let", "Van tafel openen tot het eerste drankje aangeslagen.");
  else add("eersteDrank", "geen", null, "max " + T.maxEersteDrankje + " min", "let", "Er is geen drankje aangeslagen op deze rekening.");
  if (a.langsteGat) add("langsteGat", minTxt(a.langsteGat.min), a.langsteGat.min, "max " + T.maxGat + " min", a.langsteGat.min <= T.maxGat ? "goed" : "let", "Langste tijd zonder drankbestelling, van het eerste drankje tot de laatste bestelling. Een leeg glas is de snelste maat voor aandacht.");
  if (a.tussenGangen != null) add("tussenGangen", minTxt(a.tussenGangen), a.tussenGangen, "max " + T.maxTussenGangen + " min", a.tussenGangen <= T.maxTussenGangen ? "goed" : "let", "Van voorgerecht aangeslagen tot hoofdgerecht uitgevraagd.");
  if (a.naLaatste != null) add("naLaatste", minTxt(a.naLaatste), a.naLaatste, "max " + T.maxNaLaatste + " min", a.naLaatste <= T.maxNaLaatste ? "goed" : "let", "Van de laatste bestelling tot afrekenen. Lang kan gezellig natafelen zijn, of wachten op de rekening.");
  const nd = norm(S, normen, "drankPP");
  if (a.drankPP != null) add("drankPP", een(a.drankPP) + (a.personenGeschat ? "*" : ""), a.drankPP, nd ? "min " + een(nd.waarde) + (nd.auto ? " (auto)" : "") : "geen norm", !nd ? "info" : a.drankPP >= nd.waarde ? "goed" : "let", "Aantal drankjes gedeeld door het aantal personen." + (a.personenGeschat ? " *Personen geschat uit het aantal hoofdgerechten." : ""));
  const nb = norm(S, normen, "bestedingPP");
  if (a.bestedingPP != null) add("bestedingPP", euro(a.bestedingPP), a.bestedingPP, nb ? "min " + euro(nb.waarde) + (nb.auto ? " (auto)" : "") : "geen norm", !nb ? "info" : a.bestedingPP >= nb.waarde ? "goed" : "let", "Totaal van de rekening gedeeld door het aantal personen.");
  add("medewerkers", String(a.medewerkers.aantal), a.medewerkers.aantal, "max " + T.maxMedewerkers, a.medewerkers.aantal <= T.maxMedewerkers ? "goed" : "let", "Verschillende mensen die de tafel openden, bestellingen aansloegen of afrekenden. Veel wisselingen = niemand voelt zich eigenaar van de tafel.");
  if (a.geannuleerd > 0) add("geannuleerd", String(a.geannuleerd), a.geannuleerd, "0", "let", "Artikelen die zijn aangeslagen en weer geannuleerd: fout aangeslagen of teruggestuurd?");
  return uit;
}

// ---------- conclusie voor de sheet ----------
export function conclusie(f, a, S) {
  const slecht = f.score <= S.drempelSlecht, tevreden = f.score >= 4;
  const mis = a.checks.filter(c => c.status === "let");
  const goed = a.checks.filter(c => c.status === "goed");
  const lijst = l => l.map(c => c.label.toLowerCase() + " (" + c.waarde + ")").join(", ");
  let toon, kop, tekst;
  if (slecht && mis.length) { toon = "slecht"; kop = "De kassa bevestigt de review"; tekst = "Hier ging het mis: " + lijst(mis) + "."; }
  else if (slecht) { toon = "neutraal"; kop = "In de kassa is niets bijzonders te zien"; tekst = "Tempo, aandacht en drankjes waren volgens de norm. De oorzaak zit waarschijnlijk ergens anders: eten, sfeer, schoonmaak of één moment dat niet in de kassa staat."; }
  else if (tevreden && !mis.length) { toon = "goed"; kop = "Alles volgens het boekje"; tekst = "Precies zoals het hoort: " + lijst(goed.slice(0, 3)) + "."; }
  else if (tevreden) { toon = "let"; kop = "Tevreden gast, maar er liep iets niet lekker"; tekst = "Let op: " + lijst(mis) + ". Deze keer ging het goed, bij een andere tafel misschien niet."; }
  else { toon = mis.length ? "let" : "neutraal"; kop = mis.length ? "Een paar missers" : "Geen opvallende punten"; tekst = mis.length ? lijst(mis) + "." : "Volgens de kassa liep alles volgens de norm."; }

  // wat de gast zelf aantikte naast de kassadata leggen
  const tagRegels = (f.tags || []).map(t => {
    const bij = a.checks.filter(c => c.tags.includes(t));
    if (!bij.length) return null;
    const m = bij.filter(c => c.status === "let");
    if (f.score <= 3) return m.length ? { tag: t, ok: true, tekst: "Gast noemt " + t.toLowerCase() + ", de kassa bevestigt het: " + lijst(m) + "." }
      : { tag: t, ok: false, tekst: "Gast noemt " + t.toLowerCase() + ", maar de kassa laat daar niets van zien." };
    return m.length ? { tag: t, ok: false, tekst: "Gast vond " + t.toLowerCase() + " top, ondanks " + lijst(m) + "." }
      : { tag: t, ok: true, tekst: "Gast vond " + t.toLowerCase() + " top, en dat klopt met de kassa." };
  }).filter(Boolean);
  return { toon, kop, tekst, tagRegels };
}

// ---------- analyse over alle reviews ("consultant") ----------
const gemVan = l => l.length ? l.reduce((s, x) => s + x, 0) / l.length : null;
const getallen = (items, fn) => items.map(fn).filter(v => v != null && !isNaN(v));

export const METRIEKEN = [
  { id: "eersteDrank", label: "Wachttijd eerste drankje", eenheid: "min", hogerSlechter: true },
  { id: "langsteGat", label: "Langst zonder drankje", eenheid: "min", hogerSlechter: true, fn: a => a.langsteGat?.min },
  { id: "tussenGangen", label: "Voor- naar hoofdgerecht", eenheid: "min", hogerSlechter: true },
  { id: "naLaatste", label: "Wachten op de rekening", eenheid: "min", hogerSlechter: true },
  { id: "drankPP", label: "Drankjes per persoon", eenheid: "", hogerSlechter: false },
  { id: "bestedingPP", label: "Besteding per persoon", eenheid: "€", hogerSlechter: false },
  { id: "medewerkers", label: "Medewerkers per tafel", eenheid: "", hogerSlechter: true, fn: a => a.medewerkers.aantal },
  { id: "verblijf", label: "Verblijfsduur", eenheid: "min", hogerSlechter: null },
  { id: "drukte", label: "Open tafels op dat moment", eenheid: "", hogerSlechter: true, fn: (a, x) => x.drukte }
];
export const waardeVan = (m, x) => (m.fn ? m.fn(x.a, x) : x.a[m.id]);

export const ADVIES = {
  eersteDrank: "Drankje binnen {n} minuten: wie de tafel opent, neemt meteen de drankbestelling op. Desnoods alleen water op tafel als de rest nog moet kiezen.",
  langsteGat: "Vaste glazenronde: loop elke {n} minuten langs elke open tafel, ook als er niets gevraagd wordt. Lege glazen zijn het signaal.",
  tussenGangen: "Hoofdgerecht eerder uitvragen: zodra de voorgerechten op tafel staan, kan de keuken de volgende gang klaarzetten.",
  naLaatste: "Rekening sneller: bied bij het afruimen van het nagerecht koffie of de rekening aan. Niemand wil zwaaien om te betalen.",
  drankPP: "Actief bijschenken: bij halflege glazen vragen of er nog iets bij mag. Dat is aandacht én omzet.",
  bestedingPP: "Suggestief verkopen: noem bij elke gang een bijpassend drankje of een bijgerecht.",
  medewerkers: "Vaste bediening per tafel (wijkindeling). Eén vast gezicht voelt als aandacht, vijf wisselende gezichten als drukte.",
  geannuleerd: "Annuleringen doorlopen: was het een aanslagfout, of ging er een gerecht terug? Bespreek het met keuken en bediening."
};

// items: [{ f, a, drukte }] (alleen gekoppelde reviews), totaal: aantal reviews in de periode
export function analyseAlles(items, totaal, S) {
  const D = S.drempelSlecht;
  const ontevreden = items.filter(x => x.f.score <= D), tevreden = items.filter(x => x.f.score >= 4);
  const scoreGem = l => gemVan(l.map(x => x.f.score));
  const foutloos = items.filter(x => x.a.missers === 0);

  // missers vs score
  const missersRijen = [0, 1, 2, 3].map(n => {
    const l = items.filter(x => (n === 3 ? x.a.missers >= 3 : x.a.missers === n));
    return { n, label: n === 3 ? "3 of meer" : String(n), aantal: l.length, score: scoreGem(l), slecht: l.filter(x => x.f.score <= D).length };
  });

  // scorevreters: per toets, hoeveel tafels missen hem en wat kost dat aan score
  const vreters = Object.keys(CHECKS).map(id => {
    const met = items.filter(x => x.a.checks.some(c => c.id === id));
    const mist = met.filter(x => x.a.checks.find(c => c.id === id).status === "let");
    const haalt = met.filter(x => x.a.checks.find(c => c.id === id).status === "goed");
    const sm = scoreGem(mist), sh = scoreGem(haalt);
    return { id, label: CHECKS[id].label, aantal: met.length, mist: mist.length, pct: met.length ? mist.length / met.length : 0,
      scoreMist: sm, scoreHaalt: sh, impact: sm != null && sh != null ? sh - sm : null,
      slechtAandeel: mist.length ? mist.filter(x => x.f.score <= D).length / mist.length : null };
  }).filter(v => v.aantal >= 3 && v.mist >= 2 && v.impact != null)
    // impact × hoe vaak het voorkomt = hoeveel score het de zaak kost
    .map(v => ({ ...v, kost: v.impact * v.pct })).sort((a, b) => b.kost - a.kost);

  // tevreden vs ontevreden per metriek
  const vergelijk = METRIEKEN.map(m => {
    const o = gemVan(getallen(ontevreden, x => waardeVan(m, x))), t = gemVan(getallen(tevreden, x => waardeVan(m, x)));
    const verschil = o != null && t != null && t !== 0 ? (o - t) / Math.abs(t) : null;
    return { ...m, ontevreden: o, tevreden: t, verschil };
  }).filter(v => v.ontevreden != null && v.tevreden != null);

  // patronen in gewone taal, sterkste eerst
  const patronen = [];
  if (ontevreden.length >= 2 && tevreden.length >= 2) {
    vergelijk.filter(v => v.hogerSlechter !== null && Math.abs(v.verschil) >= 0.15).forEach(v => {
      const slechter = v.hogerSlechter ? v.verschil > 0 : v.verschil < 0;
      if (!slechter) return;
      const fmt = x => v.eenheid === "€" ? euro(x) : v.eenheid === "min" ? Math.round(x) + " min" : een(x);
      const factor = v.ontevreden / v.tevreden;
      const hoeveel = factor >= 1.6 ? een(factor) + "× zo " + (v.eenheid === "min" ? "lang" : "veel") : Math.round(Math.abs(v.verschil) * 100) + "% " + (v.verschil > 0 ? "meer" : "minder");
      patronen.push({ id: v.id, kracht: Math.abs(v.verschil), tekst: `Ontevreden tafels: ${v.label.toLowerCase()} ${fmt(v.ontevreden)} tegen ${fmt(v.tevreden)} bij tevreden tafels (${hoeveel}).` });
    });
  }
  // combinatiepatroon: de "dodelijke combinatie"
  if (vreters.length >= 2) {
    const [a1, a2] = vreters;
    const beide = items.filter(x => [a1.id, a2.id].every(id => x.a.checks.find(c => c.id === id)?.status === "let"));
    if (beide.length >= 2) {
      const pct = beide.filter(x => x.f.score <= D).length / beide.length;
      patronen.push({ id: "combi", kracht: pct + 0.5, tekst: `Gevaarlijke combinatie: ${a1.label.toLowerCase()} én ${a2.label.toLowerCase()} buiten de norm. Van die ${beide.length} tafels was ${Math.round(pct * 100)}% ontevreden (gem. ${een(scoreGem(beide))}).` });
    }
  }
  const s0 = missersRijen[0], s2 = items.filter(x => x.a.missers >= 2);
  if (s0.aantal >= 3 && s2.length >= 2) patronen.push({ id: "missers", kracht: 0.9, tekst: `Foutloze tafels scoren gemiddeld ${een(s0.score)}, tafels met 2 of meer missers ${een(scoreGem(s2))}. Elke misser kost zichtbaar score.` });
  patronen.sort((a, b) => b.kracht - a.kracht);

  // drukte, groepsgrootte, tafels, medewerkers
  const druk = items.map(x => x.drukte).filter(v => v != null).sort((a, b) => a - b);
  const q1 = druk[Math.floor(druk.length / 3)], q2 = druk[Math.floor(druk.length * 2 / 3)];
  const drukteRijen = druk.length >= 6 ? [
    { label: `Rustig (≤${q1} tafels)`, l: items.filter(x => x.drukte != null && x.drukte <= q1) },
    { label: `Normaal`, l: items.filter(x => x.drukte > q1 && x.drukte <= q2) },
    { label: `Druk (>${q2} tafels)`, l: items.filter(x => x.drukte > q2) }
  ].map(x => ({ label: x.label, aantal: x.l.length, score: scoreGem(x.l), eersteDrank: gemVan(getallen(x.l, y => y.a.eersteDrank)) })) : [];

  const groepRijen = [["1–2 personen", 1, 2], ["3–4 personen", 3, 4], ["5 of meer", 5, 99]].map(([label, van, tot]) => {
    const l = items.filter(x => x.a.personen >= van && x.a.personen <= tot);
    return { label, aantal: l.length, score: scoreGem(l), drankPP: gemVan(getallen(l, y => y.a.drankPP)) };
  });

  const perTafel = {};
  items.forEach(x => { const t = x.a.r.tafel; if (t) (perTafel[t] = perTafel[t] || []).push(x); });
  const tafels = Object.entries(perTafel).filter(([, l]) => l.length >= 2).map(([t, l]) => ({ tafel: t, aantal: l.length, score: scoreGem(l), slecht: l.filter(x => x.f.score <= D).length })).sort((a, b) => a.score - b.score);

  const perMens = {};
  items.forEach(x => { const m = x.a.medewerkers.hoofd; if (m) (perMens[m] = perMens[m] || []).push(x); });
  const medewerkers = Object.entries(perMens).map(([naam, l]) => ({
    naam, tafels: l.length, score: scoreGem(l), slecht: l.filter(x => x.f.score <= D).length,
    eersteDrank: gemVan(getallen(l, y => y.a.eersteDrank)), drankPP: gemVan(getallen(l, y => y.a.drankPP)),
    foutloos: l.filter(y => y.a.missers === 0).length / l.length
  })).filter(m => m.tafels >= 3).sort((a, b) => b.score - a.score);

  // geld op tafel: tafels onder de drankjesnorm één drankje p.p. extra
  const onderNorm = items.filter(x => x.a.checks.find(c => c.id === "drankPP")?.status === "let");
  const prijs = gemVan(getallen(items, y => y.a.drankPrijs));
  const dagen = items.length ? Math.max(1, (Math.max(...items.map(x => x.f.ts)) - Math.min(...items.map(x => x.f.ts))) / 864e5) : 1;
  const extraPerWeek = prijs ? onderNorm.reduce((s, x) => s + (x.a.personen || 0), 0) * prijs / dagen * 7 : null;

  const advies = vreters.slice(0, 3).map(v => ({ ...v, tekst: (ADVIES[v.id] || "").replace("{n}", v.id === "eersteDrank" ? S.sheet.maxEersteDrankje : v.id === "langsteGat" ? Math.max(10, S.sheet.maxGat - 10) : "") }));

  return {
    totaal, gekoppeld: items.length, ontevreden: ontevreden.length, tevreden: tevreden.length,
    foutloosPct: items.length ? foutloos.length / items.length : null,
    scoreFoutloos: scoreGem(foutloos), scoreMetMissers: scoreGem(items.filter(x => x.a.missers > 0)),
    bestedingTevreden: gemVan(getallen(tevreden, x => x.a.bestedingPP)), bestedingOntevreden: gemVan(getallen(ontevreden, x => x.a.bestedingPP)),
    missersRijen, vreters, vergelijk, patronen, drukteRijen, groepRijen, tafels, medewerkers,
    geldOpTafel: { tafels: onderNorm.length, prijs, extraPerWeek },
    advies
  };
}

// Gemiddelden uit de eigen historie, voor de automatische normen.
export function normenUit(rekeningen, S) {
  const a = rekeningen.map(r => analyseer(r, S, {}));
  return { drankPP: gemVan(getallen(a, x => x.drankPP)), bestedingPP: gemVan(getallen(a, x => x.bestedingPP)), aantal: a.length };
}
// Aantal open tafels op een moment (drukte).
export const openOp = (rekeningen, ts) => rekeningen.filter(r => r.geopend <= ts && (r.afgerekend || Infinity) >= ts).length;
