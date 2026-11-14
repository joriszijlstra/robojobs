// Standaardinstellingen voor een zaak. Alles hier is per zaak aan te passen
// in het overzicht (tab Instellingen). Wordt gebruikt door de pagina's én de server.
export const DEFAULTS = {
  naam: "Eetcafé de Kwikkel",
  tijdzone: "Europe/Amsterdam",
  talen: ["nl", "en", "de"],
  // Score 1 t/m 5. Alles op of onder deze drempel telt als "slecht".
  drempelSlecht: 2,
  // Onderdelen waar de gast op kan tikken. Per taal een label.
  onderdelen: [
    { nl: "Eten", en: "Food", de: "Essen" },
    { nl: "Drinken", en: "Drinks", de: "Getränke" },
    { nl: "Bediening", en: "Service", de: "Service" },
    { nl: "Sfeer", en: "Atmosphere", de: "Atmosphäre" },
    { nl: "Wachttijd", en: "Waiting time", de: "Wartezeit" },
    { nl: "Prijs", en: "Price", de: "Preis" },
    { nl: "Schoon", en: "Cleanliness", de: "Sauberkeit" }
  ],
  // Bij een lage score vragen of de zaak contact mag opnemen.
  contactVragen: true,
  // Link naar een openbare reviewsite. Wordt aan IEDEREEN getoond (geen review gating).
  reviewAan: false,
  reviewLink: "",
  // Ingangen. Elke ingang krijgt een eigen QR-code / link.
  bronnen: [
    { id: "viltje", naam: "Bierviltje" },
    { id: "toilet", naam: "Toiletspiegel" },
    { id: "mail", naam: "Mail na bezoek (Guestplan)" }
  ],
  // Dagdelen voor de trends. Tijden in de tijdzone van de zaak.
  dagdelen: [
    { naam: "Lunch", van: "11:00", tot: "16:00" },
    { naam: "Diner", van: "16:00", tot: "23:59" }
  ],
  // Tafelnummer vragen op het gastformulier (optioneel voor de gast), voor deze ingangen.
  // Daarmee koppelt Echo de review aan de juiste rekening uit de kassa.
  vraagTafel: true,
  tafelBronnen: ["viltje", "toilet"],
  // Kassakoppeling: Echo gebruikt de unTill-koppeling van Fill en Pass (zelfde Supabase-project).
  // syncSeconden: hoe vaak Echo de kassa bijwerkt (min. 15). Buiten syncVan–syncTot één keer per uur. Na elke review altijd direct.
  kassa: { aan: false, syncSeconden: 60, syncVan: "07:00", syncTot: "02:00" },
  // Tafelnummers die geen echte tafel zijn (bv. afhaal of sluitpas), als [van, tot].
  tafelsNegeren: [],
  // Kassagebruikers die geen mens zijn (tellen niet mee als medewerker).
  systeemGebruikers: ["Guestplan"],
  // Welke kassagroep (unTill-omzetgroep) is wat. soort: drank | voor | hoofd | na | overig | negeren.
  // Staat een groep er niet in, dan bepaalt de gang in unTill (voor/hoofd/na) het.
  kassaGroepen: [
    { groep: "Bier", soort: "drank" }, { groep: "Wijn", soort: "drank" }, { groep: "Fris", soort: "drank" },
    { groep: "Warme dranken", soort: "drank" }, { groep: "Gedistilleerd", soort: "drank" },
    { groep: "Voorgerechten", soort: "voor" }, { groep: "Bar snacks", soort: "voor" },
    { groep: "Hoofdgerechten", soort: "hoofd" }, { groep: "Nagerechten", soort: "na" }
  ],
  // Drempels voor de reviewsheet en de analyse. Leeg (null) = automatisch uit de eigen historie.
  sheet: {
    maxEersteDrankje: 10,   // min van tafel openen tot eerste drankje aangeslagen
    maxGat: 35,             // min zonder drankbestelling ("droog gestaan", maat voor aandacht)
    maxTussenGangen: 35,    // min tussen voorgerecht en hoofdgerecht uitvragen
    maxNaLaatste: 30,       // min van laatste bestelling tot afrekenen
    minDrankPP: null,       // drankjes per persoon; null = uit historie
    minBestedingPP: null,   // euro per persoon; null = uit historie
    normProcent: 80,        // bij automatisch: onder dit % van het gemiddelde = laag
    maxMedewerkers: 3,      // meer verschillende medewerkers aan één tafel = veel wisselingen
    koppelNa: 120,          // min na afrekenen dat een review nog bij die rekening mag horen
    personenUitHoofd: true  // aantal personen onbekend? tel de hoofdgerechten
  },
  meldingen: {
    ntfyServer: "https://ntfy.sh",
    ntfyTopic: "",          // geheim: alleen zichtbaar na inloggen
    wanneer: "alle",        // "alle" of "slecht"
    nachtAan: true,
    nachtVan: "23:30",
    nachtTot: "09:00",
    nachtSlechtWel: true    // slechte reviews 's nachts wél melden
  }
};

export const TEKST = {
  nl: {
    vraag: "Hoe was je bezoek?",
    sub: "Tik een gezicht. Klaar in een halve minuut.",
    scores: ["Slecht", "Matig", "Oké", "Goed", "Top"],
    top: "Wat was top?",
    beter: "Wat kan beter?",
    optioneel: "Optioneel, tik wat van toepassing is",
    opmerking: "Wil je nog iets kwijt?",
    opmerkingPh: "Typ hier je opmerking (mag ook leeg)",
    contact: "Mogen we contact met je opnemen?",
    contactJa: "Ja, graag",
    naam: "Naam",
    tel: "Telefoon of e-mail",
    verstuur: "Versturen",
    terug: "Ander gezicht kiezen",
    bedankt: "Dank je wel!",
    bedanktSub: "Je feedback is direct bij het team.",
    bedanktLaag: "Sorry dat het niet goed was. Het team leest dit meteen.",
    review: "Wil je je ervaring ook openbaar delen?",
    reviewKnop: "Schrijf een review",
    fout: "Versturen lukte niet. Controleer je internet en probeer het opnieuw.",
    tafel: "Aan welke tafel zat je?",
    tafelPh: "Tafelnummer (mag leeg)",
    door: "Echo door RoboShift"
  },
  en: {
    vraag: "How was your visit?",
    sub: "Tap a face. Done in half a minute.",
    scores: ["Bad", "Poor", "Okay", "Good", "Great"],
    top: "What was great?",
    beter: "What could be better?",
    optioneel: "Optional, tap what applies",
    opmerking: "Anything else to share?",
    opmerkingPh: "Type your comment (optional)",
    contact: "May we contact you?",
    contactJa: "Yes, please",
    naam: "Name",
    tel: "Phone or e-mail",
    verstuur: "Send",
    terug: "Pick another face",
    bedankt: "Thank you!",
    bedanktSub: "Your feedback went straight to the team.",
    bedanktLaag: "Sorry it wasn't good. The team is reading this right now.",
    review: "Would you like to share your experience publicly?",
    reviewKnop: "Write a review",
    fout: "Sending failed. Check your connection and try again.",
    tafel: "Which table were you at?",
    tafelPh: "Table number (optional)",
    door: "Echo by RoboShift"
  },
  de: {
    vraag: "Wie war Ihr Besuch?",
    sub: "Tippen Sie ein Gesicht. In einer halben Minute fertig.",
    scores: ["Schlecht", "Mäßig", "Okay", "Gut", "Top"],
    top: "Was war top?",
    beter: "Was geht besser?",
    optioneel: "Optional, tippen Sie, was zutrifft",
    opmerking: "Möchten Sie noch etwas sagen?",
    opmerkingPh: "Ihr Kommentar (optional)",
    contact: "Dürfen wir Sie kontaktieren?",
    contactJa: "Ja, gerne",
    naam: "Name",
    tel: "Telefon oder E-Mail",
    verstuur: "Senden",
    terug: "Anderes Gesicht wählen",
    bedankt: "Vielen Dank!",
    bedanktSub: "Ihr Feedback ist direkt beim Team.",
    bedanktLaag: "Schade, dass es nicht gut war. Das Team liest das sofort.",
    review: "Möchten Sie Ihre Erfahrung öffentlich teilen?",
    reviewKnop: "Bewertung schreiben",
    fout: "Senden fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.",
    tafel: "An welchem Tisch saßen Sie?",
    tafelPh: "Tischnummer (optional)",
    door: "Echo von RoboShift"
  }
};

// Kleuren per score (1..5), gelijk aan de Fill-statuskleuren.
export const SCORE_KLEUR = ["#ec6b6b", "#ff7a59", "#f0b25c", "#9fd37a", "#5cca8c"];

// Instellingen samenvoegen met de standaard (diep genoeg voor "meldingen").
export function metStandaard(s = {}) {
  return {
    ...DEFAULTS, ...s,
    meldingen: { ...DEFAULTS.meldingen, ...(s.meldingen || {}) },
    kassa: { ...DEFAULTS.kassa, ...(s.kassa || {}) },
    sheet: { ...DEFAULTS.sheet, ...(s.sheet || {}) }
  };
}
