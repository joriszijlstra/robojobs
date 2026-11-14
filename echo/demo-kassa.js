// Alleen voor de demo: verzonnen kassadata (zoals unTill die zou leveren) bij de voorbeeldreviews.
// Vast zaadje per review, zodat de demo er elke keer hetzelfde uitziet.
// Tevreden tafels krijgen gemiddeld sneller hun drankje, meer aandacht en minder wisselingen;
// er zit bewust ruis in, zodat niet elke review netjes in het patroon past.

const MIN = 6e4;
const MENSEN = ["Sanne", "Joep", "Lotte", "Bas", "Mila", "Daan"];
const KAART = {
  drank: [["Heineken tap", "Bier", 3.6], ["Affligem blond", "Bier", 5.2], ["Huiswijn wit", "Wijn", 5.5], ["Huiswijn rood", "Wijn", 5.5], ["Cola", "Fris", 3.4], ["Spa rood", "Fris", 3.2], ["Cappuccino", "Warme dranken", 3.5], ["Jonge jenever", "Gedistilleerd", 3.9]],
  voor: [["Bitterballen 8st", "Bar snacks", 8.5], ["Carpaccio", "Voorgerechten", 12.5], ["Soep van de dag", "Voorgerechten", 7.5], ["Garnalenkroketten", "Voorgerechten", 11]],
  hoofd: [["Kibbeling", "Hoofdgerechten", 19.5], ["Schnitzel", "Hoofdgerechten", 21], ["Saté van de haas", "Hoofdgerechten", 23.5], ["Kwikkelburger", "Hoofdgerechten", 18.5], ["Vis van de dag", "Hoofdgerechten", 24]],
  na: [["Dame blanche", "Nagerechten", 8], ["Apple pie", "Nagerechten", 7.5], ["Kaasplankje", "Nagerechten", 11]]
};

function rng(seed) { let s = (Math.abs(seed * 9301 + 49297) % 233280) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Bouwt één rekening. q = kwaliteit 0..1 (hoe goed het liep).
function rekening(id, tafel, q, r, eindRond, drukker) {
  const tussen = (a, b) => a + r() * (b - a);
  const kies = l => l[Math.floor(r() * l.length)];
  const personen = kies([2, 2, 2, 2, 3, 4, 4, 4, 5, 6]);
  const vast = kies(MENSEN);
  const regels = [];
  const door = () => (r() < 0.45 + q * 0.5 ? vast : kies(MENSEN));
  const sla = (t, soort, n) => { const wie = door(); for (let i = 0; i < n; i++) { const [artikel, groep, prijs] = kies(KAART[soort]); const bestaand = regels.find(x => x.ts === t && x.artikel === artikel); if (bestaand) bestaand.aantal++; else regels.push({ ts: t, door: wie, artikel, groep, aantal: 1, prijs }); } };

  let t = 0;
  const eersteDrank = (q > 0.55 ? tussen(2, 8) : tussen(7, 22)) + (drukker ? tussen(2, 9) : 0);
  t += eersteDrank * MIN; sla(t, "drank", personen);
  const metVoor = r() < 0.7;
  let tv = null;
  if (metVoor) { tv = t + tussen(4, 12) * MIN; sla(tv, "voor", Math.max(1, Math.round(personen * tussen(0.4, 1)))); }
  const th = (tv || t) + (metVoor ? (q > 0.55 ? tussen(16, 30) : tussen(30, 55)) : tussen(8, 18)) * MIN;
  sla(th, "hoofd", personen);
  // drankrondes tussendoor
  // drankrondes: goede tafels krijgen regelmatig een nieuw drankje, slechte staan langer droog
  const interval = () => (q > 0.55 ? tussen(16, 30) : tussen(28, 60)) * MIN;
  for (let td = t + interval(); td < th + 30 * MIN; td += interval()) if (r() < 0.6 + q * 0.4) sla(td, "drank", Math.max(1, Math.round(personen * tussen(0.5, 1))));
  let laatst = Math.max(...regels.map(x => x.ts));
  if (r() < 0.2 + q * 0.5) { const tn = th + tussen(30, 50) * MIN; sla(tn, "na", Math.max(1, Math.round(personen * tussen(0.4, 1)))); if (r() < 0.5) sla(tn + MIN, "drank", Math.ceil(personen / 2)); laatst = Math.max(laatst, tn + MIN); }
  if (q < 0.4 && r() < 0.35) { const x = regels.find(y => y.groep === "Hoofdgerechten"); regels.push({ ...x, ts: x.ts + tussen(8, 20) * MIN, aantal: -1, door: door() }); }
  const afgerekend = Math.max(laatst, ...regels.map(x => x.ts)) + (q > 0.55 ? tussen(6, 22) : tussen(18, 45)) * MIN;

  // verschuif zodat het eind op het gevraagde moment valt
  const schuif = eindRond - afgerekend;
  regels.forEach(x => x.ts = Math.round(x.ts + schuif));
  regels.sort((a, b) => a.ts - b.ts);
  const totaal = Math.round(regels.reduce((s, x) => s + x.aantal * x.prijs, 0) * 100) / 100;
  return {
    id, tafel: String(tafel), personen: r() < 0.15 ? 0 : personen,
    geopend: Math.round(schuif), geopendDoor: vast, afgerekend: Math.round(eindRond), afgerekendDoor: r() < 0.6 + q * 0.3 ? vast : kies(MENSEN),
    totaal, regels
  };
}

// Maakt rekeningen bij alle feedback. Zet bij voorbeeldreviews ook een tafelnummer (zoals de gast het intikt).
export function maakKassa(feedback) {
  const uit = [];
  let nr = 4100;
  for (const f of feedback) {
    const r = rng(Number(f.id) % 100000 + 11);
    const q = Math.min(1, Math.max(0, [0.08, 0.25, 0.5, 0.72, 0.88][f.score - 1] + (r() - 0.5) * 0.35));
    const gok = String(1 + Math.floor(r() * 24)), tikt = r() < (f.bron === "mail" ? 0.45 : 0.8);
    if (f.voorbeeld && f.tafel === undefined) f.tafel = tikt ? gok : "";
    const tafel = f.tafel || gok;
    const drukker = q < 0.45 ? r() < 0.85 : r() < 0.2;
    // review rond het afrekenen (viltje/toilet), of de volgende dag (mail)
    const eind = f.bron === "mail" ? f.ts - (21 + r() * 5) * 60 * MIN : f.ts + (r() * 25 - 10) * MIN;
    uit.push(rekening("B" + nr++, tafel, q, r, eind, drukker));
    // andere tafels die tegelijk open waren
    const anderen = drukker ? 6 + Math.floor(r() * 6) : 1 + Math.floor(r() * 4);
    const bezet = new Set([tafel]);
    for (let i = 0; i < anderen; i++) {
      let t2; do { t2 = String(1 + Math.floor(r() * 24)); } while (bezet.has(t2)); bezet.add(t2);
      uit.push(rekening("B" + nr++, t2, r(), r, eind + (r() * 80 - 30) * MIN, drukker));
    }
  }
  return uit;
}
