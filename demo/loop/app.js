// ============================================================================
// MEP-lijst — Eetcafé de Kwikkel
// Werkt met Firebase Firestore als firebase-config.js is ingevuld (live sync
// tussen alle apparaten). Zonder geldige config valt de app automatisch terug
// op lokale opslag in deze browser ("demo/losstaande modus"), zodat de app
// altijd meteen te gebruiken is.
//
// Vanaf deze versie zijn er TWEE lijsten naast elkaar:
//  - "Vandaag"            → wat vandaag daadwerkelijk uitgevoerd/afgevinkt wordt
//  - "Morgen voorbereiden" → hoeveelheden alvast invullen voor de volgende dag
// Elke kalenderdag heeft zijn eigen opgeslagen lijst (dayStates/{YYYY-MM-DD}),
// zodat je altijd vooruit kunt werken terwijl de lijst van vandaag gewoon
// doorloopt, en zodat er geschiedenis is voor de rapportage.
// ============================================================================

// Kleuren rechtstreeks afgeleid van het echte Kwikkel-beeldmerk (bruin/goud/olijf),
// elk getoetst op voldoende contrast met witte tekst.
// Bewust geen oranje/amber/goud: die tinten verkleuren bij het verdonkeren
// van de kop-gradient (zie gradientFor hieronder) al snel naar bruin, wat
// niet meer bij de rest van de paarse/glazen "Loop"-stijl past.
const CATEGORY_PALETTE = ["#7C3AED", "#10B981", "#0EA5E9", "#EC4899", "#6366F1", "#14B8A6"];

// Vanaf hoeveel opeenvolgende nachten een item onafgerond is doorgeschoven
// (zie carryStreak, bijgehouden in rolloverIfNeeded) telt het als "blijft
// steeds liggen" en krijgt het de zware, opvallende stijl i.p.v. de gewone,
// mildere "bleef gisteren openstaan"-badge. Op 2 gezet: bij de eerste keer
// doorschuiven (1 nacht gemist) blijft de bestaande milde badge volstaan, pas
// als het een 2e nacht ACHTEREEN blijft liggen (dus voor de 3e dag op rij nog
// open staat) knalt het er echt uit — ook op het dashboard.
const STALE_CARRY_DAYS = 2;
// Instelbaar per zaak via Beheer > Zaak; 2 is de standaard.
function staleCarryDays() { const n = Number(typeof state !== "undefined" && state.zaak ? state.zaak.blijftLiggenDagen : NaN); return Number.isFinite(n) && n >= 1 ? Math.round(n) : STALE_CARRY_DAYS; }

function slugify(s) {
  return (s || "").toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ----------------------------------------------------------------------------
// Apparaat-goedkeuring: Joris kan de app op slot zetten voor onbekende
// toestellen. Zie accessGatingActive() hierboven voor het analoge idee bij
// toegangscodes per persoon — dit is hetzelfde principe, maar dan per
// TOESTEL i.p.v. per persoon, en volledig los daarvan te gebruiken.
// ----------------------------------------------------------------------------
// Een code is 30 minuten geldig — lang genoeg om 'm mondeling of via een
// appje door te geven aan iemand op het nieuwe toestel, kort genoeg dat een
// oude code niet blijft rondslingeren.
const DEVICE_CODE_TTL_MS = 30 * 60 * 1000;

// Geen 0/O/1/I: die worden op een klein schermpje makkelijk verward.
function genDeviceCode() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Elk toestel krijgt bij het eerste bezoek een eigen, willekeurig ID dat
// alleen lokaal (in dit browserprofiel) wordt bewaard — dit is bewust GEEN
// hardware- of accountgebonden identifier, puur "is dit toestel al eerder
// door Joris goedgekeurd".
function getDeviceId() {
  let id = localStorage.getItem("mep_device_id");
  if (!id) {
    id = "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("mep_device_id", id);
  }
  return id;
}

// Maakt van een egale categoriekleur een diagonale gradient (donkerder tweede
// stop), voor een moderner, wat "flitsender" kaartkopje dan een vlakke kleur.
function shadeHex(hex, percent) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return hex;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const f = (c) => clamp(Math.round(c + (percent < 0 ? c : 255 - c) * percent)).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function gradientFor(hex) {
  const dark = shadeHex(hex, -0.38);
  const light = shadeHex(hex, 0.12);
  return `linear-gradient(135deg, ${light} 0%, ${hex} 45%, ${dark} 100%)`;
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDateKey(k) {
  const [y, m, d] = (k || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function mondayOfWeek(d) {
  const day = d.getDay(); // 0 = zondag
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}
function formatDutchDate(d) {
  const s = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shortDutchDate(d) {
  const s = d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Standaard-vorm van één dag-document — gedeeld door beide backends, zodat
// elke lijst (vandaag/morgen/geschiedenis) altijd dezelfde velden heeft.
function defaultDayDoc(key) {
  return {
    workDateKey: key,
    workDateLabel: formatDutchDate(parseDateKey(key)),
    gemaaktDoor: "",
    opmerkingen: "",
    personeelsetenGisteren: "",
    items: {},
    approved: false,
    approvedBy: "",
    approvedAt: null,
    rolloverAppliedFrom: null,
  };
}

// ----------------------------------------------------------------------------
// Helpers om de status van een item te bepalen — houdt rekening met producten
// die uit meerdere stappen bestaan (bv. Atjar: snijden → inleggen → op smaak
// maken → klaar). Deze worden gedeeld door de render-code én de backends
// (voor de dagelijkse rollover), zodat de logica maar op één plek staat.
// ----------------------------------------------------------------------------
function stepStatus(menuItem, st) {
  const steps = menuItem && Array.isArray(menuItem.stappen) ? menuItem.stappen : null;
  if (!steps || steps.length === 0) return { hasSteps: false, total: 0, done: 0, isDone: false };
  const doneMap = (st && st.steps) || {};
  let done = 0;
  for (let i = 0; i < steps.length; i++) {
    if (doneMap[i] && doneMap[i].checked) done++;
  }
  return { hasSteps: true, total: steps.length, done, isDone: done === steps.length };
}
function itemIsDone(menuItem, st) {
  if (!st) return false;
  const ss = stepStatus(menuItem, st);
  if (ss.hasSteps) return ss.isDone;
  return !!st.checked;
}
// "Er is al iets mee gebeurd, maar nog niet klaar" — bepaalt of een item als
// 'open' geldt (gele rand) en of het de volgende dag moet blijven staan.
function itemIsOpen(menuItem, st) {
  // Een "taak" (geenHoeveelheid, bv. "Frituur links verschonen") heeft geen
  // hoeveelheid-veld dat eerst bewust ingevuld moet worden om als relevant te
  // gelden — die is gewoon elke dag opnieuw relevant totdat 'm is afgevinkt,
  // ook als er verder nog niets mee gebeurd is vandaag (dus zelfs zonder een
  // eigen dagstatus-document). Dit moet daarom vóór de "!st"-uitstap staan.
  if (menuItem && menuItem.geenHoeveelheid) return !itemIsDone(menuItem, st);
  if (!st) return false;
  if (itemIsDone(menuItem, st)) return false;
  const ss = stepStatus(menuItem, st);
  const hasQty = !!(st.hoeveelheid && st.hoeveelheid.trim());
  const hasNote = !!(st.note && st.note.trim());
  if (ss.hasSteps) return ss.done > 0 || hasQty || hasNote;
  return hasQty || hasNote;
}

// Voor het "Morgen voorbereiden"-tabblad: als iets vandaag nog openstaat
// (aangevangen maar niet afgerond) én er nog geen eigen voorbereiding voor
// morgen is ingevuld, laten we nu al zien dat het toch automatisch op de
// lijst van morgen terechtkomt (dat gebeurt normaal pas 's nachts bij de
// dagwissel). Dit is puur een voorvertoning in het scherm — er wordt niets
// weggeschreven totdat iemand het zelf aanpast, of totdat de echte overdracht
// 's nachts plaatsvindt. Zo hoeft niemand hetzelfde werk twee keer te plannen.
function tomorrowPreview(item) {
  const st = state.dayTomorrow.items[item.id];
  const hasOwn = st && st.hoeveelheid && st.hoeveelheid.trim();
  if (hasOwn) return { value: st.hoeveelheid, carried: false };
  const todaySt = state.dayToday.items[item.id];
  if (itemIsOpen(item, todaySt)) {
    return { value: (todaySt && todaySt.hoeveelheid) || "", carried: true };
  }
  return { value: (st && st.hoeveelheid) || "", carried: false };
}

// ----------------------------------------------------------------------------
// Store: eenduidige interface voor UI-code, met twee implementaties eronder.
// Dagstatus-methoden nemen nu altijd een "dateKey" (YYYY-MM-DD) als eerste
// argument, zodat "vandaag" en "morgen" gewoon twee losse documenten zijn.
// ----------------------------------------------------------------------------
const Store = {
  mode: "local", // 'cloud' | 'local'
  ready: null,
  onMenu() {}, onCategories() {}, onDayState() {}, onTeam() {}, onAccessCodes() {}, onPlanning() {},
  onTelegramSettings() {}, setTelegramSettings() {}, onZaakSettings() {}, setZaakSettings() {},
  onWhatsappSettings() {}, setWhatsappSettings() {},
  onDevices() {}, generateDeviceCode() {}, clearDeviceCode() {}, approveDevice() {}, revokeDevice() {},
  setItemField() {}, setStep() {}, setNote() {}, clearItem() {}, setHeader() {},
  approveDay() {}, getDayStatesRange() {},
  addTeamMember() {}, removeTeamMember() {}, setAccessCode() {}, setAdminFlag() {},
  addItem() {}, removeItem() {}, updateItem() {},
  addCategory() {}, updateCategory() {},
  addPlanning() {}, removePlanning() {},
  rolloverIfNeeded() {},
  migrateLegacyIfNeeded() {},
  seedIfEmpty() {},
};

// ----------------------------------------------------------------------------
// LOCAL fallback backend (localStorage, alleen dit toestel/browser)
// ----------------------------------------------------------------------------
function makeLocalBackend() {
  const LS = {
    cats: "mep_categories",
    items: "mep_menuItems",
    team: "mep_team",
    accessCodes: "mep_access_codes",
    devices: "mep_devices",
    dateIndex: "mep_dayState_dates",
    legacyDay: "mep_dayState", // oude single-lijst sleutel, alleen nog voor migratie
    planning: "mep_planning", // vooruit ingeplande items (los van een specifieke dag)
    zaak: "mep_zaak_settings", telegram: "mep_telegram_settings", // bot-token/chat-id voor de Telegram-melding
    whatsapp: "mep_whatsapp_settings", // telefoonnummer/apikey voor de CallMeBot-melding
  };
  const dayKey = (k) => `mep_dayState_${k}`;
  const bus = new EventTarget();

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    bus.dispatchEvent(new CustomEvent(key));
  }
  // Sync tussen tabs op hetzelfde toestel
  window.addEventListener("storage", (e) => {
    if (e.key && (Object.values(LS).includes(e.key) || e.key.startsWith("mep_dayState_"))) {
      bus.dispatchEvent(new CustomEvent(e.key));
    }
  });

  function addToIndex(k) {
    const idx = read(LS.dateIndex, []);
    if (!idx.includes(k)) {
      idx.push(k);
      idx.sort();
      write(LS.dateIndex, idx);
    }
  }

  function ensureDayFor(k) {
    let d = read(dayKey(k), null);
    if (!d) {
      d = defaultDayDoc(k);
      write(dayKey(k), d);
      addToIndex(k);
    }
    return d;
  }

  return {
    mode: "local",
    ready: Promise.resolve(),

    onMenu(cb) {
      const fn = () => cb(read(LS.items, []));
      bus.addEventListener(LS.items, fn);
      fn();
      return () => bus.removeEventListener(LS.items, fn);
    },
    onCategories(cb) {
      const fn = () => cb(read(LS.cats, []));
      bus.addEventListener(LS.cats, fn);
      fn();
      return () => bus.removeEventListener(LS.cats, fn);
    },
    onTeam(cb) {
      const fn = () => cb(read(LS.team, []));
      bus.addEventListener(LS.team, fn);
      fn();
      return () => bus.removeEventListener(LS.team, fn);
    },
    onAccessCodes(cb) {
      const fn = () => cb(read(LS.accessCodes, { codes: {}, admins: [] }));
      bus.addEventListener(LS.accessCodes, fn);
      fn();
      return () => bus.removeEventListener(LS.accessCodes, fn);
    },
    onDevices(cb) {
      const fn = () => cb(read(LS.devices, { approved: {}, pendingCode: null, activated: false }));
      bus.addEventListener(LS.devices, fn);
      fn();
      return () => bus.removeEventListener(LS.devices, fn);
    },
    onDayState(k, cb) {
      const key = dayKey(k);
      const fn = () => cb(ensureDayFor(k));
      bus.addEventListener(key, fn);
      fn();
      return () => bus.removeEventListener(key, fn);
    },
    onPlanning(cb) {
      const fn = () => cb(read(LS.planning, []));
      bus.addEventListener(LS.planning, fn);
      fn();
      return () => bus.removeEventListener(LS.planning, fn);
    },
    onZaakSettings(cb) {
      const fn = () => cb(read(LS.zaak, {}));
      bus.addEventListener(LS.zaak, fn);
      fn();
      return () => bus.removeEventListener(LS.zaak, fn);
  },
  onTelegramSettings(cb) {
      const fn = () => cb(read(LS.telegram, { enabled: false, botToken: "", chatId: "" }));
      bus.addEventListener(LS.telegram, fn);
      fn();
      return () => bus.removeEventListener(LS.telegram, fn);
    },
    onWhatsappSettings(cb) {
      const fn = () => cb(read(LS.whatsapp, { enabled: false, phone: "", apikey: "" }));
      bus.addEventListener(LS.whatsapp, fn);
      fn();
      return () => bus.removeEventListener(LS.whatsapp, fn);
    },

    setItemField(k, itemId, patch) {
      const d = ensureDayFor(k);
      d.items[itemId] = { ...(d.items[itemId] || {}), ...patch };
      write(dayKey(k), d);
    },
    setStep(k, itemId, stepIndex, patch) {
      const d = ensureDayFor(k);
      const cur = d.items[itemId] || { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {} };
      const steps = { ...(cur.steps || {}) };
      steps[stepIndex] = { ...(steps[stepIndex] || {}), ...patch };
      d.items[itemId] = { ...cur, steps };
      write(dayKey(k), d);
    },
    setNote(k, itemId, note) {
      const d = ensureDayFor(k);
      const cur = d.items[itemId] || { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, steps: {} };
      d.items[itemId] = { ...cur, note };
      write(dayKey(k), d);
    },
    clearItem(k, itemId) {
      const d = ensureDayFor(k);
      d.items[itemId] = { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {} };
      write(dayKey(k), d);
    },
    setHeader(k, patch) {
      const d = ensureDayFor(k);
      Object.assign(d, patch);
      write(dayKey(k), d);
    },
    approveDay(k, { door }) {
      const d = ensureDayFor(k);
      d.approved = true;
      d.approvedBy = door;
      d.approvedAt = Date.now();
      write(dayKey(k), d);
    },
    getDayStatesRange(startKey, endKey) {
      const idx = read(LS.dateIndex, []);
      return idx
        .filter((k) => k >= startKey && k <= endKey)
        .map((k) => ({ dateKey: k, data: read(dayKey(k), null) }))
        .filter((x) => x.data);
    },

    addTeamMember(name) {
      const t = read(LS.team, []);
      if (!t.includes(name)) { t.push(name); write(LS.team, t); }
    },
    removeTeamMember(name) {
      write(LS.team, read(LS.team, []).filter((n) => n !== name));
      // Ook de toegangscode van deze persoon opruimen, anders blijft er een
      // ongebruikte code (en eventueel beheerderschap) rondslingeren voor een
      // naam die niet meer bestaat.
      const data = read(LS.accessCodes, { codes: {}, admins: [] });
      let changed = false;
      if (data.codes && data.codes[name] !== undefined) { delete data.codes[name]; changed = true; }
      if (Array.isArray(data.admins) && data.admins.includes(name)) {
        data.admins = data.admins.filter((n) => n !== name);
        changed = true;
      }
      if (changed) write(LS.accessCodes, data);
    },
    setAccessCode(name, code) {
      const data = read(LS.accessCodes, { codes: {}, admins: [] });
      data.codes = data.codes || {};
      const trimmed = (code || "").trim();
      if (trimmed) {
        data.codes[name] = trimmed;
        data.activated = true; // eenmaal aan, blijft aan (zie accessGatingActive)
      } else {
        delete data.codes[name];
      }
      write(LS.accessCodes, data);
    },
    setAdminFlag(name, isAdmin) {
      const data = read(LS.accessCodes, { codes: {}, admins: [] });
      const admins = Array.isArray(data.admins) ? data.admins : [];
      const has = admins.includes(name);
      if (isAdmin && !has) data.admins = [...admins, name];
      if (!isAdmin && has) data.admins = admins.filter((n) => n !== name);
      write(LS.accessCodes, data);
    },

    // Genereert een nieuwe eenmalige goedkeuringscode en activeert daarmee
    // (permanent, net als bij accessCodes) de apparaat-gating — vanaf dat
    // moment moet elk niet eerder goedgekeurd toestel deze (of een latere)
    // code invoeren om verder te kunnen.
    generateDeviceCode() {
      const data = read(LS.devices, { approved: {}, pendingCode: null, activated: false });
      const code = genDeviceCode();
      data.pendingCode = { code, createdAt: Date.now() };
      data.activated = true;
      write(LS.devices, data);
      return code;
    },
    clearDeviceCode() {
      const data = read(LS.devices, { approved: {}, pendingCode: null, activated: false });
      data.pendingCode = null;
      write(LS.devices, data);
    },
    // Laat "activated" bewust ongewijzigd: dit wordt ook gebruikt om het
    // eigen beheerdertoestel automatisch te bevestigen zonder daarmee per
    // ongeluk de gating voor iedereen aan te zetten.
    approveDevice(id, label) {
      const data = read(LS.devices, { approved: {}, pendingCode: null, activated: false });
      data.approved = data.approved || {};
      data.approved[id] = { label: (label || "Toestel").trim(), approvedAt: Date.now() };
      write(LS.devices, data);
    },
    revokeDevice(id) {
      const data = read(LS.devices, { approved: {}, pendingCode: null, activated: false });
      if (data.approved) delete data.approved[id];
      write(LS.devices, data);
    },

    addItem({ categorie, naam }) {
      const items = read(LS.items, []);
      const id = `${categorie}__${slugify(naam)}-${Date.now().toString(36)}`;
      items.push({ id, naam, categorie, order: items.length, actief: true, stappen: [] });
      write(LS.items, items);
    },
    removeItem(itemId) {
      // We halen het item alleen uit de productenlijst. Eerder ingevulde
      // dagstatussen (ook uit het verleden) laten we met rust: die blijven
      // gewoon bestaan als geschiedenis voor de rapportage, maar worden
      // nergens meer getoond omdat het product niet meer in de lijst staat.
      write(LS.items, read(LS.items, []).filter((i) => i.id !== itemId));
    },
    updateItem(itemId, patch) {
      const items = read(LS.items, []);
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx >= 0) { items[idx] = { ...items[idx], ...patch }; write(LS.items, items); }
    },
    addCategory(cat) {
      const cats = read(LS.cats, []);
      cats.push(cat);
      write(LS.cats, cats);
    },
    updateCategory(catId, patch) {
      const cats = read(LS.cats, []);
      const idx = cats.findIndex((c) => c.id === catId);
      if (idx >= 0) { cats[idx] = { ...cats[idx], ...patch }; write(LS.cats, cats); }
    },

    addPlanning({ itemId, targetDateKey, note, createdBy }) {
      const list = read(LS.planning, []);
      const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      list.push({ id, itemId, targetDateKey, note: (note || "").trim(), createdBy: createdBy || "", createdAt: Date.now() });
      write(LS.planning, list);
      return id;
    },
    removePlanning(id) {
      write(LS.planning, read(LS.planning, []).filter((p) => p.id !== id));
    },
    setZaakSettings(patch) {
      const cur = read(LS.zaak, {});
      write(LS.zaak, { ...cur, ...patch });
  },
  setTelegramSettings(patch) {
      const cur = read(LS.telegram, { enabled: false, botToken: "", chatId: "" });
      write(LS.telegram, { ...cur, ...patch });
    },
    setWhatsappSettings(patch) {
      const cur = read(LS.whatsapp, { enabled: false, phone: "", apikey: "" });
      write(LS.whatsapp, { ...cur, ...patch });
    },

    seedIfEmpty(defaultCategories, defaultItems, defaultTeam) {
      if (read(LS.cats, []).length === 0) {
        write(LS.cats, defaultCategories.map((c, i) => ({ ...c, order: i })));
      }
      if (read(LS.items, []).length === 0) write(LS.items, defaultItems);
      if (read(LS.team, []).length === 0 && defaultTeam && defaultTeam.length) {
        write(LS.team, defaultTeam);
      }
    },

    // Eenmalige migratie van het oude één-lijst-model: als er nog een oude
    // "mep_dayState" staat die over vandaag gaat, en er nog geen nieuw
    // per-datum document voor vandaag bestaat, kopiëren we 'm over zodat er
    // geen ingevulde data verloren gaat bij deze update.
    async migrateLegacyIfNeeded(todayKey) {
      if (read(dayKey(todayKey), null)) return;
      const legacy = read(LS.legacyDay, null);
      if (legacy && legacy.workDateKey === todayKey) {
        write(dayKey(todayKey), { ...defaultDayDoc(todayKey), ...legacy, workDateKey: todayKey });
        addToIndex(todayKey);
      }
    },

    // Zorgt dat er een document voor "vandaag" bestaat en trekt nog-openstaande
    // (niet afgeronde) items van gisteren door, tenzij vandaag daar al bewust
    // een eigen waarde voor heeft (bv. al voorbereid). Dit gebeurt maar één
    // keer per kalenderdag-wissel (bewaakt met rolloverAppliedFrom).
    async rolloverIfNeeded(menuItems) {
      const todayK = dateKey(new Date());
      const yesterdayK = dateKey(addDays(new Date(), -1));
      const newDoc = ensureDayFor(todayK);
      if (newDoc.rolloverAppliedFrom === yesterdayK) return;
      const oldDoc = read(dayKey(yesterdayK), null);
      const byId = new Map((menuItems || []).map((m) => [m.id, m]));
      if (oldDoc) {
        let personeelsGisteren = newDoc.personeelsetenGisteren || "";
        for (const [id, it] of Object.entries(oldDoc.items || {})) {
          const menuItem = byId.get(id);
          const existing = newDoc.items[id];
          const alreadyRelevant = existing && (itemIsOpen(menuItem, existing) || itemIsDone(menuItem, existing));
          if (itemIsOpen(menuItem, it) && !alreadyRelevant) {
            // staleAlertSentAt bewust NIET meekopiëren: dat is een vlaggetje
            // "vandaag al een Telegram-melding over gestuurd" en moet elke
            // nieuwe dag dat het blijft liggen opnieuw kunnen afgaan (zie
            // checkCarryAlerts()), anders zou een item na de eerste melding
            // voorgoed stil blijven terwijl het gewoon nog steeds openstaat.
            newDoc.items[id] = { ...it, carriedOver: true, carryStreak: (it.carryStreak || 0) + 1, staleAlertSentAt: null };
          }
          if (id.endsWith("personeels-eten") && it.hoeveelheid) personeelsGisteren = it.hoeveelheid;
        }
        newDoc.personeelsetenGisteren = personeelsGisteren;
      }
      newDoc.rolloverAppliedFrom = yesterdayK;
      write(dayKey(todayK), newDoc);
    },
  };
}

// ----------------------------------------------------------------------------
// CLOUD backend (Firebase Firestore + Anonymous Auth)
// ----------------------------------------------------------------------------
async function makeCloudBackend(config) {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);
  const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  const {
    getFirestore,
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
    collection, writeBatch, runTransaction, query, where, documentId,
  } = fsMod;

  const app = initializeApp(config);
  const auth = getAuth(app);
  // Bewust GEEN persistente multi-tab offline cache (persistentLocalCache +
  // persistentMultipleTabManager): die vereist dat browsertabbladen onderling
  // een "primary tab" verkiezen via de Web Locks API, en dat bleek in de
  // praktijk soms muurvast te lopen zodra een tweede tab/venster van dezelfde
  // app open stond op hetzelfde toestel (de lijst bleef dan voorgoed leeg,
  // zonder foutmelding). Een keuken werkt toch met aparte toestellen (tablet +
  // losse telefoons), dus offline-cache-over-meerdere-tabbladen levert weinig
  // op maar dat vastlopen was een onacceptabel risico. Gewone (memory-only)
  // Firestore is net zo snel zolang er wifi is, en de printfunctie is al de
  // bewuste fallback voor als een toestel geen verbinding heeft.
  const db = getFirestore(app);

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 8000);
    onAuthStateChanged(auth, (user) => {
      if (user) { clearTimeout(timeout); resolve(user); }
    });
    signInAnonymously(auth).catch((err) => { clearTimeout(timeout); reject(err); });
  });
  await ready; // gooit door bij fout -> caller vangt op en valt terug op local

  const dayStatesCol = collection(db, "dayStates");
  const teamRef = doc(db, "team", "members");
  const accessCodesRef = doc(db, "team", "accessCodes");
  const devicesRef = doc(db, "team", "devices");
  const itemsCol = collection(db, "menuItems");
  const catsCol = collection(db, "categories");
  const planningCol = collection(db, "planning");
  const zaakRef = doc(db, "settings", "zaak");
  const telegramRef = doc(db, "settings", "telegram");
  const whatsappRef = doc(db, "settings", "whatsapp");

  return {
    mode: "cloud",
    ready: Promise.resolve(),

    onMenu(cb) {
      return onSnapshot(itemsCol, (snap) => {
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (err) => console.error("onMenu snapshot-fout:", err));
    },
    onCategories(cb) {
      return onSnapshot(catsCol, (snap) => {
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (err) => console.error("onCategories snapshot-fout:", err));
    },
    onTeam(cb) {
      return onSnapshot(teamRef, (snap) => {
        cb(snap.exists() ? (snap.data().names || []) : []);
      }, (err) => console.error("onTeam snapshot-fout:", err));
    },
    onAccessCodes(cb) {
      return onSnapshot(accessCodesRef, (snap) => {
        const d = snap.exists() ? snap.data() : {};
        cb({ codes: d.codes || {}, admins: d.admins || [], activated: !!d.activated });
      }, (err) => console.error("onAccessCodes snapshot-fout:", err));
    },
    onDevices(cb) {
      return onSnapshot(devicesRef, (snap) => {
        const d = snap.exists() ? snap.data() : {};
        cb({ approved: d.approved || {}, pendingCode: d.pendingCode || null, activated: !!d.activated });
      }, (err) => console.error("onDevices snapshot-fout:", err));
    },
    onDayState(k, cb) {
      const ref = doc(dayStatesCol, k);
      return onSnapshot(ref, async (snap) => {
        if (!snap.exists()) {
          const fresh = defaultDayDoc(k);
          await setDoc(ref, fresh);
          return; // de setDoc triggert een nieuwe snapshot
        }
        cb({ ...defaultDayDoc(k), ...snap.data() });
      }, (err) => console.error(`onDayState snapshot-fout (${k}):`, err));
    },
    onPlanning(cb) {
      return onSnapshot(planningCol, (snap) => {
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (err) => console.error("onPlanning snapshot-fout:", err));
    },
    onZaakSettings(cb) {
      return onSnapshot(zaakRef, (snap) => cb(snap.exists() ? snap.data() : {}), (err) => console.error("onZaakSettings snapshot-fout:", err));
    },
    onTelegramSettings(cb) {
      return onSnapshot(telegramRef, (snap) => {
        const d = snap.exists() ? snap.data() : {};
        cb({ enabled: !!d.enabled, botToken: d.botToken || "", chatId: d.chatId || "" });
      }, (err) => console.error("onTelegramSettings snapshot-fout:", err));
    },
    onWhatsappSettings(cb) {
      return onSnapshot(whatsappRef, (snap) => {
        const d = snap.exists() ? snap.data() : {};
        cb({ enabled: !!d.enabled, phone: d.phone || "", apikey: d.apikey || "" });
      }, (err) => console.error("onWhatsappSettings snapshot-fout:", err));
    },

    async setItemField(k, itemId, patch) {
      const ref = doc(dayStatesCol, k);
      const upd = {};
      for (const [key, v] of Object.entries(patch)) upd[`items.${itemId}.${key}`] = v;
      await updateDoc(ref, upd).catch(async () => {
        const fresh = defaultDayDoc(k);
        fresh.items[itemId] = { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {}, ...patch };
        await setDoc(ref, fresh);
      });
    },
    async setStep(k, itemId, stepIndex, patch) {
      const ref = doc(dayStatesCol, k);
      const upd = {};
      for (const [key, v] of Object.entries(patch)) upd[`items.${itemId}.steps.${stepIndex}.${key}`] = v;
      await updateDoc(ref, upd).catch(async () => {
        const fresh = defaultDayDoc(k);
        fresh.items[itemId] = { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: { [stepIndex]: patch } };
        await setDoc(ref, fresh);
      });
    },
    async setNote(k, itemId, note) {
      const ref = doc(dayStatesCol, k);
      await updateDoc(ref, { [`items.${itemId}.note`]: note }).catch(async () => {
        const fresh = defaultDayDoc(k);
        fresh.items[itemId] = { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note, steps: {} };
        await setDoc(ref, fresh);
      });
    },
    async clearItem(k, itemId) {
      const ref = doc(dayStatesCol, k);
      await updateDoc(ref, {
        [`items.${itemId}`]: { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {} },
      }).catch(async () => {
        const fresh = defaultDayDoc(k);
        await setDoc(ref, fresh);
      });
    },
    async setHeader(k, patch) {
      const ref = doc(dayStatesCol, k);
      await updateDoc(ref, patch).catch(async () => {
        await setDoc(ref, { ...defaultDayDoc(k), ...patch });
      });
    },
    async approveDay(k, { door }) {
      const ref = doc(dayStatesCol, k);
      const patch = { approved: true, approvedBy: door, approvedAt: Date.now() };
      await updateDoc(ref, patch).catch(async () => {
        await setDoc(ref, { ...defaultDayDoc(k), ...patch });
      });
    },
    async getDayStatesRange(startKey, endKey) {
      const q = query(dayStatesCol, where(documentId(), ">=", startKey), where(documentId(), "<=", endKey));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ dateKey: d.id, data: d.data() }));
    },

    async addTeamMember(name) {
      const snap = await getDoc(teamRef);
      const names = snap.exists() ? (snap.data().names || []) : [];
      if (!names.includes(name)) await setDoc(teamRef, { names: [...names, name] });
    },
    async removeTeamMember(name) {
      const snap = await getDoc(teamRef);
      const names = snap.exists() ? (snap.data().names || []) : [];
      await setDoc(teamRef, { names: names.filter((n) => n !== name) });
      // Ook de toegangscode van deze persoon opruimen, anders blijft er een
      // ongebruikte code (en eventueel beheerderschap) rondslingeren voor een
      // naam die niet meer bestaat.
      const codeSnap = await getDoc(accessCodesRef);
      const d = codeSnap.exists() ? codeSnap.data() : {};
      const codes = d.codes || {};
      let admins = d.admins || [];
      let changed = false;
      if (codes[name] !== undefined) { delete codes[name]; changed = true; }
      if (admins.includes(name)) { admins = admins.filter((n) => n !== name); changed = true; }
      if (changed) await setDoc(accessCodesRef, { codes, admins, activated: !!d.activated });
    },
    async setAccessCode(name, code) {
      const snap = await getDoc(accessCodesRef);
      const d = snap.exists() ? snap.data() : {};
      const codes = d.codes || {};
      const admins = d.admins || [];
      let activated = !!d.activated;
      const trimmed = (code || "").trim();
      if (trimmed) { codes[name] = trimmed; activated = true; } else { delete codes[name]; }
      await setDoc(accessCodesRef, { codes, admins, activated });
    },
    async setAdminFlag(name, isAdmin) {
      const snap = await getDoc(accessCodesRef);
      const d = snap.exists() ? snap.data() : {};
      const codes = d.codes || {};
      let admins = d.admins || [];
      const has = admins.includes(name);
      if (isAdmin && !has) admins = [...admins, name];
      if (!isAdmin && has) admins = admins.filter((n) => n !== name);
      await setDoc(accessCodesRef, { codes, admins, activated: !!d.activated });
    },

    async generateDeviceCode() {
      const snap = await getDoc(devicesRef);
      const d = snap.exists() ? snap.data() : {};
      const code = genDeviceCode();
      await setDoc(devicesRef, { approved: d.approved || {}, pendingCode: { code, createdAt: Date.now() }, activated: true });
      return code;
    },
    async clearDeviceCode() {
      const snap = await getDoc(devicesRef);
      const d = snap.exists() ? snap.data() : {};
      await setDoc(devicesRef, { approved: d.approved || {}, pendingCode: null, activated: !!d.activated });
    },
    // Laat "activated" bewust ongewijzigd — zie toelichting bij de lokale
    // backend hierboven.
    async approveDevice(id, label) {
      const snap = await getDoc(devicesRef);
      const d = snap.exists() ? snap.data() : {};
      const approved = d.approved || {};
      approved[id] = { label: (label || "Toestel").trim(), approvedAt: Date.now() };
      await setDoc(devicesRef, { approved, pendingCode: d.pendingCode || null, activated: !!d.activated });
    },
    async revokeDevice(id) {
      const snap = await getDoc(devicesRef);
      const d = snap.exists() ? snap.data() : {};
      const approved = d.approved || {};
      delete approved[id];
      await setDoc(devicesRef, { approved, pendingCode: d.pendingCode || null, activated: !!d.activated });
    },

    async addItem({ categorie, naam }) {
      const id = `${categorie}__${slugify(naam)}-${Date.now().toString(36)}`;
      await setDoc(doc(itemsCol, id), { naam, categorie, order: Date.now(), actief: true, stappen: [] });
    },
    async removeItem(itemId) {
      // Zie toelichting bij de lokale backend: dagstatussen (ook oude) laten
      // we bewust ongemoeid, die blijven bestaan als geschiedenis.
      await deleteDoc(doc(itemsCol, itemId));
    },
    async updateItem(itemId, patch) {
      await updateDoc(doc(itemsCol, itemId), patch);
    },
    async addCategory(cat) {
      await setDoc(doc(catsCol, cat.id), cat);
    },
    async updateCategory(catId, patch) {
      await updateDoc(doc(catsCol, catId), patch);
    },

    async addPlanning({ itemId, targetDateKey, note, createdBy }) {
      const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      await setDoc(doc(planningCol, id), { itemId, targetDateKey, note: (note || "").trim(), createdBy: createdBy || "", createdAt: Date.now() });
      return id;
    },
    async removePlanning(id) {
      await deleteDoc(doc(planningCol, id));
    },
    async setZaakSettings(patch) {
      await setDoc(zaakRef, patch, { merge: true });
    },
    async setTelegramSettings(patch) {
      const snap = await getDoc(telegramRef);
      const cur = snap.exists() ? snap.data() : { enabled: false, botToken: "", chatId: "" };
      await setDoc(telegramRef, { ...cur, ...patch });
    },
    async setWhatsappSettings(patch) {
      const snap = await getDoc(whatsappRef);
      const cur = snap.exists() ? snap.data() : { enabled: false, phone: "", apikey: "" };
      await setDoc(whatsappRef, { ...cur, ...patch });
    },

    async seedIfEmpty(defaultCategories, defaultItems, defaultTeam) {
      const [catSnap, itemSnap] = await Promise.all([getDocs(catsCol), getDocs(itemsCol)]);
      if (catSnap.empty && itemSnap.empty) {
        const batch = writeBatch(db);
        defaultCategories.forEach((c, i) => batch.set(doc(catsCol, c.id), { ...c, order: i }));
        defaultItems.forEach((it) => batch.set(doc(itemsCol, it.id), {
          naam: it.naam, categorie: it.categorie, order: it.order, actief: true, stappen: [],
        }));
        await batch.commit();
      }
      if (defaultTeam && defaultTeam.length) {
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists() || !(teamSnap.data().names || []).length) {
          await setDoc(teamRef, { names: defaultTeam });
        }
      }
    },

    // Eenmalige migratie van het oude één-lijst-model ("dayState/current")
    // naar het nieuwe per-datum document voor vandaag — zodat live ingevulde
    // data (bv. al afgevinkte items) niet verloren gaat bij deze update.
    async migrateLegacyIfNeeded(todayKey) {
      const newRef = doc(dayStatesCol, todayKey);
      const newSnap = await getDoc(newRef);
      if (newSnap.exists()) return;
      const legacyRef = doc(db, "dayState", "current");
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        const data = legacySnap.data();
        if (data && data.workDateKey === todayKey) {
          await setDoc(newRef, { ...defaultDayDoc(todayKey), ...data, workDateKey: todayKey });
        }
      }
    },

    async rolloverIfNeeded(menuItems) {
      const todayK = dateKey(new Date());
      const yesterdayK = dateKey(addDays(new Date(), -1));
      const todayRef = doc(dayStatesCol, todayK);
      const yesterdayRef = doc(dayStatesCol, yesterdayK);
      const byId = new Map((menuItems || []).map((m) => [m.id, m]));
      try {
        await runTransaction(db, async (tx) => {
          const todaySnap = await tx.get(todayRef);
          const yestSnap = await tx.get(yesterdayRef);
          const newDoc = todaySnap.exists() ? { ...defaultDayDoc(todayK), ...todaySnap.data() } : defaultDayDoc(todayK);
          if (newDoc.rolloverAppliedFrom === yesterdayK) return;
          if (yestSnap.exists()) {
            const oldDoc = yestSnap.data();
            let personeelsGisteren = newDoc.personeelsetenGisteren || "";
            const items = { ...(newDoc.items || {}) };
            for (const [id, it] of Object.entries(oldDoc.items || {})) {
              const menuItem = byId.get(id);
              const existing = items[id];
              const alreadyRelevant = existing && (itemIsOpen(menuItem, existing) || itemIsDone(menuItem, existing));
              if (itemIsOpen(menuItem, it) && !alreadyRelevant) {
                // Zie toelichting bij de lokale backend: staleAlertSentAt
                // bewust niet meekopiëren, zodat een nog steeds openstaand
                // item elke nieuwe dag opnieuw een Telegram-melding kan
                // krijgen in plaats van maar één keer ooit.
                items[id] = { ...it, carriedOver: true, carryStreak: (it.carryStreak || 0) + 1, staleAlertSentAt: null };
              }
              if (id.endsWith("personeels-eten") && it.hoeveelheid) personeelsGisteren = it.hoeveelheid;
            }
            newDoc.items = items;
            newDoc.personeelsetenGisteren = personeelsGisteren;
          }
          newDoc.rolloverAppliedFrom = yesterdayK;
          newDoc.workDateKey = todayK;
          tx.set(todayRef, newDoc);
        });
      } catch (e) {
        console.warn("Rollover mislukt (waarschijnlijk race met ander toestel, geen probleem):", e);
      }
    },
  };
}

// ----------------------------------------------------------------------------
// App state & init
// ----------------------------------------------------------------------------
const state = {
  categories: [],
  menu: [],
  team: [],
  accessCodes: {},
  // Namen die toegangscodes van anderen mogen instellen/intrekken. "Joris"
  // mag dit altijd (zie isCurrentUserAdmin), ongeacht wat hier in staat —
  // zo kan dit nooit per ongeluk leeglopen en iedereen buitensluiten.
  admins: [],
  accessGatingActivated: false,
  // Welke toestellen zijn goedgekeurd om de app te mogen openen (zie
  // deviceAccessOk() / renderAdminDevices() hieronder) — losstaand van, en
  // aanvullend op, de toegangscodes per persoon hierboven.
  devices: { approved: {}, pendingCode: null, activated: false },
  todayKey: dateKey(new Date()),
  tomorrowKey: dateKey(addDays(new Date(), 1)),
  dayToday: defaultDayDoc(dateKey(new Date())),
  dayTomorrow: defaultDayDoc(dateKey(addDays(new Date(), 1))),
  // Vooruit ingeplande items — los van een specifieke dag, blijven staan
  // totdat iemand ze verwijdert (bv. omdat het alsnog is gedaan). Zie
  // planningsForItem() / renderPlanBadges().
  planning: [],
  // Instellingen voor de Telegram- en WhatsApp-melding (zie checkCarryAlerts
  // hieronder) — allebei onafhankelijk aan/uit te zetten via het
  // beheerscherm, door Joris ingesteld. Zolang enabled niet aan staat of de
  // instellingen ontbreken, gebeurt er voor dat kanaal domweg niets. Telegram
  // is toegevoegd omdat WhatsApp via CallMeBot onbetrouwbaar bleek (gratis
  // eenmansdienst die regelmatig van nummer wisselt of accounts pauzeert,
  // en geeft sowieso nooit een echte foutmelding terug) — maar zodra
  // CallMeBot weer werkt, kan het gewoon als extra kanaal ernaast aan staan.
  telegram: { enabled: false, botToken: "", chatId: "" },
  whatsapp: { enabled: false, phone: "", apikey: "" },
  activeTab: "today", // 'today' | 'tomorrow'
  // Dashboard is een los, alleen-lezen overzicht dat "boven op" het huidige
  // tabblad getoond wordt — het wijzigt bewust niets aan activeTab, zodat
  // Vandaag/Morgen precies blijven waar je gebleven was zodra je het
  // dashboard weer sluit.
  dashboardActive: false,
  // Binnen het dashboard: "dag" (standaard, live) of "maand" (overzicht over
  // de lopende kalendermaand, opgehaald via Store.getDayStatesRange net als
  // de rapportage — geen live sync, ververst bij het openen van het
  // dashboard of het wisselen naar deze weergave).
  dashboardViewMode: "day",
  // Onthouden naam wordt pas echt "ingelogd" zodra de bijbehorende
  // toegangscode geverifieerd is (zie validateSession()) — zo blijft een
  // ingetrokken of gewijzigde code effectief, ook op toestellen die de naam
  // al eerder onthouden hadden.
  user: localStorage.getItem("mep_user") || null,
  // Weergave van het "Vandaag"-tabblad: "all" (standaard) toont de volledige
  // lijst — nodig want aan het begin van de dag heeft meestal nog niets een
  // hoeveelheid, dus zou een gefilterde weergave dan juist leeg lijken en de
  // planning in de weg zitten. "active" toont alleen items die al iets te
  // doen hebben (hoeveelheid/notitie ingevuld, of al (deels) afgevinkt) —
  // handig later op de dag om snel te zien wat er nog moet gebeuren. Bewust
  // niet opgeslagen in localStorage: elke sessie start weer bij de volledige
  // lijst.
  todayFilterMode: "all",
};

function activeDateKey() { return state.activeTab === "tomorrow" ? state.tomorrowKey : state.todayKey; }
function activeDay() { return state.activeTab === "tomorrow" ? state.dayTomorrow : state.dayToday; }

function showToast(msg, ms = 3200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

async function initStore() {
  const cfg = window.FIREBASE_CONFIG;
  const looksReal = cfg && cfg.apiKey && !/PLAK-HIER|YOUR_API_KEY|AIzaSyXXX/i.test(cfg.apiKey);
  const pill = document.getElementById("syncPill");

  if (looksReal) {
    try {
      const backend = await makeCloudBackend(cfg);
      Object.assign(Store, backend);
      pill.textContent = "🟢 Live";
      pill.title = "Live gesynchroniseerd tussen alle apparaten";
      pill.className = "pill pill-live";
      return;
    } catch (e) {
      console.warn("Kon niet verbinden met Firebase, val terug op lokale modus:", e);
      showToast("Kon niet verbinden met de cloud-database — check firebase-config.js en of Anonymous Auth aanstaat. Werkt nu lokaal op dit toestel.", 6000);
    }
  }
  Object.assign(Store, makeLocalBackend());
  pill.textContent = "📴 Demo-modus";
  pill.title = "Alleen op dit toestel — zie SETUP.md om live-sync tussen apparaten aan te zetten";
  pill.className = "pill pill-local";
}

// DOM-referenties zodat we bij live updates alleen de cijfers/vinkjes hoeven
// bij te werken i.p.v. de hele lijst opnieuw op te bouwen — anders verlies je
// je cursor/focus zodra een collega ergens anders iets afvinkt.
let rowRefs = new Map(); // itemId -> { row, cb, qty, main, ... }
let catCountRefs = new Map(); // catId -> element
let structureSignature = "";
const expandedItems = new Set(); // itemId's waarvan het stappenpaneel op dit toestel openstaat

function computeSignature() {
  // Bevat ook naam/kleur/volgorde/stappen én het actieve tabblad, zodat een
  // wijziging via het beheerscherm, of het wisselen tussen "Vandaag" en
  // "Morgen voorbereiden" (andere rij-opmaak!), altijd een volledige herbouw
  // van de lijst triggert i.p.v. alleen de dagstatus-patch.
  const catPart = state.categories
    .map((c) => `${c.id}:${c.naam}:${c.kleur}:${c.order}`)
    .sort().join(",");
  const itemPart = state.menu
    .map((i) => `${i.id}:${i.naam}:${i.categorie}:${i.order}:${(i.stappen || []).join("~")}:${i.instructieTekst ? "1" : "0"}:${i.instructieFoto ? "1" : "0"}:${i.geenHoeveelheid ? "1" : "0"}`)
    .sort().join(",");
  // Bij "Alleen vandaag" bepaalt óók welke items op dit moment relevant zijn
  // (hoeveelheid/notitie ingevuld, of al (deels) afgevinkt) mee of de lijst
  // structureel herbouwd moet worden — anders duikt een item dat elders net
  // een hoeveelheid heeft gekregen niet vanzelf op in de gefilterde weergave.
  // Een planning voor een datum die nog moet komen telt hier bewust NIET mee
  // (alleen een al VERVALLEN planning doet dat, via planningIsDue): "Alleen
  // vandaag" blijft zo puur wat er vandaag ook echt moet gebeuren, en een
  // planning voor volgende week hoort bij de toekomstige lijst (de
  // dashboard-kaart "Vooruit gepland"), niet bij vandaag. De rustige
  // herinnerings-badge zelf (renderPlanBadges) blijft wél altijd zichtbaar
  // zodra het item om een andere reden al in beeld is — bv. op "Hele
  // lijst" — zodat iemand alsnog kan kíezen om het vast op te pakken.
  let filterPart = "";
  if (state.activeTab === "today" && state.todayFilterMode === "active") {
    filterPart = "|" + state.menu
      .filter((i) => itemIsDone(i, state.dayToday.items[i.id]) || itemIsOpen(i, state.dayToday.items[i.id]) || planningsForItem(i.id).some((p) => planningIsDue(p)))
      .map((i) => i.id)
      .sort()
      .join(",");
  }
  return catPart + "|" + itemPart + "|" + state.activeTab + "|" + state.todayFilterMode + filterPart;
}

function render(structuralHint) {
  if (state.dashboardActive) { renderDashboard(); return; }
  const sig = computeSignature();
  if (structuralHint || sig !== structureSignature || rowRefs.size === 0) {
    structureSignature = sig;
    renderCategories();
  } else {
    patchDayState();
  }
  renderHeaderFields();
  renderUserBadge();
  renderProgress();
  renderApprovalBanner();
  renderTodayFilterBar();
}

// Toont de "Alleen vandaag" / "Hele lijst"-schakelaar alleen op het
// Vandaag-tabblad (op Morgen voorbereiden ben je toch al bewust de hele
// lijst aan het doorlopen om in te plannen, daar helpt filteren niet).
function renderTodayFilterBar() {
  const bar = document.getElementById("todayFilterBar");
  if (!bar) return;
  bar.classList.toggle("hidden", state.activeTab !== "today");
  const activeBtn = document.getElementById("filterActiveBtn");
  const allBtn = document.getElementById("filterAllBtn");
  const isActive = state.todayFilterMode === "active";
  activeBtn.classList.toggle("active", isActive);
  activeBtn.setAttribute("aria-selected", String(isActive));
  allBtn.classList.toggle("active", !isActive);
  allBtn.setAttribute("aria-selected", String(!isActive));
}

let lastGemaaktDoorOptionsSig = null;
function renderGemaaktDoorOptions() {
  const gd = document.getElementById("gemaaktDoor");
  if (!gd) return;
  const day = activeDay();
  const current = day.gemaaktDoor || "";
  const names = [...state.team];
  if (current && !names.includes(current)) names.push(current);
  const sig = names.join("|");
  if (sig === lastGemaaktDoorOptionsSig && gd.options.length) return;
  lastGemaaktDoorOptionsSig = sig;
  const prevValue = gd.value;
  gd.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Kies naam…";
  gd.appendChild(blank);
  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    gd.appendChild(opt);
  });
  gd.value = prevValue;
}

function renderHeaderFields() {
  const day = activeDay();
  const wd = document.getElementById("workDateLabel");
  const gd = document.getElementById("gemaaktDoor");
  const op = document.getElementById("opmerkingen");
  const pe = document.getElementById("personeelsetenGisteren");
  const peLabel = document.getElementById("personeelsetenGisterenLabel");
  if (document.activeElement !== wd) wd.value = day.workDateLabel || "";
  renderGemaaktDoorOptions();
  if (document.activeElement !== gd) gd.value = day.gemaaktDoor || "";
  if (document.activeElement !== op) op.value = day.opmerkingen || "";
  if (document.activeElement !== pe) pe.value = day.personeelsetenGisteren || "";
  op.placeholder = state.activeTab === "tomorrow" ? "Bijzonderheden voor morgen…" : "Bijzonderheden voor vandaag…";
  // Zelfde onderliggende veld (personeelsetenGisteren) op het dagdocument,
  // maar het label/plaatshouder past mee met de tab: op "Morgen voorbereiden"
  // ben je in de praktijk 's avonds aan het invullen, dus dan gaat het over
  // wat er VANDAAG is gegeten — dat wordt de volgende dag automatisch
  // "gisteren" (zie rolloverIfNeeded, dat dit veld gewoon laat staan).
  if (state.activeTab === "tomorrow") {
    peLabel.textContent = "Personeelseten vandaag";
    pe.placeholder = "Wat is er vandaag gegeten?";
  } else {
    peLabel.textContent = "Personeelseten gisteren";
    pe.placeholder = "Wat is er gisteren gegeten?";
  }
  if (state.activeTab === "tomorrow" && !(day.gemaaktDoor && day.gemaaktDoor.trim())) {
    gd.classList.add("field-missing");
  } else {
    gd.classList.remove("field-missing");
  }
}

function renderUserBadge() {
  const btn = document.getElementById("userBadge");
  btn.textContent = state.user ? "👤 " + state.user : "👤 Kies naam";
}

function itemsByCategory(catId) {
  return state.menu
    .filter((i) => i.categorie === catId && i.actief !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function renderProgress() {
  const day = activeDay();
  if (state.activeTab === "tomorrow") {
    // Taken (geenHoeveelheid) worden niet vooruit gepland met een hoeveelheid
    // — die tellen dus niet mee in "hoeveel is er al voorbereid voor morgen",
    // anders zou de balk nooit 100% kunnen halen zolang er taken in de lijst
    // staan.
    const planItems = state.menu.filter((i) => !i.geenHoeveelheid);
    const total = planItems.length;
    const done = planItems.filter((i) => {
      const preview = tomorrowPreview(i);
      return preview.value && preview.value.trim();
    }).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById("progressFill").style.width = pct + "%";
    document.getElementById("progressLabel").textContent =
      total ? `${done} items gepland voor morgen` : "Nog niets gepland";
    return;
  }
  const relevant = state.menu.filter((i) => {
    const it = day.items[i.id];
    return itemIsDone(i, it) || itemIsOpen(i, it);
  });
  const done = relevant.filter((i) => itemIsDone(i, day.items[i.id])).length;
  const total = relevant.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("progressLabel").textContent =
    total ? `${done} / ${total} klaar` : "Nog geen hoeveelheden ingevuld";
}

function renderCategories() {
  const grid = document.getElementById("categoryGrid");
  const cats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
  grid.innerHTML = "";
  rowRefs = new Map();
  catCountRefs = new Map();
  const mode = state.activeTab;
  // "Alleen vandaag" toont per categorie enkel de items die vandaag echt iets
  // te doen hebben (zelfde criterium als de voortgangsbalk/dashboard) — zo
  // hoef je niet meer door de hele lijst te scrollen om te zien wat er nog
  // moet gebeuren. Via de knop hierboven schakel je moeiteloos naar de volle
  // lijst om te bladeren en iets toe te voegen dat je nog vergeten was.
  const filterActive = mode === "today" && state.todayFilterMode === "active";
  let shownCategories = 0;

  cats.forEach((cat) => {
    // Taken (geenHoeveelheid, bv. "Frituur links verschonen") worden niet
    // vooruit gepland met een hoeveelheid, dus die horen niet thuis op
    // "Morgen voorbereiden" — ze verschijnen simpelweg elke dag opnieuw op
    // "Vandaag" als gewoon een vinkje (zie itemIsOpen hierboven). Wil je zo'n
    // taak toch voor een specifieke datum inplannen, dan kan dat gewoon via
    // de 📅-knop (Vooruit plannen).
    const allItems = itemsByCategory(cat.id).filter((i) => mode !== "tomorrow" || !i.geenHoeveelheid);
    const items = filterActive
      ? allItems.filter((i) => itemIsDone(i, state.dayToday.items[i.id]) || itemIsOpen(i, state.dayToday.items[i.id]) || planningsForItem(i.id).some((p) => planningIsDue(p)))
      : allItems;
    if (!items.length && (filterActive || mode === "tomorrow")) return;
    shownCategories++;

    const card = document.createElement("div");
    card.className = "cat-card";

    const head = document.createElement("div");
    head.className = "cat-head";
    head.style.background = gradientFor(cat.kleur || "#42220F");
    const countSpan = document.createElement("span");
    countSpan.className = "cat-count";
    head.innerHTML = `<span>${escapeHtml(cat.naam)}</span>`;
    head.appendChild(countSpan);
    catCountRefs.set(cat.id, { el: countSpan, total: allItems.length });
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "cat-body";

    // Kolomkopjes — leggen één keer per categorie uit wat "invullen" (de
    // hoeveelheid plannen) en "afvinken" (klaar melden) betekenen, zodat dat
    // verschil niet steeds opnieuw per rij geraden hoeft te worden.
    if (items.length) {
      const colHead = document.createElement("div");
      const spacer = document.createElement("div");
      spacer.className = "item-main";
      const qtyLabel = document.createElement("div");
      qtyLabel.className = "col-label col-label-qty";
      colHead.appendChild(spacer);
      if (mode === "tomorrow") {
        colHead.className = "row-cols row-cols-prep item-row-colhead";
        qtyLabel.textContent = "Hoeveelheid voor morgen";
        colHead.appendChild(qtyLabel);
      } else {
        colHead.className = "row-cols item-row-colhead";
        qtyLabel.textContent = "Hoeveelheid";
        colHead.appendChild(qtyLabel);
        const klaarLabel = document.createElement("div");
        klaarLabel.className = "col-label col-label-klaar";
        klaarLabel.textContent = "Klaar?";
        colHead.appendChild(klaarLabel);
      }
      body.appendChild(colHead);
    }

    items.forEach((item, idx) => {
      const built = renderItemRow(item, idx % 2 === 1);
      body.appendChild(built.row);
      if (built.stepsPanel) body.appendChild(built.stepsPanel);
    });

    card.appendChild(body);
    grid.appendChild(card);
  });

  if (filterActive && !shownCategories) {
    const empty = document.createElement("div");
    empty.className = "today-filter-empty";
    empty.innerHTML = `Nog niets ingepland voor vandaag.<br>Schakel naar "Hele lijst" hierboven om iets toe te voegen.`;
    grid.appendChild(empty);
  }

  patchDayState();
}

// Werkt alleen de vinkjes/hoeveelheden/tellers bij, zonder de DOM-elementen
// opnieuw aan te maken — zo blijft een input waar iemand in typt met rust
// als er ondertussen ergens anders iets verandert.
function patchDayState() {
  const day = activeDay();
  for (const [itemId, refs] of rowRefs) {
    const menuItem = refs.menuItem;
    const st = day.items[itemId] || { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {} };

    if (refs.mode === "tomorrow") {
      const preview = tomorrowPreview(menuItem);
      const hasQty = !preview.carried && !!(preview.value && preview.value.trim());
      refs.row.className = "row-cols row-cols-prep item-row" + (refs.altClass ? " row-alt" : "") + (hasQty ? " has-qty" : "") + (preview.carried ? " has-carry" : "");
      if (document.activeElement !== refs.qty) {
        ensureQtyOption(refs.qty, preview.value);
        refs.qty.value = preview.value;
      }
      if (preview.carried) {
        if (!refs.carryBadge) {
          refs.carryBadge = document.createElement("div");
          refs.carryBadge.className = "carry-badge";
          refs.carryBadge.textContent = "🔁 Nog niet klaar vandaag — komt automatisch op morgen te staan";
          refs.main.insertBefore(refs.carryBadge, refs.noteArea);
        }
      } else if (refs.carryBadge) {
        refs.carryBadge.remove();
        refs.carryBadge = null;
      }
      if (!preview.carried) renderPredictionBadge(refs, itemId, state.tomorrowKey, preview.value);
      else if (refs.predBadge) { refs.predBadge.remove(); refs.predBadge = null; }
      updateNoteArea(menuItem, refs);
      continue;
    }

    const done = itemIsDone(menuItem, st);
    const open = itemIsOpen(menuItem, st);
    const carried = open && !!st.carriedOver;
    const stale = carried && (st.carryStreak || 0) >= staleCarryDays();
    refs.row.className = "row-cols item-row" + (refs.altClass ? " row-alt" : "") + (done ? " is-done" : open ? " is-open" : "") + (carried ? " is-carried" : "") + (stale ? " is-stale" : "");

    if (carried) {
      if (!refs.carryBadge) {
        refs.carryBadge = document.createElement("div");
        refs.main.insertBefore(refs.carryBadge, refs.noteArea);
      }
      if (stale) {
        refs.carryBadge.className = "carry-badge stale-badge";
        refs.carryBadge.textContent = `🚨 Al ${(st.carryStreak || 0) + 1} dagen open — dit moet nu echt gebeuren!`;
      } else {
        refs.carryBadge.className = "carry-badge carry-badge-today";
        refs.carryBadge.textContent = "🔁 Bleef gisteren openstaan — nog niet klaar";
      }
    } else if (refs.carryBadge) {
      refs.carryBadge.remove();
      refs.carryBadge = null;
    }

    if (!done && !menuItem.geenHoeveelheid) renderPredictionBadge(refs, itemId, state.todayKey, st.hoeveelheid);
    else if (refs.predBadge) { refs.predBadge.remove(); refs.predBadge = null; }

    renderPlanBadges(refs, itemId);

    if (refs.hasSteps) {
      const ss = stepStatus(menuItem, st);
      refs.cb.className = "checkbox checkbox-steps" + (ss.isDone ? " checked" : ss.done > 0 ? " partial" : "");
      refs.cb.textContent = `${ss.done}/${ss.total}`;
      // individuele stappen
      const stepsMap = st.steps || {};
      refs.stepRefs.forEach((sref, i) => {
        const sst = stepsMap[i];
        sref.cb.className = "step-checkbox" + (sst && sst.checked ? " checked" : "");
        sref.cb.textContent = sst && sst.checked ? "✓" : "";
        if (sst && sst.checked) {
          sref.meta.textContent = `✓ ${sst.door || "?"} · ${formatTime(sst.tijd)}`;
          sref.meta.style.display = "";
        } else {
          sref.meta.style.display = "none";
        }
      });
      if (refs.stepsPanel) refs.stepsPanel.classList.toggle("expanded", expandedItems.has(itemId));
    } else {
      refs.cb.className = "checkbox" + (st.checked ? " checked" : "");
      refs.cb.textContent = st.checked ? "✓ Klaar" : "Klaar";
    }

    if (done) {
      const who = refs.hasSteps ? lastStepActor(menuItem, st) : st.paraaf;
      const when = refs.hasSteps ? lastStepTime(menuItem, st) : st.checkedAt;
      if (!refs.meta) {
        refs.meta = document.createElement("div");
        refs.meta.className = "item-meta";
        refs.main.insertBefore(refs.meta, refs.noteArea);
      }
      refs.meta.textContent = `✓ ${who || "?"} · ${formatTime(when)}`;
    } else if (refs.meta) {
      refs.meta.remove();
      refs.meta = null;
    }

    if (!menuItem.geenHoeveelheid) {
      if (document.activeElement !== refs.qty) {
        ensureQtyOption(refs.qty, st.hoeveelheid || "");
        refs.qty.value = st.hoeveelheid || "";
      }
      refs.qty.disabled = done;
    }

    updateNoteArea(menuItem, refs);
  }

  for (const [catId, ref] of catCountRefs) {
    const items = itemsByCategory(catId);
    let done;
    if (state.activeTab === "tomorrow") {
      done = items.filter((i) => {
        const preview = tomorrowPreview(i);
        return preview.value && preview.value.trim();
      }).length;
    } else {
      done = items.filter((i) => itemIsDone(i, state.dayToday.items[i.id])).length;
    }
    ref.el.textContent = `${done}/${ref.total}`;
  }
}

// Voor items met stappen: wie/wanneer de laatste (of enige) stap afvinkte —
// gebruikt om onder de naam te tonen zodra alle stappen klaar zijn.
function lastStepActor(menuItem, st) {
  const steps = (menuItem && menuItem.stappen) || [];
  const stepsMap = (st && st.steps) || {};
  let latest = null;
  for (let i = 0; i < steps.length; i++) {
    const s = stepsMap[i];
    if (s && s.checked && (!latest || (s.tijd || 0) > (latest.tijd || 0))) latest = s;
  }
  return latest ? latest.door : "";
}
function lastStepTime(menuItem, st) {
  const steps = (menuItem && menuItem.stappen) || [];
  const stepsMap = (st && st.steps) || {};
  let latest = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = stepsMap[i];
    if (s && s.checked && (s.tijd || 0) > latest) latest = s.tijd;
  }
  return latest;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// De hoeveelheid is in de praktijk vrijwel altijd "hoe vaak moet dit recept
// gemaakt worden" — een pulldown met 1 t/m 10 is dus sneller invullen dan
// vrije tekst. Oudere/afwijkende waarden (bv. nog bestaande tekst uit het
// verleden) blijven gewoon werken: die krijgen een eigen optie erbij zodat
// er niets verloren gaat, in plaats van dat de select ze stilzwijgend wist.
function buildQtyOptions(select) {
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "hoev.";
  select.appendChild(blank);
  for (let n = 1; n <= 10; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n}x`;
    select.appendChild(opt);
  }
}
function ensureQtyOption(select, value) {
  if (!value) return;
  const exists = [...select.options].some((o) => o.value === value);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.insertBefore(opt, select.options[1] || null);
  }
}

function renderItemRow(item, altClass) {
  const mode = state.activeTab;
  const day = activeDay();
  const st = day.items[item.id] || { hoeveelheid: "", checked: false, paraaf: "", checkedAt: null, note: "", steps: {} };
  const hasSteps = mode === "today" && Array.isArray(item.stappen) && item.stappen.length > 0;
  const isTask = !!item.geenHoeveelheid;
  const row = document.createElement("div");
  row.dataset.itemId = item.id;

  const preview = mode === "tomorrow" ? tomorrowPreview(item) : null;
  if (mode === "tomorrow") {
    const hasQty = !preview.carried && !!(preview.value && preview.value.trim());
    row.className = "row-cols row-cols-prep item-row" + (altClass ? " row-alt" : "") + (hasQty ? " has-qty" : "") + (preview.carried ? " has-carry" : "");
  } else {
    row.className = "row-cols item-row" + (altClass ? " row-alt" : "");
  }

  let cb = null;
  if (mode === "today") {
    cb = document.createElement("button");
    cb.type = "button";
    cb.setAttribute("aria-label", hasSteps ? "Stappen tonen" : "Klaar zetten");
    if (hasSteps) {
      const ss = stepStatus(item, st);
      cb.className = "checkbox checkbox-steps" + (ss.isDone ? " checked" : ss.done > 0 ? " partial" : "");
      cb.textContent = `${ss.done}/${ss.total}`;
      cb.addEventListener("click", () => toggleExpand(item.id));
    } else {
      cb.className = "checkbox" + (st.checked ? " checked" : "");
      cb.textContent = st.checked ? "✓ Klaar" : "Klaar";
      cb.addEventListener("click", () => toggleCheck(item, activeDay().items[item.id] || st));
    }
  }

  const main = document.createElement("div");
  main.className = "item-main";

  const nameRow = document.createElement("div");
  nameRow.className = "item-name-row";
  const name = document.createElement("div");
  name.className = "item-name";
  name.textContent = item.naam;
  nameRow.appendChild(name);
  // Instructiekaartje (tekst + eventueel een foto) — alleen een knopje als er
  // ook echt iets is ingevuld via het beheerscherm, zodat de lijst voor de
  // meeste producten (nog) net zo rustig oogt als voorheen.
  const hasInstruction = !!((item.instructieTekst && item.instructieTekst.trim()) || item.instructieFoto);
  if (hasInstruction) {
    const instrBtn = document.createElement("button");
    instrBtn.className = "instr-btn";
    instrBtn.type = "button";
    instrBtn.title = "Bekijk instructie";
    instrBtn.setAttribute("aria-label", "Bekijk instructie voor " + item.naam);
    instrBtn.textContent = "ℹ️";
    instrBtn.addEventListener("click", () => openInstructionModal(item.id));
    nameRow.appendChild(instrBtn);
  }
  if (hasSteps) {
    const stepsToggle = document.createElement("button");
    stepsToggle.className = "steps-toggle";
    stepsToggle.type = "button";
    stepsToggle.textContent = "stappen ▾";
    stepsToggle.addEventListener("click", () => toggleExpand(item.id));
    nameRow.appendChild(stepsToggle);
  }
  main.appendChild(nameRow);

  let meta = null;
  if (mode === "today") {
    const done = itemIsDone(item, st);
    if (done) {
      meta = document.createElement("div");
      meta.className = "item-meta";
      const who = hasSteps ? lastStepActor(item, st) : st.paraaf;
      const when = hasSteps ? lastStepTime(item, st) : st.checkedAt;
      meta.textContent = `✓ ${who || "?"} · ${formatTime(when)}`;
      main.appendChild(meta);
    }
  }

  let carryBadge = null;
  if (mode === "tomorrow" && preview.carried) {
    carryBadge = document.createElement("div");
    carryBadge.className = "carry-badge";
    carryBadge.textContent = "🔁 Nog niet klaar vandaag — komt automatisch op morgen te staan";
    main.appendChild(carryBadge);
  }

  const noteArea = document.createElement("div");
  noteArea.className = "note-area";
  main.appendChild(noteArea);

  row.appendChild(main);

  let qty;
  if (isTask) {
    // Gewoon een taak (bv. "Frituur links verschonen") — geen hoeveelheid
    // nodig, dus i.p.v. de hoev.-pulldown een rustig, niet-klikbaar label.
    // Zelfde plek/breedte als de echte select, zodat de kolommen (vinkje,
    // plannen, notitie, wissen) netjes uitgelijnd blijven met de andere
    // rijen in dezelfde categorie.
    qty = document.createElement("div");
    qty.className = "qty-input qty-taak";
    qty.textContent = "taak";
    qty.title = "Dit is een taak — geen hoeveelheid nodig, gewoon afvinken";
  } else {
    qty = document.createElement("select");
    qty.className = "qty-input";
    buildQtyOptions(qty);
    const initialQtyValue = mode === "tomorrow" ? preview.value : (st.hoeveelheid || "");
    ensureQtyOption(qty, initialQtyValue);
    qty.value = initialQtyValue;
    qty.disabled = mode === "today" && itemIsDone(item, st);
    qty.addEventListener("change", () => Store.setItemField(activeDateKey(), item.id, { hoeveelheid: qty.value }));
  }
  row.appendChild(qty);

  if (cb) row.appendChild(cb);

  let planBtn = null;
  if (mode === "today") {
    planBtn = document.createElement("button");
    planBtn.className = "plan-btn" + (planningsForItem(item.id).length ? " has-plan" : "");
    planBtn.title = "Vooruit plannen voor een toekomstige datum";
    planBtn.type = "button";
    planBtn.textContent = "📅";
    planBtn.addEventListener("click", () => openPlanningModal(item.id));
    row.appendChild(planBtn);
  }

  const noteBtn = document.createElement("button");
  noteBtn.className = "note-btn" + (st.note && st.note.trim() ? " has-note" : "");
  noteBtn.title = "Notitie (bv. wacht op leverancier)";
  noteBtn.type = "button";
  noteBtn.textContent = "🗒";
  noteBtn.addEventListener("click", () => {
    const refs = rowRefs.get(item.id);
    refs.noteEditing = !refs.noteEditing;
    updateNoteArea(item, refs);
  });
  row.appendChild(noteBtn);

  const clearBtn = document.createElement("button");
  clearBtn.className = "clear-btn";
  clearBtn.title = "Wissen / niet nodig";
  clearBtn.textContent = "✕";
  clearBtn.addEventListener("click", () => Store.clearItem(activeDateKey(), item.id));
  row.appendChild(clearBtn);

  let stepsPanel = null;
  const stepRefs = new Map();
  if (hasSteps) {
    stepsPanel = document.createElement("div");
    stepsPanel.className = "steps-panel" + (expandedItems.has(item.id) ? " expanded" : "");
    item.stappen.forEach((label, i) => {
      const sRow = document.createElement("div");
      sRow.className = "step-row";
      const sCb = document.createElement("button");
      sCb.className = "step-checkbox";
      sCb.type = "button";
      sCb.setAttribute("aria-label", "Stap afvinken");
      sCb.addEventListener("click", () => toggleStep(item, i));
      sRow.appendChild(sCb);
      const sLabel = document.createElement("div");
      sLabel.className = "step-label";
      sLabel.textContent = label;
      sRow.appendChild(sLabel);
      const sMeta = document.createElement("div");
      sMeta.className = "step-meta";
      sMeta.style.display = "none";
      sRow.appendChild(sMeta);
      stepsPanel.appendChild(sRow);
      stepRefs.set(i, { row: sRow, cb: sCb, meta: sMeta });
    });
  }

  const refs = {
    row, cb, qty, main, meta, carryBadge, noteArea, noteBtn, noteEditing: false, altClass,
    menuItem: item, hasSteps, stepsPanel, stepRefs, mode,
    planBtn, planWrap: null,
    predBadge: null,
  };
  rowRefs.set(item.id, refs);
  updateNoteArea(item, refs);
  return { row, stepsPanel };
}

// Bouwt het notitiegebiedje onder de productnaam opnieuw op: leeg als er niks
// is, een klein amber label als er een notitie staat, of een invoerveld
// zolang je 'm aan het bewerken bent. Zo blijft de lijst standaard rustig en
// opgeruimd — de notitie valt alleen op als hij er echt toe doet.
function updateNoteArea(item, refs) {
  const container = refs.noteArea;
  const activeInput = container.querySelector("input");
  if (activeInput && document.activeElement === activeInput) return; // niet verstoren tijdens typen
  const st = activeDay().items[item.id] || {};
  container.innerHTML = "";
  if (refs.noteEditing) {
    const input = document.createElement("input");
    input.className = "note-input-edit";
    input.placeholder = "bv. wacht op leverancier…";
    input.value = st.note || "";
    input.addEventListener("change", () => Store.setNote(activeDateKey(), item.id, input.value));
    input.addEventListener("blur", () => { refs.noteEditing = false; updateNoteArea(item, refs); });
    container.appendChild(input);
    setTimeout(() => input.focus(), 0);
  } else if (st.note && st.note.trim()) {
    const badge = document.createElement("div");
    badge.className = "note-badge";
    badge.textContent = "📌 " + st.note;
    badge.addEventListener("click", () => { refs.noteEditing = true; updateNoteArea(item, refs); });
    container.appendChild(badge);
  }
  if (refs.noteBtn) refs.noteBtn.classList.toggle("has-note", !!(st.note && st.note.trim()));
}

function toggleCheck(item, st) {
  if (!state.user) {
    openNamePrompt();
    showToast("Kies eerst je naam.");
    return;
  }
  if (st.checked) {
    Store.setItemField(activeDateKey(), item.id, { checked: false, paraaf: "", checkedAt: null });
    return;
  }
  // Verplichting: pas afvinkbaar zodra er een hoeveelheid bekend is — normaal
  // is die er al (ingevuld bij het voorbereiden van de vorige dag), dit is
  // vooral een vangnet voor spontaan toegevoegd werk. Geldt niet voor een
  // "taak" (geenHoeveelheid, bv. "Frituur links verschonen"): die heeft geen
  // hoeveelheid-veld en mag dus altijd direct afgevinkt worden.
  if (!item.geenHoeveelheid) {
    const hasQty = !!(st.hoeveelheid && st.hoeveelheid.trim());
    if (!hasQty) {
      showToast("Vul eerst een hoeveelheid in voordat je dit afvinkt.");
      return;
    }
  }
  Store.setItemField(activeDateKey(), item.id, { checked: true, paraaf: state.user, checkedAt: Date.now() });
}

function toggleStep(item, stepIndex) {
  if (!state.user) {
    openNamePrompt();
    showToast("Kies eerst je naam.");
    return;
  }
  const st = activeDay().items[item.id] || {};
  const cur = (st.steps || {})[stepIndex];
  const newChecked = !(cur && cur.checked);
  Store.setStep(activeDateKey(), item.id, stepIndex, {
    checked: newChecked,
    door: newChecked ? state.user : (cur ? cur.door : ""),
    tijd: newChecked ? Date.now() : null,
  });
}

function toggleExpand(itemId) {
  if (expandedItems.has(itemId)) expandedItems.delete(itemId);
  else expandedItems.add(itemId);
  const refs = rowRefs.get(itemId);
  if (refs && refs.stepsPanel) refs.stepsPanel.classList.toggle("expanded", expandedItems.has(itemId));
}

// ----------------------------------------------------------------------------
// Donker/licht-thema. De keuze wordt per toestel onthouden (localStorage) en
// al vóór de eerste tekening toegepast door het kleine inline scriptje in
// index.html (zie daar) — hier hoeven we 'm dus alleen nog te togglen, op te
// slaan, en de knop zelf (icoon/title) bij te werken.
// ----------------------------------------------------------------------------
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function applyThemeButtonLabel() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const isDark = currentTheme() === "dark";
  btn.textContent = isDark ? "☀️" : "🌙";
  const label = isDark ? "Lichte weergave aan" : "Donkere weergave aan";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}
function switchTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("mepTheme", next); } catch (e) { /* privénavigatie o.i.d. */ }
  applyThemeButtonLabel();
}

// ----------------------------------------------------------------------------
// Tabbladen: "Vandaag" (uitvoeren) vs "Morgen voorbereiden" (hoeveelheden
// invullen). Beide dagstatussen lopen continu op de achtergrond mee (live
// sync), zodat wisselen tussen tabbladen instant is — alleen het zichtbare
// tabblad wordt daadwerkelijk herbouwd/getekend.
// ----------------------------------------------------------------------------
function switchTab(tab) {
  // Kwam je van het dashboard? Dan moet dit altijd een echte wissel worden,
  // ook als activeTab intern nog op dezelfde waarde stond (het dashboard
  // verandert activeTab bewust niet) — anders blijft het dashboard onterecht
  // zichtbaar staan.
  const cameFromDashboard = state.dashboardActive;
  state.dashboardActive = false;
  document.getElementById("tabDashboard").classList.remove("active");
  if (state.activeTab === tab && !cameFromDashboard) return;
  state.activeTab = tab;
  document.getElementById("tabToday").classList.toggle("active", tab === "today");
  document.getElementById("tabTomorrow").classList.toggle("active", tab === "tomorrow");
  document.body.dataset.tab = tab;
  // Forceer een volledige herbouw: terwijl het dashboard open stond, liepen
  // live wijzigingen van anderen niet door naar deze (verborgen) weergave.
  render(cameFromDashboard || undefined);
}

// Dashboard: alleen-lezen overzicht, zichtbaar voor iedereen die al is
// ingelogd — toont live voortgang, wie wat heeft gedaan, en de status van
// de lijst voor morgen. Verandert bewust niets aan state.activeTab.
let dashboardTrendCache = null;
let dashboardTrendLoading = false;
let dashboardMonthCache = null; // { monthKey, rows } — zie renderDashboardMonth()
let dashboardMonthLoading = false;

function openDashboard() {
  if (state.dashboardActive) return;
  state.dashboardActive = true;
  document.getElementById("tabToday").classList.remove("active");
  document.getElementById("tabTomorrow").classList.remove("active");
  document.getElementById("tabDashboard").classList.add("active");
  document.body.dataset.tab = "dashboard";
  dashboardTrendCache = null;
  dashboardMonthCache = null;
  render();
}

// Wisselt tussen de live "dag"-weergave en de opgehaalde "maand"-weergave
// (knoppenbalk bovenaan het dashboard). De weergavekeuze zelf blijft staan
// tot iemand 'm bewust omzet, ook als je tussendoor van tabblad wisselt.
function switchDashboardView(mode) {
  if (state.dashboardViewMode === mode) return;
  state.dashboardViewMode = mode;
  render();
}

function renderDashboardViewToggle() {
  const dayBtn = document.getElementById("dashViewDayBtn");
  const monthBtn = document.getElementById("dashViewMonthBtn");
  const dayView = document.getElementById("dashDayView");
  const monthView = document.getElementById("dashMonthView");
  if (!dayBtn || !monthBtn || !dayView || !monthView) return;
  const isMonth = state.dashboardViewMode === "month";
  dayBtn.classList.toggle("active", !isMonth);
  monthBtn.classList.toggle("active", isMonth);
  dayBtn.setAttribute("aria-selected", String(!isMonth));
  monthBtn.setAttribute("aria-selected", String(isMonth));
  dayView.classList.toggle("hidden", isMonth);
  monthView.classList.toggle("hidden", !isMonth);
}

function renderDashboard() {
  renderDashboardViewToggle();
  if (state.dashboardViewMode === "month") {
    renderDashboardMonth();
    return;
  }
  renderDashboardKpis();
  renderDashboardStale();
  renderDashboardPlanning();
  renderDashboardCategoryBars();
  renderDashboardPeopleBars();
  renderDashboardTrend();
}

function dashKpiTile({ label, value, sub, pct, tone, noBar }) {
  const tile = document.createElement("div");
  tile.className = `dash-kpi dash-kpi-${tone || "brand"}`;
  const lbl = document.createElement("div");
  lbl.className = "dash-kpi-label";
  lbl.textContent = label;
  const val = document.createElement("div");
  val.className = "dash-kpi-value";
  val.textContent = value;
  tile.appendChild(lbl);
  tile.appendChild(val);
  if (!noBar && typeof pct === "number") {
    const track = document.createElement("div");
    track.className = "dash-kpi-track";
    const fill = document.createElement("div");
    fill.className = "dash-kpi-fill";
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    track.appendChild(fill);
    tile.appendChild(track);
  }
  const subEl = document.createElement("div");
  subEl.className = "dash-kpi-sub";
  subEl.textContent = sub;
  tile.appendChild(subEl);
  return tile;
}

// Wie heeft er vandaag iets afgevinkt? Telt zowel gewone vinkjes als
// (per stap) afgevinkte stappen mee — dezelfde telling als de rapportage,
// maar dan alleen voor vandaag en direct uit de live state i.p.v. een
// aparte database-call.
function todaysPersonCounts() {
  const byId = new Map(state.menu.map((m) => [m.id, m]));
  const counts = {};
  Object.entries(state.dayToday.items || {}).forEach(([id, it]) => {
    const menuItem = byId.get(id);
    if (!menuItem) return;
    const hasSteps = Array.isArray(menuItem.stappen) && menuItem.stappen.length > 0;
    if (hasSteps) {
      Object.values(it.steps || {}).forEach((s) => {
        if (s && s.checked && s.door) counts[s.door] = (counts[s.door] || 0) + 1;
      });
    } else if (it.checked && it.paraaf) {
      counts[it.paraaf] = (counts[it.paraaf] || 0) + 1;
    }
  });
  return counts;
}

// Items die al STALE_CARRY_DAYS (of meer) nachten op rij onafgerond zijn
// doorgeschoven — zie carryStreak, bijgehouden in rolloverIfNeeded. Wordt
// gebruikt voor zowel de KPI-tegel als de aparte "Blijft liggen"-kaart.
function staleItemsToday() {
  const today = state.dayToday;
  return state.menu
    .map((item) => ({ item, st: today.items[item.id] }))
    .filter(({ item, st }) => st && !!st.carriedOver && itemIsOpen(item, st) && (st.carryStreak || 0) >= staleCarryDays())
    .map(({ item, st }) => ({ item, st, daysOpen: (st.carryStreak || 0) + 1 }))
    .sort((a, b) => b.daysOpen - a.daysOpen || a.item.naam.localeCompare(b.item.naam, "nl"));
}

// ----------------------------------------------------------------------------
// Voorspellende hoeveelheden: op basis van eerder ingevulde hoeveelheden voor
// hetzelfde product op dezelfde weekdag, een zacht voorstel tonen zolang er
// nog niks is ingevuld — puur een hint, nooit verplicht of automatisch
// ingevuld. Haalt eenmalig een paar maanden geschiedenis op (zelfde
// Store.getDayStatesRange als het maand-dashboard/de rapportage, dus geen
// nieuwe backend-methode nodig) en rekent daarna alles lokaal uit.
// ----------------------------------------------------------------------------
const PREDICTION_HISTORY_DAYS = 84; // ~12 weken, genoeg voor een paar metingen per weekdag
let predictionHistoryCache = null; // array van { dateKey, data } of null zolang nog niet geladen
let predictionHistoryLoading = false;

async function ensurePredictionHistory() {
  if (predictionHistoryCache || predictionHistoryLoading) return;
  predictionHistoryLoading = true;
  try {
    const startKey = dateKey(addDays(new Date(), -PREDICTION_HISTORY_DAYS));
    const endKey = state.todayKey;
    predictionHistoryCache = await Store.getDayStatesRange(startKey, endKey);
  } catch (e) {
    console.warn("Geschiedenis voor voorspelling laden mislukt (geen ramp, gewoon geen hints):", e);
    predictionHistoryCache = [];
  } finally {
    predictionHistoryLoading = false;
    // Structurele herbouw zodat de net geladen voorstellen meteen zichtbaar
    // worden, ook als er ondertussen niets anders aan de lijst veranderde.
    render(true);
  }
}

// Geeft { avg, count, sameWeekday } terug, of null als er te weinig
// geschiedenis is om een zinnig voorstel te doen. Kijkt eerst of er minstens
// 2 eerdere metingen op dezelfde weekdag zijn (bv. eerdere dinsdagen); zo
// niet, valt het terug op alle eerdere dagen samen (met een hogere drempel
// van 3, want dat zegt minder over "deze specifieke dag").
function computePrediction(itemId, targetDateKey) {
  if (!predictionHistoryCache || !predictionHistoryCache.length) return null;
  const targetWeekday = parseDateKey(targetDateKey).getDay();
  const sameWeekdayVals = [];
  const allVals = [];
  for (const row of predictionHistoryCache) {
    if (!row || row.dateKey === targetDateKey || !row.data) continue;
    const it = row.data.items && row.data.items[itemId];
    const n = it && it.hoeveelheid ? parseFloat(it.hoeveelheid) : NaN;
    if (!isFinite(n) || n <= 0) continue;
    allVals.push(n);
    if (parseDateKey(row.dateKey).getDay() === targetWeekday) sameWeekdayVals.push(n);
  }
  let vals, sameWeekday;
  if (sameWeekdayVals.length >= 2) { vals = sameWeekdayVals; sameWeekday = true; }
  else if (allVals.length >= 3) { vals = allVals; sameWeekday = false; }
  else return null;
  const avgRaw = vals.reduce((a, b) => a + b, 0) / vals.length;
  const avg = Math.min(10, Math.max(1, Math.round(avgRaw)));
  return { avg, count: vals.length, sameWeekday };
}

function predBadgeText(pred, targetDateKey) {
  if (pred.sameWeekday) {
    const wd = parseDateKey(targetDateKey).toLocaleDateString("nl-NL", { weekday: "long" });
    return `✨ Meestal ~${pred.avg}x op een ${wd} (${pred.count}x eerder gemeten) — klik om over te nemen`;
  }
  return `✨ Meestal ~${pred.avg}x (${pred.count}x eerder gemeten) — klik om over te nemen`;
}

// Bouwt/verwijdert het voorstel-badge onder een itemrij en zorgt dat een
// klik erop de voorgestelde hoeveelheid direct overneemt. Alleen zichtbaar
// zolang er nog geen hoeveelheid is ingevuld — zodra iemand zelf iets kiest
// (of het voorstel overneemt) verdwijnt de hint vanzelf, die heeft dan geen
// functie meer.
function renderPredictionBadge(refs, itemId, targetDateKey, currentValue) {
  const pred = !currentValue ? computePrediction(itemId, targetDateKey) : null;
  if (!pred) {
    if (refs.predBadge) { refs.predBadge.remove(); refs.predBadge = null; }
    return;
  }
  if (!refs.predBadge) {
    refs.predBadge = document.createElement("div");
    refs.predBadge.className = "pred-badge";
    refs.predBadge.setAttribute("role", "button");
    refs.predBadge.tabIndex = 0;
    refs.main.insertBefore(refs.predBadge, refs.noteArea);
    const apply = () => {
      ensureQtyOption(refs.qty, String(pred.avg));
      refs.qty.value = String(pred.avg);
      Store.setItemField(activeDateKey(), itemId, { hoeveelheid: String(pred.avg) });
    };
    refs.predBadge.addEventListener("click", apply);
    refs.predBadge.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apply(); } });
  }
  refs.predBadge.textContent = predBadgeText(pred, targetDateKey);
}

// ----------------------------------------------------------------------------
// Vooruit plannen: iets voor een toekomstige datum alvast inplannen (bv. op
// maandag al weten dat iets donderdag klaar moet zijn). Los van de dagstatus
// zelf, dus blijft bewaard tot iemand het handmatig verwijdert — ook als de
// datum al voorbij is, dan springt de melding er juist extra uit.
// ----------------------------------------------------------------------------
function planningsForItem(itemId) {
  return state.planning
    .filter((p) => p.itemId === itemId)
    .sort((a, b) => a.targetDateKey.localeCompare(b.targetDateKey));
}
function planningIsDue(p) {
  return p.targetDateKey <= state.todayKey;
}
function planBadgeText(p) {
  const dateLabel = shortDutchDate(parseDateKey(p.targetDateKey));
  let text;
  if (p.targetDateKey < state.todayKey) {
    text = `📅 Was gepland voor ${dateLabel} — dit had al gemoeten!`;
  } else if (p.targetDateKey === state.todayKey) {
    text = "📅 Vandaag gepland";
  } else {
    text = `📅 Gepland voor ${dateLabel}`;
  }
  if (p.note && p.note.trim()) text += ` — ${p.note.trim()}`;
  return text;
}
// Bouwt/patcht het rijtje planning-badges onder een item-rij op het
// Vandaag-tabblad. Meerdere plannen per item kunnen tegelijk actief zijn
// (bv. twee verschillende toekomstige data), dus altijd opnieuw opgebouwd —
// dat gebeurt zelden genoeg per rij om dit simpel te houden.
//
// Bewust ALTIJD zichtbaar op de lijst van vandaag, ook als de geplande datum
// nog in de toekomst ligt: is er toevallig nu al tijd en zijn de ingrediënten
// in huis, dan kan iemand het gewoon vast oppakken in plaats van te moeten
// wachten tot de geplande dag. Het kleurverschil maakt het onderscheid
// duidelijk: rustig goud voor "staat er alvast aan te komen", fel/pulserend
// rood zodra de datum ook echt is aangebroken (of al voorbij is) — zie
// plan-badge-due hieronder en planningIsDue().
function renderPlanBadges(refs, itemId) {
  if (refs.planBtn) refs.planBtn.classList.toggle("has-plan", state.planning.some((p) => p.itemId === itemId));
  const plans = planningsForItem(itemId);
  if (!plans.length) {
    if (refs.planWrap) { refs.planWrap.remove(); refs.planWrap = null; }
    return;
  }
  if (!refs.planWrap) {
    refs.planWrap = document.createElement("div");
    refs.planWrap.className = "plan-badge-wrap";
    refs.main.insertBefore(refs.planWrap, refs.noteArea);
  }
  refs.planWrap.innerHTML = "";
  plans.forEach((p) => {
    const badge = document.createElement("div");
    badge.className = "plan-badge" + (planningIsDue(p) ? " plan-badge-due" : "");
    const label = document.createElement("span");
    label.textContent = planBadgeText(p);
    label.title = planBadgeText(p);
    badge.appendChild(label);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "plan-badge-remove";
    rm.title = "Planning verwijderen (bv. omdat het alsnog is gedaan)";
    rm.textContent = "✕";
    rm.addEventListener("click", () => Store.removePlanning(p.id));
    badge.appendChild(rm);
    refs.planWrap.appendChild(badge);
  });
}
// Voor het dashboard: alle plannen, gesorteerd op datum (dichtstbij eerst).
function upcomingPlannings() {
  const byId = new Map(state.menu.map((m) => [m.id, m]));
  return state.planning
    .map((p) => ({ p, item: byId.get(p.itemId) }))
    .filter(({ item }) => !!item)
    .sort((a, b) => a.p.targetDateKey.localeCompare(b.p.targetDateKey) || a.item.naam.localeCompare(b.item.naam, "nl"));
}

function renderDashboardKpis() {
  const wrap = document.getElementById("dashKpis");
  if (!wrap) return;
  const today = state.dayToday;

  const relevantToday = state.menu.filter(
    (i) => itemIsDone(i, today.items[i.id]) || itemIsOpen(i, today.items[i.id])
  );
  const doneToday = relevantToday.filter((i) => itemIsDone(i, today.items[i.id])).length;
  const totalToday = relevantToday.length;
  const pctToday = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

  const approved = state.dayTomorrow.approved;
  const counts = todaysPersonCounts();
  const activePeople = Object.keys(counts);

  // Hoeveel categorieën staan er vandaag al helemaal klaar (elk relevant
  // item afgevinkt)? Mooie aanvulling op de categorie-balken hieronder: in
  // één oogopslag zien hoeveel "vakjes" al helemaal af zijn, niet alleen
  // het totaal aantal items.
  const catsWithRelevant = state.categories.filter((cat) =>
    itemsByCategory(cat.id).some((i) => itemIsDone(i, today.items[i.id]) || itemIsOpen(i, today.items[i.id]))
  );
  const catsComplete = catsWithRelevant.filter((cat) => {
    const relevant = itemsByCategory(cat.id).filter((i) => itemIsDone(i, today.items[i.id]) || itemIsOpen(i, today.items[i.id]));
    return relevant.length > 0 && relevant.every((i) => itemIsDone(i, today.items[i.id]));
  });
  const pctCatsComplete = catsWithRelevant.length ? Math.round((catsComplete.length / catsWithRelevant.length) * 100) : 0;

  const stale = staleItemsToday();

  wrap.innerHTML = "";
  wrap.appendChild(dashKpiTile({
    label: "Voortgang vandaag",
    value: totalToday ? `${doneToday} / ${totalToday}` : "–",
    sub: totalToday ? `${pctToday}% klaar` : "Nog niets ingevuld",
    pct: pctToday,
    tone: "good",
  }));
  wrap.appendChild(dashKpiTile({
    label: "Blijft liggen",
    value: stale.length ? `🚨 ${stale.length}` : "0",
    sub: stale.length
      ? stale.map((s) => s.item.naam).join(", ")
      : "Niets blijft steeds liggen",
    tone: stale.length ? "danger" : "good",
    noBar: true,
  }));
  wrap.appendChild(dashKpiTile({
    label: "Categorieën klaar",
    value: catsWithRelevant.length ? `${catsComplete.length} / ${catsWithRelevant.length}` : "–",
    sub: catsWithRelevant.length ? `${pctCatsComplete}% volledig afgerond` : "Nog niets ingevuld",
    pct: pctCatsComplete,
    tone: "todo",
  }));
  wrap.appendChild(dashKpiTile({
    label: "Actief vandaag",
    value: String(activePeople.length),
    sub: activePeople.length ? activePeople.sort((a, b) => a.localeCompare(b, "nl")).join(", ") : "Nog niemand",
    tone: "brand",
    noBar: true,
  }));
  wrap.appendChild(dashKpiTile({
    label: "Lijst morgen",
    value: approved ? "✅ Goedgekeurd" : "⏳ Nog niet",
    sub: approved
      ? `door ${state.dayTomorrow.approvedBy || "?"} om ${formatTime(state.dayTomorrow.approvedAt)}`
      : "Wacht nog op akkoord",
    tone: approved ? "good" : "warn",
    noBar: true,
  }));
}

// Aparte, opvallende kaart met de items die al 2+ nachten op rij blijven
// liggen — alleen zichtbaar zodra dat ook echt zo is, om het dashboard op
// goede dagen niet nodeloos vol te zetten.
function renderDashboardStale() {
  const card = document.getElementById("dashStaleCard");
  const wrap = document.getElementById("dashStaleList");
  if (!card || !wrap) return;
  const stale = staleItemsToday();
  card.classList.toggle("hidden", !stale.length);
  if (!stale.length) { wrap.innerHTML = ""; return; }

  const catById = new Map(state.categories.map((c) => [c.id, c]));
  wrap.innerHTML = "";
  stale.forEach(({ item, daysOpen }) => {
    const row = document.createElement("div");
    row.className = "dash-stale-row";
    const name = document.createElement("div");
    name.className = "dash-stale-name";
    const cat = catById.get(item.categorie);
    name.textContent = item.naam + (cat ? ` · ${cat.naam}` : "");
    const badge = document.createElement("div");
    badge.className = "stale-badge dash-stale-badge";
    badge.textContent = `🚨 Al ${daysOpen} dagen open`;
    row.appendChild(name);
    row.appendChild(badge);
    wrap.appendChild(row);
  });
}

// Overzicht van alles wat vooruit is ingepland (zie openPlanningModal()),
// zodat je op het Dashboard in één oogopslag ziet wat er de komende dagen
// al aankomt — ook items die vandaag nog geen hoeveelheid hebben.
function renderDashboardPlanning() {
  const card = document.getElementById("dashPlanningCard");
  const wrap = document.getElementById("dashPlanningList");
  if (!card || !wrap) return;
  const upcoming = upcomingPlannings();
  card.classList.toggle("hidden", !upcoming.length);
  if (!upcoming.length) { wrap.innerHTML = ""; return; }

  const catById = new Map(state.categories.map((c) => [c.id, c]));
  wrap.innerHTML = "";
  upcoming.forEach(({ p, item }) => {
    const row = document.createElement("div");
    row.className = "dash-plan-row" + (planningIsDue(p) ? " dash-plan-row-due" : "");
    const name = document.createElement("div");
    name.className = "dash-plan-name";
    const cat = catById.get(item.categorie);
    name.textContent = item.naam + (cat ? ` · ${cat.naam}` : "");
    const badge = document.createElement("div");
    badge.className = "plan-badge dash-plan-badge" + (planningIsDue(p) ? " plan-badge-due" : "");
    badge.textContent = planBadgeText(p);
    row.appendChild(name);
    row.appendChild(badge);
    wrap.appendChild(row);
  });
}

function dashBarRow({ label, value, pct }) {
  const row = document.createElement("div");
  row.className = "dash-bar-row";
  const lbl = document.createElement("div");
  lbl.className = "dash-bar-label";
  lbl.textContent = label;
  lbl.title = label;
  const track = document.createElement("div");
  track.className = "dash-bar-track";
  const fill = document.createElement("div");
  fill.className = "dash-bar-fill";
  fill.style.width = Math.max(pct > 0 ? 4 : 0, pct) + "%";
  track.appendChild(fill);
  const val = document.createElement("div");
  val.className = "dash-bar-value";
  val.textContent = value;
  row.appendChild(lbl);
  row.appendChild(track);
  row.appendChild(val);
  return row;
}

function renderDashboardCategoryBars() {
  const wrap = document.getElementById("dashCatBars");
  if (!wrap) return;
  const today = state.dayToday;
  const cats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
  wrap.innerHTML = "";
  if (!cats.length) {
    wrap.innerHTML = `<p class="muted">Nog geen categorieën.</p>`;
    return;
  }
  cats.forEach((cat) => {
    const items = itemsByCategory(cat.id);
    const relevant = items.filter((i) => itemIsDone(i, today.items[i.id]) || itemIsOpen(i, today.items[i.id]));
    const done = relevant.filter((i) => itemIsDone(i, today.items[i.id])).length;
    const total = relevant.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    wrap.appendChild(dashBarRow({ label: cat.naam, value: total ? `${done}/${total}` : "–", pct }));
  });
}

function renderDashboardPeopleBars() {
  const wrap = document.getElementById("dashPeopleBars");
  if (!wrap) return;
  const counts = todaysPersonCounts();
  const people = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"));
  wrap.innerHTML = "";
  if (!people.length) {
    wrap.innerHTML = `<p class="muted">Nog niemand heeft vandaag iets afgevinkt.</p>`;
    return;
  }
  const max = Math.max(...people.map(([, n]) => n));
  people.forEach(([naam, n]) => {
    wrap.appendChild(dashBarRow({ label: naam, value: String(n), pct: Math.round((n / max) * 100) }));
  });
}

// 7-daagse trend van afgeronde items — cachet zodra het dashboard open gaat
// (niet bij elke live update) om onnodige extra database-reads te vermijden;
// de rest van het dashboard blijft wél live.
function paintDashboardTrend(rows) {
  const wrap = document.getElementById("dashTrendChart");
  if (!wrap) return;
  const end = new Date();
  const start = addDays(end, -6);
  const byId = new Map(state.menu.map((m) => [m.id, m]));
  const days = Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)));
  const perDay = {};
  days.forEach((dk) => { perDay[dk] = 0; });
  rows.forEach(({ dateKey: dk, data }) => {
    if (!(dk in perDay)) return;
    const items = (data && data.items) || {};
    for (const [id, it] of Object.entries(items)) {
      const menuItem = byId.get(id);
      if (!menuItem) continue;
      if (itemIsDone(menuItem, it)) perDay[dk] += 1;
    }
  });
  const max = Math.max(1, ...days.map((dk) => perDay[dk]));
  const todayKey = dateKey(end);
  wrap.innerHTML = "";
  days.forEach((dk) => {
    const count = perDay[dk] || 0;
    const pct = Math.round((count / max) * 100);
    const d = parseDateKey(dk);
    const col = document.createElement("div");
    col.className = "trend-col" + (dk === todayKey ? " trend-today" : "");
    const val = document.createElement("div");
    val.className = "trend-val";
    val.textContent = String(count);
    const barWrap = document.createElement("div");
    barWrap.className = "trend-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = Math.max(count > 0 ? 4 : 0, pct) + "%";
    barWrap.appendChild(bar);
    const lbl = document.createElement("div");
    lbl.className = "trend-lbl";
    lbl.textContent = d.toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "");
    col.title = `${shortDutchDate(d)}: ${count} afgerond`;
    col.appendChild(val);
    col.appendChild(barWrap);
    col.appendChild(lbl);
    wrap.appendChild(col);
  });
}

async function renderDashboardTrend() {
  const wrap = document.getElementById("dashTrendChart");
  if (!wrap) return;
  if (dashboardTrendCache) { paintDashboardTrend(dashboardTrendCache); return; }
  if (dashboardTrendLoading) return;
  dashboardTrendLoading = true;
  wrap.innerHTML = `<p class="muted">Laden…</p>`;
  try {
    const end = new Date();
    const start = addDays(end, -6);
    const rows = await Store.getDayStatesRange(dateKey(start), dateKey(end));
    dashboardTrendCache = rows;
  } catch (e) {
    console.error("Dashboard-trend laden mislukt:", e);
    dashboardTrendLoading = false;
    if (state.dashboardActive) wrap.innerHTML = `<p class="muted">Kon de trend niet laden.</p>`;
    return;
  }
  dashboardTrendLoading = false;
  if (state.dashboardActive) paintDashboardTrend(dashboardTrendCache);
}

// ----------------------------------------------------------------------------
// Maandweergave van het dashboard: hetzelfde soort overzicht als de dag-
// weergave, maar dan opgeteld over de hele lopende kalendermaand (t/m
// vandaag — toekomstige dagen hebben nog geen data). Wordt, net als de
// 7-daagse trend hierboven, één keer opgehaald zodra je 'm opent/wisselt en
// daarna uit cache getekend — geen live sync, dat zou voor een hele maand
// aan dagdocumenten te veel database-reads kosten voor wat het oplevert.
// ----------------------------------------------------------------------------
function computeMonthStats(rows) {
  const byId = new Map(state.menu.map((m) => [m.id, m]));
  const catById = new Map(state.categories.map((c) => [c.id, c]));
  const personCounts = {};
  const catCounts = {};
  const dailyTotals = [];
  let totalDone = 0;
  let daysWithActivity = 0;
  let daysWithCarry = 0;

  rows
    .slice()
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .forEach(({ dateKey: dk, data }) => {
      const items = (data && data.items) || {};
      let dayCount = 0;
      let dayHasCarry = false;
      for (const [id, it] of Object.entries(items)) {
        const menuItem = byId.get(id);
        if (!menuItem) continue;
        if (it.carriedOver) dayHasCarry = true;
        const hasSteps = Array.isArray(menuItem.stappen) && menuItem.stappen.length > 0;
        const cat = catById.get(menuItem.categorie);
        if (hasSteps) {
          Object.values(it.steps || {}).forEach((s) => {
            if (s && s.checked) {
              dayCount++;
              if (s.door) personCounts[s.door] = (personCounts[s.door] || 0) + 1;
              if (cat) catCounts[cat.id] = (catCounts[cat.id] || 0) + 1;
            }
          });
        } else if (it.checked) {
          dayCount++;
          if (it.paraaf) personCounts[it.paraaf] = (personCounts[it.paraaf] || 0) + 1;
          if (cat) catCounts[cat.id] = (catCounts[cat.id] || 0) + 1;
        }
      }
      totalDone += dayCount;
      if (dayCount > 0) daysWithActivity++;
      if (dayHasCarry) daysWithCarry++;
      dailyTotals.push({ dateKey: dk, count: dayCount });
    });

  const topPerson = Object.entries(personCounts).sort((a, b) => b[1] - a[1])[0] || null;
  const avgPerActiveDay = daysWithActivity ? Math.round(totalDone / daysWithActivity) : 0;

  return { totalDone, daysWithActivity, daysWithCarry, personCounts, catCounts, dailyTotals, topPerson, avgPerActiveDay };
}

function paintDashboardMonth(rows) {
  const stats = computeMonthStats(rows);
  const now = new Date();
  const monthLabel = now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  const kpiWrap = document.getElementById("dashMonthKpis");
  if (kpiWrap) {
    kpiWrap.innerHTML = "";
    kpiWrap.appendChild(dashKpiTile({
      label: `Afgerond in ${monthLabel}`,
      value: String(stats.totalDone),
      sub: stats.daysWithActivity ? `Over ${stats.daysWithActivity} actieve dag${stats.daysWithActivity === 1 ? "" : "en"}` : "Nog geen activiteit deze maand",
      tone: "good",
      noBar: true,
    }));
    kpiWrap.appendChild(dashKpiTile({
      label: "Actiefste teamlid",
      value: stats.topPerson ? stats.topPerson[0] : "–",
      sub: stats.topPerson ? `${stats.topPerson[1]} items afgevinkt` : "Nog niemand deze maand",
      tone: "brand",
      noBar: true,
    }));
    kpiWrap.appendChild(dashKpiTile({
      label: "Gemiddeld per actieve dag",
      value: stats.daysWithActivity ? String(stats.avgPerActiveDay) : "–",
      sub: "Afgeronde items per dag met activiteit",
      tone: "brand",
      noBar: true,
    }));
    kpiWrap.appendChild(dashKpiTile({
      label: "Dagen met achterstand",
      value: String(stats.daysWithCarry),
      sub: stats.daysWithCarry ? "Dagen waarop iets van eerder bleef liggen" : "Niets is deze maand blijven liggen",
      tone: stats.daysWithCarry ? "danger" : "good",
      noBar: true,
    }));
  }

  const catWrap = document.getElementById("dashMonthCatBars");
  if (catWrap) {
    catWrap.innerHTML = "";
    const cats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
    const catEntries = cats
      .map((c) => ({ cat: c, count: stats.catCounts[c.id] || 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
    if (!catEntries.length) {
      catWrap.innerHTML = `<p class="muted">Nog geen afgevinkte items deze maand.</p>`;
    } else {
      const max = Math.max(...catEntries.map((e) => e.count));
      catEntries.forEach(({ cat, count }) => {
        catWrap.appendChild(dashBarRow({ label: cat.naam, value: String(count), pct: Math.round((count / max) * 100) }));
      });
    }
  }

  const peopleWrap = document.getElementById("dashMonthPeopleBars");
  if (peopleWrap) {
    peopleWrap.innerHTML = "";
    const people = Object.entries(stats.personCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"));
    if (!people.length) {
      peopleWrap.innerHTML = `<p class="muted">Nog niemand heeft deze maand iets afgevinkt.</p>`;
    } else {
      const max = Math.max(...people.map(([, n]) => n));
      people.forEach(([naam, n]) => {
        peopleWrap.appendChild(dashBarRow({ label: naam, value: String(n), pct: Math.round((n / max) * 100) }));
      });
    }
  }

  const trendWrap = document.getElementById("dashMonthTrendChart");
  const trendTitle = document.getElementById("dashMonthTrendTitle");
  if (trendTitle) trendTitle.textContent = `Afgeronde items · ${monthLabel}`;
  if (trendWrap) {
    trendWrap.innerHTML = "";
    if (!stats.dailyTotals.length) {
      trendWrap.innerHTML = `<p class="muted">Nog geen data deze maand.</p>`;
    } else {
      const max = Math.max(1, ...stats.dailyTotals.map((d) => d.count));
      const todayK = state.todayKey;
      stats.dailyTotals.forEach(({ dateKey: dk, count }) => {
        const pct = Math.round((count / max) * 100);
        const d = parseDateKey(dk);
        const col = document.createElement("div");
        col.className = "trend-col trend-col-month" + (dk === todayK ? " trend-today" : "");
        const val = document.createElement("div");
        val.className = "trend-val";
        val.textContent = String(count);
        const barWrap = document.createElement("div");
        barWrap.className = "trend-bar-wrap";
        const bar = document.createElement("div");
        bar.className = "trend-bar";
        bar.style.height = Math.max(count > 0 ? 4 : 0, pct) + "%";
        barWrap.appendChild(bar);
        const lbl = document.createElement("div");
        lbl.className = "trend-lbl";
        lbl.textContent = String(d.getDate());
        col.title = `${shortDutchDate(d)}: ${count} afgerond`;
        col.appendChild(val);
        col.appendChild(barWrap);
        col.appendChild(lbl);
        trendWrap.appendChild(col);
      });
    }
  }
}

async function renderDashboardMonth() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  if (dashboardMonthCache && dashboardMonthCache.monthKey === monthKey) {
    paintDashboardMonth(dashboardMonthCache.rows);
    return;
  }
  if (dashboardMonthLoading) return;
  dashboardMonthLoading = true;
  const kpiWrap = document.getElementById("dashMonthKpis");
  if (kpiWrap) kpiWrap.innerHTML = `<p class="muted">Laden…</p>`;
  const startKey = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const endKey = state.todayKey;
  try {
    const rows = await Store.getDayStatesRange(startKey, endKey);
    dashboardMonthCache = { monthKey, rows };
  } catch (e) {
    console.error("Maandoverzicht laden mislukt:", e);
    dashboardMonthLoading = false;
    if (state.dashboardActive && state.dashboardViewMode === "month" && kpiWrap) {
      kpiWrap.innerHTML = `<p class="muted">Kon het maandoverzicht niet laden.</p>`;
    }
    return;
  }
  dashboardMonthLoading = false;
  if (state.dashboardActive && state.dashboardViewMode === "month") paintDashboardMonth(dashboardMonthCache.rows);
}

function renderApprovalBanner() {
  const wrap = document.getElementById("approvalBanner");
  if (!wrap) return;
  if (state.activeTab !== "tomorrow") {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  const day = state.dayTomorrow;
  const btn = document.getElementById("approveBtn");
  const status = document.getElementById("approvalStatus");
  if (day.approved) {
    status.textContent = `✅ Goedgekeurd door ${day.approvedBy || "?"} om ${formatTime(day.approvedAt)}`;
    status.className = "approval-status approval-status-done";
    btn.textContent = "Opnieuw goedkeuren";
  } else {
    status.textContent = "Nog niet goedgekeurd — druk op de knop zodra de lijst voor morgen compleet is.";
    status.className = "approval-status";
    btn.textContent = "✅ Lijst is klaar voor morgen";
  }
}

function approveDay() {
  if (!state.user) {
    openNamePrompt();
    showToast("Kies eerst je naam.");
    return;
  }
  // Lees de select rechtstreeks uit de DOM i.p.v. uit state: de opslag van
  // dit veld is gedebouncet, dus state.dayTomorrow.gemaaktDoor kan nog even
  // achterlopen op wat er net gekozen is. Zo blokkeren we niet onterecht.
  const gd = document.getElementById("gemaaktDoor");
  const gemaaktDoorValue = ((gd && gd.value) || "").trim();
  if (!gemaaktDoorValue) {
    showToast("Vul eerst in wie de lijst heeft gemaakt.");
    if (gd) { gd.classList.add("field-missing"); gd.focus(); }
    return;
  }
  if (gd) gd.classList.remove("field-missing");
  if (state.dayTomorrow.gemaaktDoor !== gemaaktDoorValue) {
    Store.setHeader(state.tomorrowKey, { gemaaktDoor: gemaaktDoorValue });
  }
  Store.approveDay(state.tomorrowKey, { door: state.user });
  checkApprovalAlerts();
  showToast("Lijst voor morgen is goedgekeurd.");
}

// ----------------------------------------------------------------------------
// Naam-picker + toegangscode
// ----------------------------------------------------------------------------
// Zolang er nog helemaal geen enkele toegangscode is ingesteld (vers na het
// uitrollen van deze functie, of op een nieuw/lokaal toestel), werkt inloggen
// nog net als voorheen: gewoon een naam kiezen. Zodra Joris voor iemand een
// code instelt via het beheerscherm, wordt code-verificatie voor IEDEREEN
// verplicht — zo kan dit nooit per ongeluk iedereen buitensluiten.
function accessGatingActive() {
  // Zodra er ooit minstens één code is ingesteld, blijft code-verplichting
  // permanent aan staan (via het "activated"-veld) — ook als die ene code
  // later weer wordt ingetrokken. Zonder dit zou het intrekken van de
  // laatste overgebleven code de héle beveiliging weer uitzetten voor
  // iedereen, in plaats van alleen die ene persoon buiten te sluiten.
  return !!state.accessGatingActivated || Object.keys(state.accessCodes || {}).length > 0;
}

// De naam "Joris" is de vaste bootstrap-beheerder: hij mag altijd bij het
// beheerscherm (zie isCurrentUserAdmin) én mag nooit zelf buitengesloten
// worden door de toegangscode-verplichting (zie validateSession/selectUser)
// — anders zou hij, als enige die codes kan instellen/intrekken, zichzelf
// per ongeluk kunnen opsluiten zonder dat iemand er nog bij kan (dat is
// eerder ook echt gebeurd: zie de incident-fix in validateSession).
function isBootstrapAdminName(name) {
  return !!name && name.trim().toLowerCase() === "joris";
}

// Mag DIT toestel de app sowieso openen? Zolang er nooit een goedkeuringscode
// is gegenereerd (state.devices.activated is dan nog false) staat dit altijd
// "aan" — precies zoals accessGatingActive() hierboven, zodat het uitrollen
// van deze functie nooit per ongeluk het hele team buitensluit totdat Joris
// er zelf bewust voor kiest.
function deviceAccessOk() {
  if (!state.devices || !state.devices.activated) return true;
  return !!(state.devices.approved && state.devices.approved[getDeviceId()]);
}

// Toont/verbergt het "dit toestel is nog niet goedgekeurd"-scherm. Wordt
// aangeroepen zodra de devices-data voor het eerst binnenkomt én telkens als
// die live wijzigt (bv. Joris trekt dit toestel in, of keurt het net goed) —
// zo werkt zowel intrekken als goedkeuren direct door, zonder herladen.
function updateDeviceGate() {
  const blocked = !deviceAccessOk();
  const gateEl = document.getElementById("deviceGate");
  if (gateEl) gateEl.classList.toggle("hidden", !blocked);
  if (blocked) {
    // Reset het formulier niet bij elke snapshot (anders verdwijnt wat
    // iemand net aan het intypen is) — alleen de foutmelding verbergen we
    // niet automatisch, die blijft staan tot een nieuwe poging.
    return;
  }
  // Toestel is (weer) in orde — ga verder met de gewone naam/code-flow
  // alsof er niets aan de hand was.
  if (!state.user && teamLoadedOnce) openNamePrompt();
  validateSession();
}

// Wie mag in het beheerscherm toegangscodes instellen/intrekken? Joris mag
// dit altijd (op naam, ongeacht de "admins"-lijst) — dat voorkomt dat hij
// zichzelf ooit per ongeluk buitensluit. Daarnaast kan hij zelf iemand
// anders als extra beheerder aanwijzen via het sterretje in het beheerscherm.
function isCurrentUserAdmin() {
  if (!state.user) return false;
  if (isBootstrapAdminName(state.user)) return true;
  return (state.admins || []).includes(state.user);
}

// Wie mag categorieën en producten aanpassen (toevoegen/hernoemen/verwijderen/
// stappen instellen)? Dit is een aparte, kleinere bevoegdheid dan "admin"
// (team- en codebeheer): Joris mag het altijd, elke aangewezen admin (★) mag
// het ook, en daarnaast is "Bo" hiervoor op naam aangewezen — ook als Bo geen
// ★-admin is en dus geen team/codes beheert.
function isContentEditor() {
  if (isCurrentUserAdmin()) return true;
  return !!state.user && state.user.trim().toLowerCase() === "bo";
}

let pendingCodeName = null;
// validateSession() mag pas oordelen zodra zowel team als toegangscodes
// minstens één keer zijn binnengekomen — anders zou een toestel met een
// geldige, onthouden sessie foutief uitgelogd kunnen worden puur omdat de
// team-lijst nog niet geladen was op het moment dat de codes binnenkwamen.
let teamLoadedOnce = false;
let accessCodesLoadedOnce = false;
let devicesLoadedOnce = false;

// ----------------------------------------------------------------------------
// Automatisch uitloggen na inactiviteit: op de gedeelde tablet in de keuken
// blijft anders de laatst gekozen naam eindeloos "ingelogd" staan, ook nadat
// iemand anders 'm heeft opgepakt — met als gevolg dat afvinkjes/rapportages
// op de verkeerde naam belanden. Na een kwartier zonder enige interactie
// (klik, tik, toets) vragen we daarom opnieuw "Wie ben jij?".
// ----------------------------------------------------------------------------
const IDLE_LOGOUT_MS = 15 * 60 * 1000;
// Instelbaar per zaak via Beheer > Zaak (minuten, 0 = nooit automatisch uitloggen).
function idleLogoutMs() { const m = Number(state.zaak ? state.zaak.uitlogMinuten : NaN); return Number.isFinite(m) && m >= 0 ? m * 60 * 1000 : IDLE_LOGOUT_MS; }
let lastActivityAt = Date.now();
function markActivity() {
  lastActivityAt = Date.now();
}
function checkIdleLogout() {
  if (!state.user) return;
  if (!document.getElementById("namePrompt").classList.contains("hidden")) return;
  if (idleLogoutMs() <= 0 || Date.now() - lastActivityAt < idleLogoutMs()) return;
  state.user = null;
  localStorage.removeItem("mep_user");
  localStorage.removeItem("mep_access_code");
  renderUserBadge();
  showToast("Alweer een kwartier stil op dit toestel — wie ben jij? Kies opnieuw je naam.");
  openNamePrompt();
}

function openNamePrompt() {
  // Het apparaat-goedkeuringsscherm gaat altijd voor: zolang dit toestel
  // niet is goedgekeurd, komt niemand zelfs maar bij de naamkeuze.
  if (!deviceAccessOk()) return;
  document.getElementById("namePrompt").classList.remove("hidden");
  showNameStep();
  renderNameList();
}
function closeNamePrompt() {
  document.getElementById("namePrompt").classList.add("hidden");
}
function showNameStep() {
  pendingCodeName = null;
  document.getElementById("nameStep").classList.remove("hidden");
  document.getElementById("codeStep").classList.add("hidden");
}
function showCodeStep(name) {
  pendingCodeName = name;
  document.getElementById("nameStep").classList.add("hidden");
  document.getElementById("codeStep").classList.remove("hidden");
  document.getElementById("codeStepName").textContent = name;
  const input = document.getElementById("codeInput");
  input.value = "";
  document.getElementById("codeError").classList.add("hidden");
  input.focus();
}
function unlockUser(name, code) {
  state.user = name;
  markActivity();
  localStorage.setItem("mep_user", name);
  localStorage.setItem("mep_access_code", code || "");
  renderUserBadge();
  closeNamePrompt();
}
function selectUser(name) {
  // Joris slaat de code-stap altijd over: hij is de enige die codes kan
  // beheren, dus hij mag zichzelf nooit kunnen buitensluiten.
  if (!accessGatingActive() || isBootstrapAdminName(name)) {
    unlockUser(name, "");
    return;
  }
  showCodeStep(name);
}
function renderNameList() {
  const wrap = document.getElementById("nameList");
  wrap.innerHTML = "";
  state.team.forEach((name) => {
    const b = document.createElement("button");
    b.className = "name-chip";
    b.textContent = name;
    b.addEventListener("click", () => selectUser(name));
    wrap.appendChild(b);
  });
}

// Controleert of de onthouden sessie (naam + code op dit toestel) nog geldig
// is tegenover de laatst geladen toegangscodes. Wordt aangeroepen zodra de
// codes voor het eerst binnenkomen én telkens als ze live wijzigen — zo werkt
// het intrekken van iemands toegang direct door, zonder dat diegene zelf iets
// hoeft te doen (ook niet herladen).
function validateSession() {
  if (!teamLoadedOnce || !accessCodesLoadedOnce) return;
  if (!accessGatingActive()) return;
  if (!state.user) {
    if (document.getElementById("namePrompt").classList.contains("hidden")) openNamePrompt();
    return;
  }
  // Joris kan nooit worden uitgelogd door de code-check — anders zou hij,
  // als enige beheerder van de codes, zichzelf kunnen opsluiten buiten de
  // app én buiten het beheerscherm dat nodig is om het weer recht te zetten.
  if (isBootstrapAdminName(state.user)) return;
  const savedCode = localStorage.getItem("mep_access_code") || "";
  const real = state.accessCodes[state.user];
  const stillInTeam = state.team.includes(state.user);
  if (!stillInTeam || !real || real !== savedCode) {
    state.user = null;
    localStorage.removeItem("mep_user");
    localStorage.removeItem("mep_access_code");
    renderUserBadge();
    showToast("Je toegang is aangepast — kies opnieuw je naam en voer je (nieuwe) code in.");
    openNamePrompt();
  }
}

// ----------------------------------------------------------------------------
// Rapportage: wie heeft wanneer wat afgevinkt, per week.
// ----------------------------------------------------------------------------
let reportWeekStart = mondayOfWeek(new Date());

function openReport() {
  document.getElementById("reportModal").classList.remove("hidden");
  reportWeekStart = mondayOfWeek(new Date());
  renderReport();
}
function closeReport() {
  document.getElementById("reportModal").classList.add("hidden");
}

async function renderReport() {
  const start = reportWeekStart;
  const end = addDays(start, 6);
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  document.getElementById("reportWeekLabel").textContent = `${shortDutchDate(start)} t/m ${shortDutchDate(end)}`;
  const wrap = document.getElementById("reportTableWrap");
  wrap.innerHTML = `<p class="muted">Laden…</p>`;

  let rows = [];
  try {
    rows = await Store.getDayStatesRange(startKey, endKey);
  } catch (e) {
    wrap.innerHTML = `<p class="muted">Kon de rapportage niet laden.</p>`;
    console.error("Rapportage laden mislukt:", e);
    return;
  }

  const days = Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)));
  const byId = new Map(state.menu.map((m) => [m.id, m]));
  const counts = {}; // naam -> { dateKey: aantal }
  const ensurePerson = (naam) => { if (!counts[naam]) counts[naam] = {}; return counts[naam]; };

  rows.forEach(({ dateKey: dk, data }) => {
    const items = (data && data.items) || {};
    for (const [id, it] of Object.entries(items)) {
      const menuItem = byId.get(id);
      const hasSteps = menuItem && Array.isArray(menuItem.stappen) && menuItem.stappen.length > 0;
      if (hasSteps) {
        const stepsMap = it.steps || {};
        Object.values(stepsMap).forEach((s) => {
          if (s && s.checked && s.door) {
            const p = ensurePerson(s.door);
            p[dk] = (p[dk] || 0) + 1;
          }
        });
      } else if (it.checked && it.paraaf) {
        const p = ensurePerson(it.paraaf);
        p[dk] = (p[dk] || 0) + 1;
      }
    }
  });

  const people = Object.keys(counts).sort((a, b) => a.localeCompare(b, "nl"));
  if (!people.length) {
    wrap.innerHTML = `<p class="muted">Nog geen afgevinkte items deze week.</p>`;
    return;
  }

  let html = `<table class="report-table"><thead><tr><th>Naam</th>`;
  days.forEach((dk) => { html += `<th>${shortDutchDate(parseDateKey(dk))}</th>`; });
  html += `<th>Totaal</th></tr></thead><tbody>`;
  people.forEach((naam) => {
    let total = 0;
    html += `<tr><td class="report-name">${escapeHtml(naam)}</td>`;
    days.forEach((dk) => {
      const n = (counts[naam] && counts[naam][dk]) || 0;
      total += n;
      html += `<td class="${n ? "report-has" : "report-none"}">${n || "–"}</td>`;
    });
    html += `<td class="report-total">${total}</td></tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ----------------------------------------------------------------------------
// Vooruit plannen: alvast een toekomstige datum aan een product koppelen
// (bv. "Zalm" alvast plannen voor donderdag terwijl het nog maandag is). Dit
// staat los van de dagelijkse hoeveelheid/afvinklogica — het is puur een
// melding die op de lijst van vandaag onder het item verschijnt, tot iemand
// het weer verwijdert (zie renderPlanBadges()/planningsForItem() hierboven).
// ----------------------------------------------------------------------------
let planningModalItemId = null;

function openPlanningModal(itemId) {
  planningModalItemId = itemId;
  document.getElementById("planningModal").classList.remove("hidden");
  document.getElementById("planningDateInput").value = "";
  document.getElementById("planningDateInput").min = state.todayKey;
  document.getElementById("planningNoteInput").value = "";
  renderPlanningModal();
}
function closePlanningModal() {
  document.getElementById("planningModal").classList.add("hidden");
  planningModalItemId = null;
}
function renderPlanningModal() {
  if (!planningModalItemId) return;
  const item = state.menu.find((i) => i.id === planningModalItemId);
  document.getElementById("planningItemName").textContent = item ? item.naam : "";
  const list = document.getElementById("planningExistingList");
  const plans = planningsForItem(planningModalItemId);
  if (!plans.length) {
    list.innerHTML = `<p class="muted">Nog niets vooruit gepland voor dit item.</p>`;
    return;
  }
  list.innerHTML = "";
  plans.forEach((p) => {
    const row = document.createElement("div");
    row.className = "planning-existing-row" + (planningIsDue(p) ? " planning-existing-due" : "");
    const label = document.createElement("div");
    label.textContent = planBadgeText(p);
    row.appendChild(label);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn-icon";
    rm.title = "Verwijderen";
    rm.textContent = "✕";
    rm.addEventListener("click", () => Store.removePlanning(p.id));
    row.appendChild(rm);
    list.appendChild(row);
  });
}

// ----------------------------------------------------------------------------
// Instructiekaartje: uitleg + eventueel een foto per product, ingesteld via
// het beheerscherm (zie renderAdmin) en hier alleen ter inzage — puur zodat
// bv. nieuwe of invallende collega's precies kunnen zien hoe iets gemaakt
// moet worden, zonder dat het de gewone lijst drukker maakt (het ℹ️-knopje
// verschijnt alleen als er ook echt iets is ingevuld, zie renderItemRow).
// ----------------------------------------------------------------------------
function openInstructionModal(itemId) {
  const item = state.menu.find((i) => i.id === itemId);
  if (!item) return;
  document.getElementById("instructionItemName").textContent = item.naam;
  const photo = document.getElementById("instructionPhoto");
  if (item.instructieFoto) {
    photo.src = item.instructieFoto;
    photo.classList.remove("hidden");
  } else {
    photo.removeAttribute("src");
    photo.classList.add("hidden");
  }
  const textEl = document.getElementById("instructionText");
  textEl.textContent = item.instructieTekst || "";
  textEl.classList.toggle("hidden", !item.instructieTekst);
  document.getElementById("instructionModal").classList.remove("hidden");
}
function closeInstructionModal() {
  document.getElementById("instructionModal").classList.add("hidden");
}

// Verkleint/comprimeert een gekozen foto client-side (canvas) tot maximaal
// 640px breed/hoog als JPEG — ruim voldoende leesbaar op een telefoon- of
// tabletscherm, en klein genoeg om zonder problemen in het product-document
// te passen (Firestore-documenten mogen max. 1MB zijn; dit blijft daar met
// flinke marge onder, ook met wat tekst erbij).
function compressImageForInstruction(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Kon de afbeelding niet lezen."));
      img.onload = () => {
        const maxDim = 640;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.62));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ----------------------------------------------------------------------------
// Melding bij lang blijven liggen: als een product 2+ dagen op rij blijft
// liggen (zelfde drempel als de "blijft liggen"-badge/kaart, zie
// STALE_CARRY_DAYS en staleItemsToday), stuurt de app automatisch een
// berichtje. Dit loopt bewust volledig client-side, via twee onafhankelijke
// kanalen die allebei los aan/uit staan (zie het beheerscherm): WhatsApp via
// de gratis dienst CallMeBot, en/of een eigen gratis Telegram-bot (via
// @BotFather). Geen backend nodig voor beide. CallMeBot is een gratis
// eenmansdienst die soms van nummer wisselt of accounts pauzeert, en geeft
// sowieso nooit een echt bruikbaar antwoord terug (zie sendWhatsappMessage) —
// Telegram's eigen API doet dat wel, dus staat Telegram er sindsdien naast
// als betrouwbaarder kanaal. Bij elk item onthouden we (in het dagdocument
// zelf, dus zichtbaar voor alle toestellen) of de melding al is verstuurd,
// zodat hetzelfde probleem niet steeds opnieuw berichtjes stuurt.
// ----------------------------------------------------------------------------
function sendTelegramMessage(text) {
  const { botToken, chatId } = state.telegram;
  // Let op: het bot-token NIET door encodeURIComponent halen — dat zet de
  // dubbele punt erin om naar %3A, wat Telegram's eigen documentatie nooit
  // zo laat zien en onnodig is (":" mag gewoon onversleuteld in een
  // URL-padsegment staan).
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.description) || `Telegram-verzoek mislukt (${res.status})`);
    }
    return data;
  });
}

// WhatsApp via CallMeBot: gratis, geen backend nodig, maar het endpoint geeft
// geen CORS-headers terug — de fetch hieronder moet dus met mode:"no-cors",
// wat betekent dat we NOOIT kunnen zien of een bericht ook echt is
// aangekomen (een "geslaagde" fetch zegt alleen dat het verzoek de deur uit
// is, niet dat CallMeBot het heeft verwerkt of dat het is afgeleverd). Dat is
// precies waarom Telegram hierboven als betrouwbaarder tweede kanaal bestaat.
function sendWhatsappMessage(text) {
  const { phone, apikey } = state.whatsapp;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  return fetch(url, { mode: "no-cors" });
}

function alertChannelsEnabled() {
  const w = state.whatsapp || {};
  const t = state.telegram || {};
  return !!(w.enabled && w.phone && w.apikey) || !!(t.enabled && t.botToken && t.chatId);
}

// Verstuurt hetzelfde berichtje naar elk kanaal dat op dit moment aanstaat.
// Geeft true terug zodra minstens één kanaal is gelukt (dat telt als
// "verstuurd") — WhatsApp/CallMeBot kan hierboven sowieso nooit een échte
// fout teruggeven, dus in de praktijk kan alleen Telegram deze functie op
// false laten uitkomen (bv. verkeerd token of geen internet).
async function sendAlertToAllChannels(text) {
  const w = state.whatsapp || {};
  const t = state.telegram || {};
  let attempted = false;
  let succeeded = false;
  if (w.enabled && w.phone && w.apikey) {
    attempted = true;
    try {
      await sendWhatsappMessage(text);
      succeeded = true;
    } catch (e) {
      console.warn("WhatsApp-melding versturen mislukt:", e);
    }
  }
  if (t.enabled && t.botToken && t.chatId) {
    attempted = true;
    try {
      await sendTelegramMessage(text);
      succeeded = true;
    } catch (e) {
      console.warn("Telegram-melding versturen mislukt:", e);
    }
  }
  return attempted && succeeded;
}

async function checkCarryAlerts() {
  if (!alertChannelsEnabled()) return;
  const stale = staleItemsToday();
  for (const { item, st, daysOpen } of stale) {
    if (st.staleAlertSentAt) continue;
    const text = `⚠️ Loop${zaakLabel()}: "${item.naam}" staat al ${daysOpen} dagen open en is nog steeds niet afgerond.`;
    const ok = await sendAlertToAllChannels(text);
    if (ok) {
      await Store.setItemField(state.todayKey, item.id, { staleAlertSentAt: Date.now() });
    } else {
      break; // geen enkel kanaal is gelukt (waarschijnlijk geen internet) — de rest wachten we ook nog even mee
    }
  }
}

// Los inkoopsignaal (zie het "🔔"-vinkje in het beheerscherm bij een product):
// zodra de lijst voor morgen wordt goedgekeurd, appt dit meteen welke van de
// aangevinkte "bijna op"-achtige producten dat zijn — zodat je de volgende
// ochtend gelijk kunt inkopen i.p.v. het pas te zien als je zelf weer in de
// app kijkt. Loopt bewust mee met het bestaande goedkeur-moment (geen losse
// achtergrondcontrole nodig).
function checkApprovalAlerts() {
  if (!alertChannelsEnabled()) return;
  const day = state.dayTomorrow;
  // Er is geen apart "klaar"-vinkje op de lijst voor morgen (die kolom bestaat
  // alleen op "Vandaag") — hier telt als "aangevinkt" dat er voor morgen echt
  // een hoeveelheid is ingevuld, dat is hoe iets bewust op de lijst voor
  // morgen wordt gezet.
  const flagged = state.menu.filter((m) => {
    if (!m.waarschuwBijGoedkeuring) return false;
    const st = day.items && day.items[m.id];
    return !!(st && st.hoeveelheid && st.hoeveelheid.trim());
  });
  if (!flagged.length) return;
  const namen = flagged.map((m) => `"${m.naam}"`).join(", ");
  const text = flagged.length === 1
    ? `📋 Loop${zaakLabel()}: lijst voor morgen is goedgekeurd. Let op: ${namen} staat op de lijst voor morgen — denk eraan dit morgenochtend te halen!`
    : `📋 Loop${zaakLabel()}: lijst voor morgen is goedgekeurd. Let op, deze staan op de lijst voor morgen: ${namen} — denk eraan dit morgenochtend te halen!`;
  sendAlertToAllChannels(text);
}

// Rendert de instellingen-sectie in het beheerscherm (alleen zichtbaar/
// bewerkbaar voor Joris of een aangewezen beheerder — zelfde bevoegdheid als
// team/toegangscodes beheren). Wordt zowel vanuit renderAdmin() als vanuit de
// live Store.onTelegramSettings-subscriptie aangeroepen, dus altijd actueel
// zonder dat je het beheerscherm opnieuw hoeft te openen.
function renderTelegramAdminSection() {
  const note = document.getElementById("telegramAdminNote");
  const fields = document.getElementById("telegramAdminFields");
  if (!note || !fields) return;
  const canManage = isCurrentUserAdmin();
  note.classList.toggle("hidden", canManage);
  fields.classList.toggle("hidden", !canManage);
  if (!canManage) return;
  const tokenInput = document.getElementById("telegramBotTokenInput");
  const chatIdInput = document.getElementById("telegramChatIdInput");
  const enabledInput = document.getElementById("telegramEnabledInput");
  const t = state.telegram || { enabled: false, botToken: "", chatId: "" };
  if (document.activeElement !== tokenInput) tokenInput.value = t.botToken || "";
  if (document.activeElement !== chatIdInput) chatIdInput.value = t.chatId || "";
  enabledInput.checked = !!t.enabled;
}

// Zelfde idee als renderTelegramAdminSection, maar dan voor het WhatsApp/
// CallMeBot-kanaal — allebei onafhankelijk van elkaar in te stellen.
function renderWhatsappAdminSection() {
  const note = document.getElementById("whatsappAdminNote");
  const fields = document.getElementById("whatsappAdminFields");
  if (!note || !fields) return;
  const canManage = isCurrentUserAdmin();
  note.classList.toggle("hidden", canManage);
  fields.classList.toggle("hidden", !canManage);
  if (!canManage) return;
  const phoneInput = document.getElementById("whatsappPhoneInput");
  const apikeyInput = document.getElementById("whatsappApikeyInput");
  const enabledInput = document.getElementById("whatsappEnabledInput");
  const w = state.whatsapp || { enabled: false, phone: "", apikey: "" };
  if (document.activeElement !== phoneInput) phoneInput.value = w.phone || "";
  if (document.activeElement !== apikeyInput) apikeyInput.value = w.apikey || "";
  enabledInput.checked = !!w.enabled;
}

// ----------------------------------------------------------------------------
// Beheerscherm
// ----------------------------------------------------------------------------
function openAdmin() {
  document.getElementById("adminModal").classList.remove("hidden");
  renderAdmin();
}
function closeAdmin() {
  document.getElementById("adminModal").classList.add("hidden");
}
// Welk item/categorie er op dit moment in het beheerscherm wordt bewerkt
// (inline formulier open) — zodat een live update van elders dat formulier
// niet dichtklapt.
let adminEditingItemId = null;
let adminEditingCatId = null;

function moveCategory(catId, direction) {
  const cats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = cats.findIndex((c) => c.id === catId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= cats.length) return;
  const a = cats[idx], b = cats[swapIdx];
  const aOrder = a.order || 0, bOrder = b.order || 0;
  Store.updateCategory(a.id, { order: bOrder });
  Store.updateCategory(b.id, { order: aOrder });
}

// Zelfde idee als moveCategory, maar dan binnen één categorie: verwisselt
// simpelweg de order-waarde met de buur erboven/onder in dezelfde categorie.
function moveItem(itemId, direction) {
  const item = state.menu.find((i) => i.id === itemId);
  if (!item) return;
  const siblings = itemsByCategory(item.categorie);
  const idx = siblings.findIndex((i) => i.id === itemId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
  const a = siblings[idx], b = siblings[swapIdx];
  const aOrder = a.order || 0, bOrder = b.order || 0;
  Store.updateItem(a.id, { order: bOrder });
  Store.updateItem(b.id, { order: aOrder });
}

// ----------------------------------------------------------------------------
// Beheerscherm — sectie "Apparaten" (zie deviceAccessOk()/updateDeviceGate()
// hierboven voor de gating zelf).
// ----------------------------------------------------------------------------
function renderAdminDevices() {
  const canManage = isCurrentUserAdmin();
  document.getElementById("deviceAdminNote").classList.toggle("hidden", canManage);
  document.getElementById("deviceAdminFields").classList.toggle("hidden", !canManage);
  if (!canManage) return;

  // Het toestel van waaruit nu beheerd wordt, is altijd zelf al goedgekeurd
  // — anders zou Joris zichzelf kunnen buitensluiten op het moment dat hij
  // hier voor het eerst een goedkeuringscode genereert. We zetten dit ook
  // meteen lokaal in state (niet pas na de rondgang via Store/Firestore),
  // zodat er geen kortstondig gat kan ontstaan.
  const thisId = getDeviceId();
  state.devices.approved = state.devices.approved || {};
  if (!state.devices.approved[thisId]) {
    state.devices.approved = { ...state.devices.approved, [thisId]: { label: "Dit toestel (beheerder)", approvedAt: Date.now() } };
    Store.approveDevice(thisId, "Dit toestel (beheerder)");
  }

  const codeBox = document.getElementById("deviceCodeBox");
  codeBox.innerHTML = "";
  const pending = state.devices.pendingCode;
  const stillValid = !!pending && (Date.now() - pending.createdAt) < DEVICE_CODE_TTL_MS;
  if (stillValid) {
    const box = document.createElement("div");
    box.className = "device-code-active";
    const codeEl = document.createElement("div");
    codeEl.className = "device-code-value";
    codeEl.textContent = pending.code;
    box.appendChild(codeEl);
    const mins = Math.max(1, Math.round((DEVICE_CODE_TTL_MS - (Date.now() - pending.createdAt)) / 60000));
    const info = document.createElement("p");
    info.className = "muted admin-note";
    info.textContent = `Geef deze code door aan het nieuwe toestel — nog ongeveer ${mins} min geldig. Zodra 'm daar wordt ingevoerd, wordt dat toestel automatisch goedgekeurd.`;
    box.appendChild(info);
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Code intrekken";
    cancelBtn.addEventListener("click", () => Store.clearDeviceCode());
    box.appendChild(cancelBtn);
    codeBox.appendChild(box);
  } else {
    const genBtn = document.createElement("button");
    genBtn.type = "button";
    genBtn.className = "btn btn-secondary";
    genBtn.textContent = "Nieuwe goedkeuringscode genereren";
    genBtn.addEventListener("click", () => Store.generateDeviceCode());
    codeBox.appendChild(genBtn);
  }

  const listWrap = document.getElementById("deviceApprovedList");
  listWrap.innerHTML = "";
  const approved = state.devices.approved || {};
  const ids = Object.keys(approved).sort((a, b) => (approved[a].approvedAt || 0) - (approved[b].approvedAt || 0));
  document.getElementById("deviceEmptyNote").classList.toggle("hidden", ids.length > 0);
  ids.forEach((id) => {
    const info = approved[id];
    const chip = document.createElement("div");
    chip.className = "chip chip-team";
    const label = document.createElement("span");
    label.textContent = info.label || "Onbekend toestel";
    chip.appendChild(label);
    if (info.approvedAt) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "device-approved-date";
      dateSpan.textContent = shortDutchDate(new Date(info.approvedAt));
      chip.appendChild(dateSpan);
    }
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Toegang intrekken";
    del.addEventListener("click", () => Store.revokeDevice(id));
    chip.appendChild(del);
    listWrap.appendChild(chip);
  });
}

function renderAdmin() {
  renderZaakAdminSection();
  renderTelegramAdminSection();
  renderWhatsappAdminSection();
  renderAdminDevices();
  const teamWrap = document.getElementById("teamManageList");
  teamWrap.innerHTML = "";
  const canManageAccess = isCurrentUserAdmin();
  document.getElementById("teamAdminNote").classList.toggle("hidden", canManageAccess);
  state.team.forEach((name) => {
    const chip = document.createElement("div");
    chip.className = "chip chip-team";
    const label = document.createElement("span");
    label.textContent = name;
    chip.appendChild(label);

    if (canManageAccess) {
      const codeInput = document.createElement("input");
      codeInput.type = "text";
      codeInput.className = "team-code-input";
      codeInput.placeholder = "geen code";
      codeInput.maxLength = 12;
      codeInput.value = (state.accessCodes && state.accessCodes[name]) || "";
      codeInput.title = "Toegangscode voor " + name;
      codeInput.addEventListener("change", () => Store.setAccessCode(name, codeInput.value));
      chip.appendChild(codeInput);

      const genBtn = document.createElement("button");
      genBtn.type = "button";
      genBtn.className = "code-gen-btn";
      genBtn.title = "Genereer willekeurige code";
      genBtn.textContent = "🎲";
      genBtn.addEventListener("click", () => {
        const rnd = String(Math.floor(1000 + Math.random() * 9000));
        codeInput.value = rnd;
        Store.setAccessCode(name, rnd);
      });
      chip.appendChild(genBtn);

      const adminLabel = document.createElement("label");
      adminLabel.className = "admin-toggle";
      adminLabel.title = "Mag zelf ook toegangscodes beheren";
      const adminCb = document.createElement("input");
      adminCb.type = "checkbox";
      adminCb.checked = (state.admins || []).includes(name);
      adminCb.disabled = name.trim().toLowerCase() === "joris";
      adminCb.addEventListener("change", () => Store.setAdminFlag(name, adminCb.checked));
      adminLabel.appendChild(adminCb);
      adminLabel.appendChild(document.createTextNode("★"));
      chip.appendChild(adminLabel);

      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Verwijderen uit team";
      del.addEventListener("click", () => Store.removeTeamMember(name));
      chip.appendChild(del);
    }
    teamWrap.appendChild(chip);
  });
  document.getElementById("addTeamForm").classList.toggle("hidden", !canManageAccess);

  const canEditContent = isContentEditor();
  document.getElementById("catAdminNote").classList.toggle("hidden", canEditContent);
  document.getElementById("addCategoryForm").classList.toggle("hidden", !canEditContent);

  const catsWrap = document.getElementById("adminCategories");
  catsWrap.innerHTML = "";
  const cats = [...state.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
  cats.forEach((cat, catIdx) => {
    const block = document.createElement("div");
    block.className = "admin-cat-block";

    if (adminEditingCatId === cat.id && canEditContent) {
      // ---- Categorie: bewerkmodus (naam + kleur) ----
      const editWrap = document.createElement("div");
      editWrap.className = "admin-edit-form";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = cat.naam;
      editWrap.appendChild(nameInput);

      const swatches = document.createElement("div");
      swatches.className = "swatch-row";
      CATEGORY_PALETTE.forEach((hex) => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "swatch" + (hex.toLowerCase() === (cat.kleur || "").toLowerCase() ? " selected" : "");
        sw.style.background = hex;
        sw.addEventListener("click", () => {
          swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
          sw.classList.add("selected");
          sw.dataset.chosen = "1";
        });
        swatches.appendChild(sw);
      });
      editWrap.appendChild(swatches);

      const btnRow = document.createElement("div");
      btnRow.className = "admin-edit-buttons";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = "Opslaan";
      saveBtn.addEventListener("click", () => {
        const naam = nameInput.value.trim();
        const chosen = swatches.querySelector(".swatch.selected");
        const kleur = chosen ? chosen.style.background : cat.kleur;
        if (naam) Store.updateCategory(cat.id, { naam, kleur: rgbToHex(kleur) || kleur });
        adminEditingCatId = null;
        renderAdmin();
      });
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-secondary";
      cancelBtn.textContent = "Annuleren";
      cancelBtn.addEventListener("click", () => { adminEditingCatId = null; renderAdmin(); });
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      editWrap.appendChild(btnRow);
      block.appendChild(editWrap);
    } else {
      const titleRow = document.createElement("div");
      titleRow.className = "admin-cat-title-row";
      const swatchDot = document.createElement("span");
      swatchDot.className = "swatch-dot";
      swatchDot.style.background = cat.kleur || "#42220F";
      titleRow.appendChild(swatchDot);
      const title = document.createElement("div");
      title.className = "admin-cat-title";
      title.textContent = cat.naam;
      titleRow.appendChild(title);

      if (canEditContent) {
        const upBtn = document.createElement("button");
        upBtn.className = "admin-mini-btn";
        upBtn.title = "Omhoog";
        upBtn.textContent = "▲";
        upBtn.disabled = catIdx === 0;
        upBtn.addEventListener("click", () => moveCategory(cat.id, -1));
        titleRow.appendChild(upBtn);

        const downBtn = document.createElement("button");
        downBtn.className = "admin-mini-btn";
        downBtn.title = "Omlaag";
        downBtn.textContent = "▼";
        downBtn.disabled = catIdx === cats.length - 1;
        downBtn.addEventListener("click", () => moveCategory(cat.id, 1));
        titleRow.appendChild(downBtn);

        const editCatBtn = document.createElement("button");
        editCatBtn.className = "admin-mini-btn";
        editCatBtn.title = "Hernoemen / kleur";
        editCatBtn.textContent = "✎";
        editCatBtn.addEventListener("click", () => { adminEditingCatId = cat.id; renderAdmin(); });
        titleRow.appendChild(editCatBtn);
      }

      block.appendChild(titleRow);
    }

    itemsByCategory(cat.id).forEach((item, itemIdx, siblings) => {
      if (adminEditingItemId === item.id && canEditContent) {
        // ---- Product: bewerkmodus (naam + stappen) ----
        const editWrap = document.createElement("div");
        editWrap.className = "admin-edit-form";
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = item.naam;
        editWrap.appendChild(nameInput);

        const stepsLabel = document.createElement("div");
        stepsLabel.className = "admin-steps-label";
        stepsLabel.textContent = "Stappen (optioneel — één per regel, leeg = gewoon één vinkje)";
        editWrap.appendChild(stepsLabel);

        const stepsArea = document.createElement("textarea");
        stepsArea.rows = 4;
        stepsArea.placeholder = "bv.\nGroente snijden\nZuur laten trekken\nOp smaak maken\nAfgekoeld / klaar";
        stepsArea.value = (item.stappen || []).join("\n");
        editWrap.appendChild(stepsArea);

        // ---- Instructiekaartje: korte uitleg + eventueel een foto, alleen
        // ter inzage voor het team (zie openInstructionModal). Een nieuwe
        // foto wordt meteen client-side verkleind/gecomprimeerd, zodat het
        // opgeslagen product-document klein en snel blijft.
        const instrLabel = document.createElement("div");
        instrLabel.className = "admin-steps-label";
        instrLabel.textContent = "Instructiekaartje (optioneel — korte uitleg + eventueel een foto)";
        editWrap.appendChild(instrLabel);

        const instrArea = document.createElement("textarea");
        instrArea.rows = 3;
        instrArea.placeholder = "bv. Snijden in blokjes van 1cm, op smaak brengen met citroen en peterselie…";
        instrArea.value = item.instructieTekst || "";
        editWrap.appendChild(instrArea);

        // pendingPhoto: undefined = niet aangeraakt (bij Opslaan blijft de
        // bestaande foto gewoon staan), "" = bewust verwijderd, anders de
        // nieuwe (al gecomprimeerde) foto als data-URL.
        let pendingPhoto;
        const photoRow = document.createElement("div");
        photoRow.className = "admin-photo-row";
        const photoPreview = document.createElement("img");
        photoPreview.className = "admin-photo-preview" + (item.instructieFoto ? "" : " hidden");
        if (item.instructieFoto) photoPreview.src = item.instructieFoto;
        photoRow.appendChild(photoPreview);
        const photoInput = document.createElement("input");
        photoInput.type = "file";
        photoInput.accept = "image/*";
        photoInput.addEventListener("change", async () => {
          const file = photoInput.files && photoInput.files[0];
          if (!file) return;
          try {
            pendingPhoto = await compressImageForInstruction(file);
            photoPreview.src = pendingPhoto;
            photoPreview.classList.remove("hidden");
          } catch (e) {
            console.error("Foto comprimeren mislukt:", e);
            showToast("Kon deze foto niet gebruiken, probeer een andere.");
          }
        });
        photoRow.appendChild(photoInput);
        const photoRemoveBtn = document.createElement("button");
        photoRemoveBtn.type = "button";
        photoRemoveBtn.className = "admin-photo-remove";
        photoRemoveBtn.textContent = "🗑 Foto verwijderen";
        photoRemoveBtn.classList.toggle("hidden", !item.instructieFoto && !pendingPhoto);
        photoRemoveBtn.addEventListener("click", () => {
          pendingPhoto = "";
          photoInput.value = "";
          photoPreview.removeAttribute("src");
          photoPreview.classList.add("hidden");
          photoRemoveBtn.classList.add("hidden");
        });
        photoRow.appendChild(photoRemoveBtn);
        editWrap.appendChild(photoRow);

        // Los "inkoopsignaal": voor producten als "bijna op" wil je vaak
        // meteen weten of het is aangevinkt op de lijst van morgen, zodra die
        // wordt goedgekeurd — bv. om de volgende ochtend gelijk in te kopen.
        // Bewust gekoppeld aan het bestaande goedkeur-moment (geen nieuwe
        // achtergrondcontrole nodig) en aan dezelfde WhatsApp/Telegram-kanalen
        // als de "blijft liggen"-melding hierboven.
        const alertLabel = document.createElement("label");
        alertLabel.className = "admin-checkbox-label";
        const alertCb = document.createElement("input");
        alertCb.type = "checkbox";
        alertCb.checked = !!item.waarschuwBijGoedkeuring;
        alertLabel.appendChild(alertCb);
        const alertText = document.createElement("span");
        alertText.textContent =
          "🔔 Stuur een bericht (WhatsApp/Telegram) als hier een hoeveelheid voor morgen is ingevuld en de lijst wordt goedgekeurd (bv. voor \"bijna op\"-signalen)";
        alertLabel.appendChild(alertText);
        editWrap.appendChild(alertLabel);

        // Sommige producten zijn eigenlijk gewoon een taak (bv. "Frituur
        // links verschonen") in plaats van iets dat je in een hoeveelheid
        // maakt — die hebben dan geen hoev.-pulldown nodig en zijn meteen
        // afvinkbaar, elke dag opnieuw totdat 'm is afgevinkt.
        const taskLabel = document.createElement("label");
        taskLabel.className = "admin-checkbox-label";
        const taskCb = document.createElement("input");
        taskCb.type = "checkbox";
        taskCb.checked = !!item.geenHoeveelheid;
        taskLabel.appendChild(taskCb);
        const taskText = document.createElement("span");
        taskText.textContent =
          "🧹 Dit is gewoon een taak (bv. \"Frituur links verschonen\") — geen hoeveelheid nodig, alleen afvinken";
        taskLabel.appendChild(taskText);
        editWrap.appendChild(taskLabel);

        const btnRow = document.createElement("div");
        btnRow.className = "admin-edit-buttons";
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn btn-primary";
        saveBtn.textContent = "Opslaan";
        saveBtn.addEventListener("click", () => {
          const naam = nameInput.value.trim();
          const stappen = stepsArea.value.split("\n").map((s) => s.trim()).filter(Boolean);
          const patch = { instructieTekst: instrArea.value.trim(), waarschuwBijGoedkeuring: alertCb.checked, geenHoeveelheid: taskCb.checked };
          if (pendingPhoto !== undefined) patch.instructieFoto = pendingPhoto;
          if (naam) Store.updateItem(item.id, { naam, stappen, ...patch });
          adminEditingItemId = null;
          renderAdmin();
        });
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.textContent = "Annuleren";
        cancelBtn.addEventListener("click", () => { adminEditingItemId = null; renderAdmin(); });
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        editWrap.appendChild(btnRow);
        block.appendChild(editWrap);
      } else {
        const row = document.createElement("div");
        row.className = "admin-item-row";
        const label = document.createElement("span");
        label.textContent = item.naam
          + (item.stappen && item.stappen.length ? ` (${item.stappen.length} stappen)` : "")
          + (item.geenHoeveelheid ? " (taak)" : "");
        row.appendChild(label);

        if (canEditContent) {
          const btns = document.createElement("div");
          btns.className = "admin-item-buttons";
          const upBtn = document.createElement("button");
          upBtn.className = "admin-mini-btn";
          upBtn.title = "Omhoog";
          upBtn.textContent = "▲";
          upBtn.disabled = itemIdx === 0;
          upBtn.addEventListener("click", () => moveItem(item.id, -1));
          btns.appendChild(upBtn);

          const downBtn = document.createElement("button");
          downBtn.className = "admin-mini-btn";
          downBtn.title = "Omlaag";
          downBtn.textContent = "▼";
          downBtn.disabled = itemIdx === siblings.length - 1;
          downBtn.addEventListener("click", () => moveItem(item.id, 1));
          btns.appendChild(downBtn);

          const editBtn = document.createElement("button");
          editBtn.textContent = "✎";
          editBtn.title = "Bewerken";
          editBtn.addEventListener("click", () => { adminEditingItemId = item.id; renderAdmin(); });
          btns.appendChild(editBtn);
          const del = document.createElement("button");
          del.textContent = "✕";
          del.title = "Verwijderen";
          del.addEventListener("click", () => {
            if (confirm(`"${item.naam}" verwijderen van de lijst?`)) Store.removeItem(item.id);
          });
          btns.appendChild(del);
          row.appendChild(btns);
        }
        block.appendChild(row);
      }
    });

    if (canEditContent) {
      const form = document.createElement("form");
      form.className = "admin-add-item-form";
      form.innerHTML = `<input type="text" placeholder="Nieuw product…" /><button type="submit">+ Toevoegen</button>`;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = form.querySelector("input");
        const naam = input.value.trim();
        if (naam) { Store.addItem({ categorie: cat.id, naam }); input.value = ""; }
      });
      block.appendChild(form);
    }

    catsWrap.appendChild(block);
  });
}

// Zet een berekende rgb(...)-stijl (uit swatch.style.background) om naar hex,
// zodat we consistent hex-strings opslaan net als de rest van de app.
function rgbToHex(rgbStr) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbStr || "");
  if (!m) return null;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

// ----------------------------------------------------------------------------
// Printen: alleen de lijst van "Vandaag", en alleen items die er echt toe
// doen (al iets ingevuld/afgevinkt) — voor een compact, inktvriendelijk
// werkblaadje i.p.v. de volledige catalogus.
// ----------------------------------------------------------------------------
function applyPrintFilter() {
  const day = state.dayToday;
  for (const [itemId, refs] of rowRefs) {
    if (refs.mode !== "today") continue;
    const st = day.items[itemId] || {};
    const relevant = itemIsDone(refs.menuItem, st) || itemIsOpen(refs.menuItem, st);
    refs.row.classList.toggle("print-hide", !relevant);
    if (refs.stepsPanel) refs.stepsPanel.classList.toggle("print-hide", !relevant);
  }
  document.querySelectorAll(".cat-card").forEach((card) => {
    const anyVisible = card.querySelectorAll(".row-cols.item-row:not(.print-hide)").length > 0;
    card.classList.toggle("print-hide", !anyVisible);
  });
}
function clearPrintFilter() {
  document.querySelectorAll(".print-hide").forEach((el) => el.classList.remove("print-hide"));
}

// ----------------------------------------------------------------------------
// Event wiring
// ----------------------------------------------------------------------------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function wireEvents() {
  // Activiteit bijhouden voor de inactiviteit-uitlog (zie checkIdleLogout) —
  // elke klik, tik of toetsaanslag ergens in de app telt als "nog actief".
  document.addEventListener("click", markActivity, { passive: true });
  document.addEventListener("touchstart", markActivity, { passive: true });
  document.addEventListener("keydown", markActivity);
  document.addEventListener("input", markActivity, { passive: true });

  document.getElementById("userBadge").addEventListener("click", openNamePrompt);
  document.getElementById("printList").addEventListener("click", () => {
    if (state.activeTab !== "today" || state.dashboardActive) switchTab("today");
    window.print();
  });
  document.getElementById("openAdmin").addEventListener("click", openAdmin);
  document.getElementById("themeToggle").addEventListener("click", switchTheme);
  applyThemeButtonLabel();
  document.getElementById("closeAdmin").addEventListener("click", closeAdmin);
  document.getElementById("adminModal").addEventListener("click", (e) => {
    if (e.target.id === "adminModal") closeAdmin();
  });
  document.getElementById("namePrompt").addEventListener("click", (e) => {
    if (e.target.id === "namePrompt" && state.user) closeNamePrompt();
  });

  document.getElementById("deviceGateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const codeInput = document.getElementById("deviceGateCode");
    const labelInput = document.getElementById("deviceGateLabel");
    const errEl = document.getElementById("deviceGateError");
    const entered = (codeInput.value || "").trim().toUpperCase();
    const pending = state.devices.pendingCode;
    const stillValid = !!pending && (Date.now() - pending.createdAt) < DEVICE_CODE_TTL_MS;
    if (!entered || !stillValid || entered !== pending.code) {
      errEl.textContent = "Onjuiste of verlopen code — vraag een nieuwe aan Joris.";
      errEl.classList.remove("hidden");
      return;
    }
    errEl.classList.add("hidden");
    const label = (labelInput.value || "").trim() || "Nieuw toestel";
    Store.approveDevice(getDeviceId(), label);
    Store.clearDeviceCode();
  });
  document.getElementById("deviceGateBootstrap").addEventListener("click", () => {
    document.getElementById("deviceGateBootstrapForm").classList.remove("hidden");
    document.getElementById("deviceGateBootstrap").classList.add("hidden");
    document.getElementById("deviceGateBootstrapInput").focus();
  });
  document.getElementById("deviceGateBootstrapForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("deviceGateBootstrapInput");
    const errEl = document.getElementById("deviceGateError");
    const name = (nameInput.value || "").trim();
    if (!isBootstrapAdminName(name)) {
      errEl.textContent = "Die naam wordt hier niet als beheerder herkend.";
      errEl.classList.remove("hidden");
      return;
    }
    errEl.classList.add("hidden");
    Store.approveDevice(getDeviceId(), "Joris (automatisch via naam)");
  });

  document.getElementById("tabToday").addEventListener("click", () => switchTab("today"));
  document.getElementById("tabTomorrow").addEventListener("click", () => switchTab("tomorrow"));
  document.getElementById("tabDashboard").addEventListener("click", openDashboard);
  document.getElementById("approveBtn").addEventListener("click", approveDay);

  document.getElementById("filterActiveBtn").addEventListener("click", () => {
    if (state.todayFilterMode === "active") return;
    state.todayFilterMode = "active";
    render(true);
  });
  document.getElementById("filterAllBtn").addEventListener("click", () => {
    if (state.todayFilterMode === "all") return;
    state.todayFilterMode = "all";
    render(true);
  });

  document.getElementById("dashViewDayBtn").addEventListener("click", () => switchDashboardView("day"));
  document.getElementById("dashViewMonthBtn").addEventListener("click", () => switchDashboardView("month"));

  document.getElementById("openReport").addEventListener("click", openReport);
  document.getElementById("closeReport").addEventListener("click", closeReport);
  document.getElementById("reportModal").addEventListener("click", (e) => {
    if (e.target.id === "reportModal") closeReport();
  });
  document.getElementById("reportPrevWeek").addEventListener("click", () => { reportWeekStart = addDays(reportWeekStart, -7); renderReport(); });
  document.getElementById("reportNextWeek").addEventListener("click", () => { reportWeekStart = addDays(reportWeekStart, 7); renderReport(); });
  document.getElementById("reportThisWeek").addEventListener("click", () => { reportWeekStart = mondayOfWeek(new Date()); renderReport(); });

  document.getElementById("closePlanning").addEventListener("click", closePlanningModal);
  document.getElementById("planningModal").addEventListener("click", (e) => {
    if (e.target.id === "planningModal") closePlanningModal();
  });
  document.getElementById("planningForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!planningModalItemId) return;
    const dateInput = document.getElementById("planningDateInput");
    const noteInput = document.getElementById("planningNoteInput");
    if (!dateInput.value) return;
    const targetDateKey = dateInput.value;
    Store.addPlanning({ itemId: planningModalItemId, targetDateKey, note: noteInput.value, createdBy: state.user || "" });
    dateInput.value = "";
    noteInput.value = "";
    // Staat altijd meteen als melding op de lijst van vandaag (zie
    // renderPlanBadges) — zo kan het alvast opgepakt worden als er toevallig
    // tijd en ingrediënten voor zijn — én bij "Vooruit gepland" op het
    // dashboard. Alleen de kleur/urgentie van de melding verschilt naargelang
    // de datum al is aangebroken of niet.
    if (targetDateKey <= state.todayKey) {
      showToast("Ingepland — dit staat als (dringende) melding op de lijst van vandaag.");
    } else {
      showToast("Ingepland — staat als melding op de lijst van vandaag (mag alvast opgepakt worden) en bij \"Vooruit gepland\" op het dashboard.");
    }
  });

  document.getElementById("closeInstruction").addEventListener("click", closeInstructionModal);
  document.getElementById("instructionModal").addEventListener("click", (e) => {
    if (e.target.id === "instructionModal") closeInstructionModal();
  });

  document.getElementById("telegramSettingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const botToken = document.getElementById("telegramBotTokenInput").value.trim();
    const chatId = document.getElementById("telegramChatIdInput").value.trim();
    const enabled = document.getElementById("telegramEnabledInput").checked;
    Store.setTelegramSettings({ botToken, chatId, enabled });
    showToast("Telegram-instellingen opgeslagen.");
  });
  document.getElementById("telegramTestBtn").addEventListener("click", async () => {
    const botToken = document.getElementById("telegramBotTokenInput").value.trim();
    const chatId = document.getElementById("telegramChatIdInput").value.trim();
    if (!botToken || !chatId) {
      showToast("Vul eerst een bot-token en chat-ID in.");
      return;
    }
    state.telegram = { ...state.telegram, botToken, chatId };
    try {
      await sendTelegramMessage("👋 Testbericht vanuit de MEP-lijst app — als je dit ontvangt, werkt het!");
      showToast("Testbericht verstuurd — check je Telegram.");
    } catch (e) {
      console.error("Testbericht versturen mislukt:", e);
      // Telegram geeft (anders dan CallMeBot) een echte foutmelding terug,
      // bv. "chat not found" of "Unauthorized" bij een verkeerd token/chat-ID
      // — die tonen we direct, dat scheelt een hoop giswerk.
      showToast("Versturen mislukt: " + (e.message || "controleer je bot-token en chat-ID."), 6000);
    }
  });

  document.getElementById("whatsappSettingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const phone = document.getElementById("whatsappPhoneInput").value.trim();
    const apikey = document.getElementById("whatsappApikeyInput").value.trim();
    const enabled = document.getElementById("whatsappEnabledInput").checked;
    Store.setWhatsappSettings({ phone, apikey, enabled });
    showToast("WhatsApp-instellingen opgeslagen.");
  });
  document.getElementById("whatsappTestBtn").addEventListener("click", async () => {
    const phone = document.getElementById("whatsappPhoneInput").value.trim();
    const apikey = document.getElementById("whatsappApikeyInput").value.trim();
    if (!phone || !apikey) {
      showToast("Vul eerst een telefoonnummer en apikey in.");
      return;
    }
    state.whatsapp = { ...state.whatsapp, phone, apikey };
    try {
      await sendWhatsappMessage("👋 Testbericht vanuit de MEP-lijst app — als je dit ontvangt, werkt het!");
      // CallMeBot geeft (anders dan Telegram) geen bevestiging terug, dus dit
      // zegt alleen dat het verzoek de deur uit is — niet dat het is aangekomen.
      showToast("Test bericht verstuurd — check je WhatsApp.");
    } catch (e) {
      console.error("WhatsApp testbericht versturen mislukt:", e);
      showToast("Versturen mislukt — controleer je internetverbinding.", 6000);
    }
  });

  window.addEventListener("beforeprint", applyPrintFilter);
  window.addEventListener("afterprint", clearPrintFilter);

  document.getElementById("newNameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("newNameInput");
    const naam = input.value.trim();
    if (!naam) return;
    Store.addTeamMember(naam);
    input.value = "";
    // Nieuwe namen krijgen nog geen code, dus als toegangscodes al verplicht
    // zijn moet er eerst nog eentje ingesteld worden door Joris — anders zou
    // dit een achterdeurtje zijn om de code-eis te omzeilen.
    selectUser(naam);
  });

  document.getElementById("codeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = pendingCodeName;
    if (!name) return;
    const input = document.getElementById("codeInput");
    const entered = input.value.trim();
    const errorEl = document.getElementById("codeError");
    const real = state.accessCodes[name];
    if (!real) {
      errorEl.textContent = "Voor deze naam is nog geen toegangscode ingesteld. Vraag Joris om er een toe te voegen via het beheerscherm.";
      errorEl.classList.remove("hidden");
      return;
    }
    if (entered && entered === real) {
      unlockUser(name, entered);
    } else {
      errorEl.textContent = "Onjuiste code, probeer het nog eens.";
      errorEl.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  });
  document.getElementById("codeBack").addEventListener("click", showNameStep);

  document.getElementById("addTeamForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("addTeamInput");
    const naam = input.value.trim();
    if (naam) { Store.addTeamMember(naam); input.value = ""; }
  });

  document.getElementById("addCategoryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("addCategoryInput");
    const naam = input.value.trim();
    if (!naam) return;
    const id = slugify(naam) || "cat-" + Date.now();
    const kleur = CATEGORY_PALETTE[state.categories.length % CATEGORY_PALETTE.length];
    Store.addCategory({ id, naam, kleur, order: state.categories.length });
    input.value = "";
  });

  const headerSave = debounce((key, patch) => Store.setHeader(key, patch), 500);
  document.getElementById("workDateLabel").addEventListener("input", (e) => headerSave(activeDateKey(), { workDateLabel: e.target.value }));
  document.getElementById("gemaaktDoor").addEventListener("change", (e) => {
    e.target.classList.toggle("field-missing", !e.target.value.trim());
    headerSave(activeDateKey(), { gemaaktDoor: e.target.value });
  });
  document.getElementById("opmerkingen").addEventListener("input", (e) => headerSave(activeDateKey(), { opmerkingen: e.target.value }));
  document.getElementById("personeelsetenGisteren").addEventListener("input", (e) => headerSave(activeDateKey(), { personeelsetenGisteren: e.target.value }));
}

// ----------------------------------------------------------------------------
// Dagwissel: elke 5 minuten controleren of de kalenderdag inmiddels is
// opgeschoven (voor toestellen die 's nachts open blijven staan) — zo niet,
// niks te doen; zo wel, opnieuw abonneren op de juiste twee documenten.
// ----------------------------------------------------------------------------
let unsubToday = null;
let unsubTomorrow = null;

function subscribeDayListeners() {
  if (unsubToday) unsubToday();
  if (unsubTomorrow) unsubTomorrow();
  unsubToday = Store.onDayState(state.todayKey, (day) => {
    state.dayToday = { items: {}, ...day };
    if (state.activeTab === "today") render();
    else { renderApprovalBanner(); }
  });
  unsubTomorrow = Store.onDayState(state.tomorrowKey, (day) => {
    state.dayTomorrow = { items: {}, ...day };
    if (state.activeTab === "tomorrow") render();
  });
}

async function checkDateFlip() {
  const newToday = dateKey(new Date());
  if (newToday === state.todayKey) return;
  state.todayKey = newToday;
  state.tomorrowKey = dateKey(addDays(new Date(), 1));
  await Store.rolloverIfNeeded(state.menu).catch((err) => console.warn("Rollover mislukt:", err));
  subscribeDayListeners();
  render();
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  wireEvents();
  await initStore();
  await Store.ready;
  // Veiligheidsklep: als het vullen van standaardgegevens onverhoopt vast zou
  // lopen (bv. een trage of haperende verbinding), mag dat de rest van het
  // opstarten niet blokkeren — de live-listeners hieronder moeten hoe dan ook
  // aan de praat komen.
  await Promise.race([
    Store.seedIfEmpty(window.DEFAULT_CATEGORIES || [], window.DEFAULT_ITEMS || [], window.DEFAULT_TEAM || []),
    new Promise((res) => setTimeout(res, 6000)),
  ]).catch((err) => console.error("seedIfEmpty-fout (ga toch door):", err));

  const adminIsOpen = () => !document.getElementById("adminModal").classList.contains("hidden");

  let resolveFirstMenu;
  const firstMenuLoaded = new Promise((res) => { resolveFirstMenu = res; });

  Store.onCategories((cats) => { state.categories = cats; render(); if (adminIsOpen()) renderAdmin(); });
  Store.onMenu((items) => { state.menu = items; render(); if (adminIsOpen()) renderAdmin(); resolveFirstMenu(); });
  Store.onPlanning((list) => {
    state.planning = list;
    // Vooruit-plannen bepalen mee of een item "relevant" is voor de
    // Alleen-vandaag-filter, dus een volledige herbouw i.p.v. alleen een
    // patch — anders duikt een nieuwe planning niet vanzelf op.
    render(true);
    if (planningModalItemId) renderPlanningModal();
  });
  Store.onTeam((team) => {
    state.team = team;
    teamLoadedOnce = true;
    renderNameList();
    if (!state.user) openNamePrompt();
    if (adminIsOpen()) renderAdmin();
    validateSession();
  });
  Store.onAccessCodes((data) => {
    state.accessCodes = (data && data.codes) || {};
    state.admins = (data && data.admins) || [];
    state.accessGatingActivated = !!(data && data.activated);
    accessCodesLoadedOnce = true;
    if (adminIsOpen()) renderAdmin();
    validateSession();
  });
  Store.onDevices((data) => {
    state.devices = data || { approved: {}, pendingCode: null, activated: false };
    devicesLoadedOnce = true;
    updateDeviceGate();
    if (adminIsOpen()) renderAdmin();
  });
  Store.onZaakSettings((data) => {
    state.zaak = data || {};
    applyZaakSettings();
    render();
    if (adminIsOpen()) renderAdmin();
  });
  Store.onTelegramSettings((data) => {
    state.telegram = data || { enabled: false, botToken: "", chatId: "" };
    if (adminIsOpen()) renderAdmin();
  });
  Store.onWhatsappSettings((data) => {
    state.whatsapp = data || { enabled: false, phone: "", apikey: "" };
    if (adminIsOpen()) renderAdmin();
  });

  // Wacht tot de productenlijst (met eventuele stappen-definities) binnen is,
  // zodat rollover/migratie weten welke items uit meerdere stappen bestaan.
  await Promise.race([firstMenuLoaded, new Promise((res) => setTimeout(res, 4000))]);

  // Eenmalige migratie van het oude één-lijst-model, zodat live ingevulde
  // data van vandaag niet verloren gaat bij deze update.
  await Store.migrateLegacyIfNeeded(state.todayKey).catch((err) => console.warn("Migratie oude lijst mislukt:", err));
  await Store.rolloverIfNeeded(state.menu).catch((err) => console.warn("Rollover mislukt:", err));

  subscribeDayListeners();

  // Check elke 5 minuten opnieuw of het inmiddels een nieuwe dag is.
  setInterval(() => checkDateFlip(), 5 * 60 * 1000);

  // Check elke 30 seconden of het toestel al een kwartier stilligt (zie
  // checkIdleLogout hierboven) — vaak genoeg om snel te reageren, zonder de
  // batterij/prestaties merkbaar te belasten.
  setInterval(() => checkIdleLogout(), 30 * 1000);

  // Voorspellende hoeveelheden: geschiedenis rustig op de achtergrond
  // ophalen, blokkeert het opstarten niet (zie ensurePredictionHistory).
  ensurePredictionHistory();

  // WhatsApp/Telegram-melding voor dingen die al 2+ dagen blijven liggen:
  // eerst een check kort na het opstarten, daarna elke 10 minuten opnieuw.
  // Verstuurt zichzelf hooguit één keer per item per dag (zie checkCarryAlerts).
  setTimeout(() => checkCarryAlerts(), 15 * 1000);
  setInterval(() => checkCarryAlerts(), 10 * 60 * 1000);

  renderUserBadge();
}

boot();


// ---------------------------------------------------------------------------
// Zaak-instellingen (Beheer > Zaak): naam van de zaak, wanneer iets als
// "blijft liggen" telt, automatisch uitloggen en welke vaste velden zichtbaar
// zijn. Opgeslagen in settings/zaak, zodat elke zaak dit zelf kan instellen.
// ---------------------------------------------------------------------------
function zaakNaam() { return ((state.zaak && state.zaak.naam) || "").trim(); }
function zaakLabel() { const n = zaakNaam(); return n ? " · " + n : ""; }
function applyZaakSettings() {
  const z = state.zaak || {};
  const naam = zaakNaam();
  document.querySelectorAll(".rs-zaak-naam").forEach((el) => { el.textContent = naam; el.hidden = !naam; });
  document.title = "RoboShift Loop" + (naam ? " – " + naam : "");
  document.body.classList.toggle("rs-no-opm", z.toonOpmerkingen === false);
  document.body.classList.toggle("rs-no-pe", z.toonPersoneelseten === false);
}
function renderZaakAdminSection() {
  const note = document.getElementById("zaakAdminNote");
  const form = document.getElementById("zaakSettingsForm");
  if (!note || !form) return;
  const canManage = isCurrentUserAdmin();
  note.classList.toggle("hidden", canManage);
  form.classList.toggle("hidden", !canManage);
  if (!canManage) return;
  const z = state.zaak || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  set("zaakNaamInput", z.naam || "");
  set("zaakDagenInput", String(staleCarryDays()));
  set("zaakUitlogInput", String(Math.round(idleLogoutMs() / 60000)));
  document.getElementById("zaakOpmInput").checked = z.toonOpmerkingen !== false;
  document.getElementById("zaakPeInput").checked = z.toonPersoneelseten !== false;
}
(function initZaakSettings() {
  if (!state.zaak) state.zaak = {};
  applyZaakSettings();
  const form = document.getElementById("zaakSettingsForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!isCurrentUserAdmin()) return;
    const dagen = Math.min(14, Math.max(1, Math.round(Number(document.getElementById("zaakDagenInput").value) || STALE_CARRY_DAYS)));
    const uitlogRaw = Number(document.getElementById("zaakUitlogInput").value);
    const uitlog = Number.isFinite(uitlogRaw) ? Math.min(480, Math.max(0, Math.round(uitlogRaw))) : 15;
    const patch = {
      naam: document.getElementById("zaakNaamInput").value.trim(),
      blijftLiggenDagen: dagen,
      uitlogMinuten: uitlog,
      toonOpmerkingen: document.getElementById("zaakOpmInput").checked,
      toonPersoneelseten: document.getElementById("zaakPeInput").checked,
    };
    state.zaak = { ...(state.zaak || {}), ...patch };
    applyZaakSettings();
    render();
    Promise.resolve(Store.setZaakSettings(patch)).then(() => showToast("Instellingen van de zaak opgeslagen.")).catch((err) => { console.error(err); showToast("Opslaan mislukt, probeer het opnieuw."); });
  });
})();
