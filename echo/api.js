// Echo-client. Praat met /api op Cloudflare Pages.
// Is er geen server (lokaal geopend of als demo), dan valt hij terug op een demo
// die alles in deze browser bewaart, met voorbeelddata.
import { DEFAULTS, metStandaard } from "./defaults.js";
import { maakKassa } from "./demo-kassa.js";
import { normenUit } from "./sheet.js";

// Live: Supabase (config.js). Met ?demo in de link (of zonder config): demo in deze browser met voorbeelddata.
const C = window.ECHO_CONFIG;
const demo = !C || new URLSearchParams(location.search).has("demo");
const FUNCTIE = C ? C.url + "/functions/v1/echo-gast" : "";
let sb = null;
function client() {
  if (!sb && !demo && window.supabase) {
    let onthoud = true; try { onthoud = localStorage.getItem("echo-onthoud") !== "0"; } catch (e) {}
    sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: onthoud ? window.localStorage : window.sessionStorage, storageKey: "echo-auth" } });
  }
  return sb;
}
const fout = (e, status) => { const x = new Error(typeof e === "string" ? e : e?.message || "fout"); x.status = status || e?.status; x.api = true; return x; };
async function call(_pad, _opts, demoFn, liveFn) { return demo ? demoFn() : liveFn(); }

export const isDemo = () => demo;
export const functieUrl = () => FUNCTIE;

// ---------- demo-opslag ----------
const geheugen = {};
function lees(z) {
  try { const v = localStorage.getItem("echo-demo2-" + z); if (v) return JSON.parse(v); } catch (e) {}
  return geheugen[z] || null;
}
function schrijf(z, d) {
  geheugen[z] = d;
  try { localStorage.setItem("echo-demo2-" + z, JSON.stringify(d)); } catch (e) {}
}
function demoStore(z) {
  let d = lees(z);
  if (!d) { d = { pin: "0000", settings: { ...DEFAULTS }, feedback: voorbeelden() }; schrijf(z, d); }
  d.settings = metStandaard(d.settings);
  return d;
}

function voorbeelden() {
  // Vaste "random" zodat de demo er elke keer hetzelfde uitziet.
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const opm = {
    5: ["Heerlijke bitterballen en super vriendelijke bediening!", "Top avond gehad, we komen terug.", "Lovely place, great fish!", ""],
    4: ["Lekker gegeten, wel even wachten op het toetje.", "Gezellig terras.", "", "Sehr nett, gerne wieder."],
    3: ["Eten was prima, maar het was erg druk.", "", "Muziek iets te hard."],
    2: ["Lang moeten wachten op de hoofdgerechten.", "Friet was koud.", ""],
    1: ["Na 40 minuten nog geen eten. Niemand kwam langs.", "Toilet was vies."]
  };
  const ond = DEFAULTS.onderdelen.map(o => o.nl);
  const bronnen = ["viltje", "viltje", "viltje", "toilet", "mail"];
  const nu = Date.now(); const lijst = [];
  for (let i = 0; i < 74; i++) {
    const dagen = Math.floor(r() * 56);
    const uur = r() < 0.35 ? 12 + Math.floor(r() * 3) : 17 + Math.floor(r() * 5);
    const d = new Date(nu - dagen * 864e5); d.setHours(uur, Math.floor(r() * 60), 0, 0);
    if (d.getTime() > nu) d.setTime(d.getTime() - 864e5);
    const x = r(); const score = x < 0.05 ? 1 : x < 0.13 ? 2 : x < 0.28 ? 3 : x < 0.6 ? 4 : 5;
    const n = Math.floor(r() * 3);
    const tags = [...new Set(Array.from({ length: n }, () => ond[Math.floor(r() * (score <= 2 ? 5 : ond.length))]))];
    const lijstOpm = opm[score]; const opmerking = lijstOpm[Math.floor(r() * lijstOpm.length)];
    const contact = score <= 2 && r() < 0.5 ? { naam: "Gast " + (i + 1), tel: "06 " + String(Math.floor(r() * 1e8)).padStart(8, "1") } : null;
    lijst.push({ id: i + 1, ts: d.getTime(), score, bron: bronnen[Math.floor(r() * bronnen.length)], tags, opmerking, contact, taal: /[a-z]+ place|great|Lovely/.test(opmerking) ? "en" : /Sehr/.test(opmerking) ? "de" : "nl", voorbeeld: true });
  }
  return lijst.sort((a, b) => b.ts - a.ts);
}

// Demo-kassadata: wordt elke keer opnieuw (en hetzelfde) berekend uit de feedback.
const kassaCache = {};
function demoKassa(z, d) {
  const sleutel = d.feedback.length + ":" + (d.feedback[0]?.id || "");
  if (kassaCache[z]?.sleutel !== sleutel) {
    const vooraf = JSON.stringify(d.feedback.map(f => f.tafel));
    const rekeningen = maakKassa(d.feedback);
    if (JSON.stringify(d.feedback.map(f => f.tafel)) !== vooraf) schrijf(z, d); // tafelnummers vastleggen
    kassaCache[z] = { sleutel, rekeningen };
  }
  return kassaCache[z].rekeningen;
}

const publiek = s => { const c = structuredClone(s); delete c.meldingen; return c; };

// ---------- API ----------
const ms = t => new Date(t).getTime();
export const api = {
  // openbare instellingen voor het gastformulier
  zaak: z => call(0, 0, () => publiek(demoStore(z).settings), async () => {
    const r = await fetch(FUNCTIE);
    if (!r.ok) throw fout("Onbekende zaak.", r.status);
    return metStandaard(await r.json());
  }),

  stuur: (z, fb) => call(0, 0, () => {
    const d = demoStore(z);
    const item = { ...fb, id: Date.now(), ts: Date.now() };
    d.feedback.unshift(item); schrijf(z, d);
    return { ok: true, id: item.id };
  }, async () => {
    const r = await fetch(FUNCTIE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fb) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw fout(d.fout || "Versturen lukte niet.", r.status);
    return d;
  }),

  // gast sluit de pagina na alleen een gezicht: score toch versturen (text/plain = geen CORS-voorcontrole)
  baken: fb => { if (demo || !navigator.sendBeacon) return false; return navigator.sendBeacon(FUNCTIE, new Blob([JSON.stringify(fb)], { type: "text/plain" })); },

  // ---- inloggen (zelfde accounts en teamlijst als Fill) ----
  sessie: async () => {
    if (demo) return { email: "demo", demo: true };
    const { data: { session } } = await client().auth.getSession();
    if (!session) return null;
    const { data: ok, error } = await client().rpc("is_team");
    if (error || ok !== true) return { email: session.user.email, geenToegang: true };
    return { email: session.user.email };
  },
  login: async (email, wachtwoord, onthoud) => {
    try { localStorage.setItem("echo-onthoud", onthoud ? "1" : "0"); } catch (e) {}
    sb = null; // opnieuw maken met de juiste opslag
    const { error } = await client().auth.signInWithPassword({ email, password: wachtwoord });
    if (error) throw fout(/invalid/i.test(error.message) ? "E-mail of wachtwoord klopt niet." : error.message, 401);
    return api.sessie();
  },
  uitloggen: async () => { if (!demo) await client().auth.signOut(); },

  overzicht: (z) => call(0, 0, () => { const d = demoStore(z); demoKassa(z, d); return { settings: d.settings, feedback: d.feedback }; }, async () => {
    const [inst, fb] = await Promise.all([
      client().from("echo_instellingen").select("settings").eq("id", 1).maybeSingle(),
      client().from("echo_feedback").select("id, ts, score, bron, tafel, taal, tags, opmerking, contact, onvolledig, rekening")
        .gte("ts", new Date(Date.now() - 400 * 864e5).toISOString()).order("ts", { ascending: false }).limit(5000)
    ]);
    if (inst.error || fb.error) throw fout(inst.error || fb.error, 500);
    return { settings: metStandaard(inst.data?.settings || {}), feedback: fb.data.map(f => ({ ...f, ts: ms(f.ts), rekening: f.rekening != null ? String(f.rekening) : null })) };
  }),

  bewaar: (z, settings) => call(0, 0, () => { const d = demoStore(z); d.settings = metStandaard(settings); schrijf(z, d); return { ok: true }; }, async () => {
    const { error } = await client().from("echo_instellingen").update({ settings, bijgewerkt: new Date().toISOString() }).eq("id", 1);
    if (error) throw fout(error, 500);
    return { ok: true };
  }),

  testMelding: () => call(0, 0, () => ({ ok: true, demo: true }), async () => {
    const { data: { session } } = await client().auth.getSession();
    const r = await fetch(FUNCTIE, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ actie: "test" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw fout(d.fout || "Versturen lukte niet.", r.status);
    return d;
  }),

  // Kassadata rond de reviews + normen uit de historie
  kassa: (z, dagen = 120) => call(0, 0, () => {
    const d = demoStore(z); const rekeningen = demoKassa(z, d);
    return { rekeningen, normen: normenUit(rekeningen, d.settings), status: { aan: true, demo: true, laatste: Date.now() } };
  }, async () => {
    const { data, error } = await client().rpc("echo_kassa", { p_dagen: dagen });
    if (error) throw fout(error, 500);
    return data;
  }),

  koppel: (z, feedbackId, rekeningId) => call(0, 0, () => {
    const d = demoStore(z); const f = d.feedback.find(x => x.id === feedbackId);
    if (f) { f.rekening = rekeningId || null; schrijf(z, d); }
    return { ok: true };
  }, async () => {
    const { error } = await client().from("echo_feedback").update({ rekening: rekeningId ? Number(rekeningId) : null }).eq("id", feedbackId);
    if (error) throw fout(error, 500);
    return { ok: true };
  }),

  demoReset: z => { try { localStorage.removeItem("echo-demo2-" + z); } catch (e) {} delete geheugen[z]; delete kassaCache[z]; }
};

// Gezichtje als inline SVG. score 1..5
export function gezicht(score, kleur) {
  const mond = { 1: "M14 33 Q24 24 34 33", 2: "M15 32 Q24 28 33 32", 3: "M15 31 L33 31", 4: "M15 29 Q24 35 33 29", 5: "M13 28 Q24 40 35 28" }[score];
  const ogen = score === 1 ? '<path d="M14 17l5 3M34 17l-5 3" stroke-width="3"/>' : "";
  return `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="${kleur}" stroke-linecap="round" stroke-linejoin="round">
<circle cx="24" cy="24" r="21" stroke-width="3" fill="${kleur}22"/>${ogen}
<circle cx="17" cy="21" r="2.6" fill="${kleur}" stroke="none"/><circle cx="31" cy="21" r="2.6" fill="${kleur}" stroke="none"/>
<path d="${mond}" stroke-width="3.2"/></svg>`;
}
