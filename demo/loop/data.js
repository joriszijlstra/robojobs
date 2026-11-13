// Standaard MEP-lijst van Eetcafé de Kwikkel.
// Dit is alleen de STARTLIJST: bij de allereerste keer opstarten wordt dit
// automatisch naar de database geschreven. Daarna beheer je alles gewoon
// in de app zelf (knop "Lijst beheren") en wordt dit bestand niet meer gebruikt.

// Kleuren passend bij de "Loop"-huisstijl (paars accent + koele jeweltinten —
// bewust GEEN oranje/amber/goud: die verkleuren bij het verdonkeren van de
// kop-gradient al snel naar een bruinige tint, wat niet meer bij de rest van
// de paarse/glazen stijl past).
const DEFAULT_CATEGORIES = [
  { id: "algemeen", naam: "Algemeen", kleur: "#7C3AED", order: 0 },
  { id: "garnituur", naam: "Garnituur", kleur: "#10B981", order: 1 },
  { id: "uithalen", naam: "Uithalen", kleur: "#0EA5E9", order: 2 },
  { id: "dressing", naam: "Dressing", kleur: "#EC4899", order: 3 },
  { id: "dessert", naam: "Dessert", kleur: "#6366F1", order: 4 },
  { id: "sla", naam: "Sla", kleur: "#14B8A6", order: 5 },
  { id: "overige", naam: "Overige", kleur: "#7C3AED", order: 6 },
];

// Startteam — verschijnt als tikbare naam-knopjes in de app (geen typewerk).
// Via het beheerscherm (tandwiel) kun je dit later zelf aanpassen.
const DEFAULT_TEAM = ["Jork", "Linda", "Anish", "Bo", "Teun", "Joost", "Altan"];

const DEFAULT_ITEMS = [
  // Algemeen
  "Tonijn", "Geitenkaas plak", "Vis van de dag", "Groente garnituur", "Gegrilde groente",
  "Tomatensoep", "Soep v/h moment", "Boerenomelet", "Spicy lak", "Sweet lak",
  "Rauwkost", "Atjar", "Buikspek snijden", "Kip snijden", "Ham snijden",
  "Serano ham", "Pancetta", "Chorizo", "Rendang", "Wilde rijst koken",
  "Bittergarnituur", "Crostini",
].map((n) => ({ naam: n, categorie: "algemeen" }))
  .concat([
    // Garnituur
    "Komkommer", "Tomaat", "Rode ui", "Appel plakken", "Vijgen", "Radijs",
    "Lente ui", "Ui", "Champignons", "Croutons", "Tomatenblokjes",
    "Zongdr. tomaat", "Kappertjes", "Amsterdams zuur", "Spek", "Citroen",
    "Granaatappel", "Dukah", "Pecan.Caramel", "Pecan gefrituurd",
    "Pijnboompitten", "Cherry tomaat", "Zoetzure ui", "Zoetzuur komkom",
    "Spek hakken",
  ].map((n) => ({ naam: n, categorie: "garnituur" })))
  .concat([
    // Uithalen
    "Carpaccio", "Hamburgers", "Gerookte zalm", "Rendang", "Hete kip",
    "Ossenworst", "Turksbrood", "Broden", "Spek", "Guacamole", "Cheesecake",
    "Suikerbrood", "Appeltaart", "Buikspek", "High tea",
  ].map((n) => ({ naam: n, categorie: "uithalen" })))
  .concat([
    // Dressing
    "Truffelmayo", "Roomkaas dille", "Mosterdmayo", "Paprika dressing",
    "Appelstroop", "Spicy mayo", "Kruidenboter", "Aioli", "Huisdressing",
    "Cocktailsaus", "Knoflooksaus", "Caesar dressing", "Hoisin",
    "Mango chutney",
  ].map((n) => ({ naam: n, categorie: "dressing" })))
  .concat([
    // Dessert
    "Cheesecake", "Bastogne kruim",
  ].map((n) => ({ naam: n, categorie: "dessert" })))
  .concat([
    // Sla
    "Rucola", "Little gem", "Sla garnituur", "Rauwkost", "Atjar", "Koolsalade",
  ].map((n) => ({ naam: n, categorie: "sla" })))
  .concat([
    // Overige
    "Personeels-eten",
  ].map((n) => ({ naam: n, categorie: "overige" })));

// Maak stabiele, unieke id's: categorie-slug + volgnummer.
function slugify(s) {
  return s.toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
DEFAULT_ITEMS.forEach((item, i) => {
  const catCount = DEFAULT_ITEMS.slice(0, i).filter((x) => x.categorie === item.categorie).length;
  item.id = `${item.categorie}__${slugify(item.naam)}` || `${item.categorie}__item${catCount}`;
  item.order = catCount;
  item.actief = true;
});

if (typeof window !== "undefined") {
  window.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
  window.DEFAULT_ITEMS = DEFAULT_ITEMS;
  window.DEFAULT_TEAM = DEFAULT_TEAM;
}
