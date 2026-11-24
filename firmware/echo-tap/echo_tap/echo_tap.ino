/*
  Echo Tap · RoboShift
  Box met 5 gezichtjes die de bediening na het afrekenen op tafel zet.

  Verloop
    1. Bediening tikt op het scherm (box wordt wakker) en kiest het tafelnummer
       met de ring of met − / +, en tikt op "Start".
    2. Gast tikt een gezichtje, óf draait aan de ring (gezichtje licht op) en tikt om te bevestigen.
    3. Direct "Bedankt!" + trilling. De stem gaat via wifi naar Echo (edge function echo-gast,
       actie "tap", eigen sleutel per box). Echo koppelt de stem aan de rekening van die tafel.
    4. Box gaat slapen. Tikt de gast nog eens, dan ziet die alleen "Bedankt voor uw stem".
       De bediening houdt het scherm 2 seconden vast om de box voor de volgende tafel klaar te zetten.
    Geen wifi? Dan bewaart de box de stem (max. 20) en verstuurt die bij de volgende keer.

  Instellen gaat via roboshift.nl/echo/tap (Chrome, USB-C): wifi, box-id en sleutel komen over de
  seriële USB-verbinding binnen (regel "ECHO-CFG {json}"). Teksten, tafelbereik, helderheid en
  slaaptijd komen van de server en zijn per zaak in te stellen.

  Hardware: Waveshare ESP32-S3-Knob-Touch-LCD-1.8 (ST77916 QSPI 360x360, CST816 touch, ring A8/B7,
  DRV2605 trilmotor, batterij op GPIO1 met 2:1-deler).
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include <Arduino_GFX_Library.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>
#include <time.h>
#include "lcd_init.h"
#include "certs.h"

#define ECHO_VERSIE "0.1.1"

// ---------- pinnen ----------
#define LCD_CS 14
#define LCD_SCK 13
#define LCD_D0 15
#define LCD_D1 16
#define LCD_D2 17
#define LCD_D3 18
#define LCD_RST 21
#define LCD_BL 47
#define TP_SDA 11
#define TP_SCL 12
#define TP_INT 9
#define TP_RST 10
#define TP_ADDR 0x15
#define DRV_ADDR 0x5A
#define ENC_A 8
#define ENC_B 7
#define BAT_ADC 1

// ---------- kleuren (Fill-stijl) ----------
static inline uint16_t rgb(uint32_t c) { return ((c >> 8) & 0xF800) | ((c >> 5) & 0x07E0) | ((c >> 3) & 0x001F); }
static uint16_t mix(uint32_t a, uint32_t b, float t) {  // t=0 → a, t=1 → b
  uint8_t r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  uint8_t g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  uint8_t bl = (a & 255) * (1 - t) + (b & 255) * t;
  return rgb((r << 16) | (g << 8) | bl);
}
const uint32_t C_BG = 0x0e161b, C_SURFACE = 0x16222a, C_SURFACE2 = 0x1b2932, C_LINE = 0x26353e, C_FG = 0xe9eff2,
               C_MUTED = 0x8c9ca5, C_DIM = 0x5f7079, C_CYAN = 0x4fb7d6, C_CYAN_INK = 0x0f2a35, C_RED = 0xec6b6b;
const uint32_t SCORE_KLEUR[5] = { 0xec6b6b, 0xff7a59, 0xf0b25c, 0x9fd37a, 0x5cca8c };
const char *SCORE_NAAM[5] = { "Slecht", "Matig", "Oké", "Goed", "Top" };

// ---------- scherm ----------
Arduino_DataBus *bus = new Arduino_ESP32QSPI(LCD_CS, LCD_SCK, LCD_D0, LCD_D1, LCD_D2, LCD_D3);
Arduino_GFX *panel = new Arduino_ST77916(bus, LCD_RST, 0, true, 360, 360, 0, 0, 0, 0, echo_st77916_init, sizeof(echo_st77916_init));
Arduino_Canvas *gfx = new Arduino_Canvas(360, 360, panel);
const int W = 360, CX = 180, CY = 180;

// ---------- instellingen (NVS) ----------
Preferences prefs;
struct Cfg {
  String ssid, pass, box, sleutel, url, naam;
  String zaak = "", vraag = "Hoe was uw bezoek?", sub = "Tik op een gezichtje", bedankt = "Bedankt!", bedanktSub = "Fijne dag verder.";
  bool tafelVragen = true;
  int tafelVan = 1, tafelTot = 99, slaapNaMin = 15, helderheid = 80;
} cfg;
bool ingesteld() { return cfg.ssid.length() && cfg.box.length() && cfg.sleutel.length() && cfg.url.length(); }

// bewaard tijdens diepe slaap
RTC_DATA_ATTR bool gestemd = false;   // na een stem: gast ziet alleen "Bedankt voor uw stem"
RTC_DATA_ATTR int tafel = 1;
RTC_DATA_ATTR uint8_t wifiKanaal = 0;
RTC_DATA_ATTR uint8_t wifiBssid[6];

// ---------- toestand ----------
enum Scherm { S_INSTALLEER, S_TAFEL, S_GAST, S_BEDANKT, S_AL_GESTEMD };
Scherm scherm;
int gekozen = -1;                 // gezichtje dat via de ring oplicht (0..4)
uint32_t laatsteActie = 0;
bool opnieuwTekenen = true;
volatile int encDelta = 0;
String melding = "";              // korte statusregel voor de bediening

// ============================================================ hulpjes
int batterijMv() {
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(BAT_ADC);
  return (int)(mv / 8) * 2;
}
int batterijPct(int mv) { return constrain(map(mv, 3400, 4150, 0, 100), 0, 100); }

void achtergrondlicht(int pct) {
  ledcWrite(LCD_BL, pct <= 0 ? 0 : map(constrain(pct, 5, 100), 0, 100, 0, 255));
}

void drvSchrijf(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(DRV_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}
void tril(int ms, uint8_t sterkte = 0xFF) {  // DRV2605 in realtime-modus (zoals getest op dit bord)
  drvSchrijf(0x01, 0x05); drvSchrijf(0x02, sterkte); delay(ms); drvSchrijf(0x02, 0x00);
}
void trilInit() {
  drvSchrijf(0x01, 0x00); drvSchrijf(0x1D, 0xA8); drvSchrijf(0x1A, 0x05);
  drvSchrijf(0x04, 0x01); drvSchrijf(0x05, 0x00); drvSchrijf(0x0C, 0x01);
}
void trilUit() { drvSchrijf(0x02, 0x00); drvSchrijf(0x01, 0x40); }  // standby

// ---------- touch (CST816) ----------
bool leesTouch(int16_t &x, int16_t &y) {
  Wire.beginTransmission(TP_ADDR); Wire.write(0x01);
  if (Wire.endTransmission(true) != 0) return false;
  if (Wire.requestFrom(TP_ADDR, 6) != 6) return false;
  uint8_t b[6]; for (int i = 0; i < 6; i++) b[i] = Wire.read();
  if ((b[1] & 0x0F) == 0) return false;
  x = ((b[2] & 0x0F) << 8) | b[3];
  y = ((b[4] & 0x0F) << 8) | b[5];
  return x < W && y < W;
}

// ---------- ring: pulsknop, A stijgt = +1, B stijgt = −1 ----------
void ringTaak(void *) {
  uint8_t a = digitalRead(ENC_A), b = digitalRead(ENC_B);
  for (;;) {
    uint8_t a1 = digitalRead(ENC_A), a2 = digitalRead(ENC_A), b1 = digitalRead(ENC_B), b2 = digitalRead(ENC_B);
    if (a1 == a2 && a1 != a) { a = a1; if (a) encDelta++; }
    if (b1 == b2 && b1 != b) { b = b1; if (b) encDelta--; }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

// ---------- tekst ----------
void tekst(const String &s, int y, const uint8_t *font, uint16_t kleur, int x = CX) {
  gfx->setFont(font); gfx->setTextColor(kleur);
  int16_t x1, y1; uint16_t w, h;
  gfx->getTextBounds(s.c_str(), 0, 0, &x1, &y1, &w, &h);
  gfx->setCursor(x - w / 2 - x1, y);
  gfx->print(s);
}

// dikke lijn: rondjes langs de lijn
void dikPunt(float x, float y, float r, uint16_t c) { gfx->fillCircle(lroundf(x), lroundf(y), max(1, (int)lroundf(r)), c); }
void dikLijn(float x0, float y0, float x1, float y1, float r, uint16_t c) {
  int n = max(2, (int)(hypotf(x1 - x0, y1 - y0) / 1.5f));
  for (int i = 0; i <= n; i++) { float t = (float)i / n; dikPunt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c); }
}
void dikBocht(float x0, float y0, float qx, float qy, float x1, float y1, float r, uint16_t c) {
  for (int i = 0; i <= 40; i++) {
    float t = i / 40.0f, u = 1 - t;
    dikPunt(u * u * x0 + 2 * u * t * qx + t * t * x1, u * u * y0 + 2 * u * t * qy + t * t * y1, r, c);
  }
}

// gezichtje zoals in het gastformulier (viewBox 48×48), score 1..5
void gezicht(int score, int cx, int cy, int maat, bool actief, bool gedimd) {
  float k = maat / 48.0f, ox = cx - 24 * k, oy = cy - 24 * k;
  uint32_t kl = SCORE_KLEUR[score - 1];
  uint16_t lijn = gedimd ? mix(kl, C_BG, 0.55f) : rgb(kl);
  uint16_t vul = mix(C_BG, kl, actief ? 0.30f : 0.13f);
  auto X = [&](float v) { return ox + v * k; };
  auto Y = [&](float v) { return oy + v * k; };
  if (actief) gfx->fillCircle(cx, cy, lroundf(27 * k), mix(C_BG, kl, 0.22f));
  gfx->fillCircle(cx, cy, lroundf(22.5f * k), lijn);
  gfx->fillCircle(cx, cy, lroundf(19.5f * k), vul);
  dikPunt(X(17), Y(21), 2.6f * k, lijn);
  dikPunt(X(31), Y(21), 2.6f * k, lijn);
  float r = 1.6f * k;
  if (score == 1) { dikLijn(X(14), Y(17), X(19), Y(20), 1.5f * k, lijn); dikLijn(X(34), Y(17), X(29), Y(20), 1.5f * k, lijn); }
  switch (score) {
    case 1: dikBocht(X(14), Y(33), X(24), Y(24), X(34), Y(33), r, lijn); break;
    case 2: dikBocht(X(15), Y(32), X(24), Y(28), X(33), Y(32), r, lijn); break;
    case 3: dikLijn(X(15), Y(31), X(33), Y(31), r, lijn); break;
    case 4: dikBocht(X(15), Y(29), X(24), Y(35), X(33), Y(29), r, lijn); break;
    case 5: dikBocht(X(13), Y(28), X(24), Y(40), X(35), Y(28), r, lijn); break;
  }
}

void knop(int cx, int cy, int w, int h, const String &label, bool primair) {
  gfx->fillRoundRect(cx - w / 2, cy - h / 2, w, h, h / 2, primair ? rgb(C_CYAN) : rgb(C_SURFACE2));
  if (!primair) gfx->drawRoundRect(cx - w / 2, cy - h / 2, w, h, h / 2, rgb(C_LINE));
  tekst(label, cy + 8, u8g2_font_helvB18_tf, primair ? rgb(C_CYAN_INK) : rgb(C_FG), cx);
}
bool binnen(int16_t x, int16_t y, int cx, int cy, int w, int h) { return abs(x - cx) <= w / 2 && abs(y - cy) <= h / 2; }

// ============================================================ schermen
const int FX[5] = { 52, 116, 180, 244, 308 }, FY = 180, FMAAT = 56;

void tekenInstalleer() {
  gfx->fillScreen(rgb(C_BG));
  tekst("Echo Tap", 120, u8g2_font_helvB24_tf, rgb(C_FG));
  tekst("Nog niet ingesteld", 165, u8g2_font_helvR18_tf, rgb(C_MUTED));
  tekst("Sluit aan via USB-C en ga naar", 215, u8g2_font_helvR14_tf, rgb(C_MUTED));
  tekst("roboshift.nl/echo/tap", 245, u8g2_font_helvB18_tf, rgb(C_CYAN));
  if (melding.length()) tekst(melding, 290, u8g2_font_helvR14_tf, rgb(C_FG));
}

void tekenTafel() {
  gfx->fillScreen(rgb(C_BG));
  int mv = batterijMv(), pct = batterijPct(mv);
  String kop = (cfg.naam.length() ? cfg.naam : String("Echo Tap")) + "  ·  " + pct + "%";
  tekst(kop, 52, u8g2_font_helvR14_tf, pct <= 15 ? rgb(C_RED) : rgb(C_DIM));
  tekst("Tafel", 96, u8g2_font_helvB18_tf, rgb(C_MUTED));
  tekst(String(tafel), 215, u8g2_font_logisoso92_tn, rgb(C_FG));
  // − en +
  gfx->fillCircle(58, 175, 32, rgb(C_SURFACE2)); gfx->drawCircle(58, 175, 32, rgb(C_LINE));
  gfx->fillRoundRect(44, 172, 28, 6, 3, rgb(C_FG));
  gfx->fillCircle(302, 175, 32, rgb(C_SURFACE2)); gfx->drawCircle(302, 175, 32, rgb(C_LINE));
  gfx->fillRoundRect(288, 172, 28, 6, 3, rgb(C_FG)); gfx->fillRoundRect(299, 161, 6, 28, 3, rgb(C_FG));
  knop(CX, 268, 170, 54, "Start", true);
  if (melding.length()) tekst(melding, 322, u8g2_font_helvR12_tf, rgb(C_MUTED));
  else tekst("Draai aan de ring", 322, u8g2_font_helvR12_tf, rgb(C_DIM));
}

void tekenGast() {
  gfx->fillScreen(rgb(C_BG));
  tekst(cfg.vraag, 98, u8g2_font_helvB18_tf, rgb(C_FG));
  tekst(cfg.sub, 126, u8g2_font_helvR14_tf, rgb(C_MUTED));
  for (int i = 0; i < 5; i++) gezicht(i + 1, FX[i], FY, FMAAT, gekozen == i, gekozen >= 0 && gekozen != i);
  if (gekozen >= 0) {
    tekst(SCORE_NAAM[gekozen], 252, u8g2_font_helvB18_tf, rgb(SCORE_KLEUR[gekozen]));
    knop(CX, 296, 150, 46, "Kiezen", true);
  }
}

void tekenBedankt(int score) {
  gfx->fillScreen(rgb(C_BG));
  gezicht(score, CX, 128, 110, true, false);
  tekst(cfg.bedankt, 248, u8g2_font_helvB24_tf, rgb(C_FG));
  tekst(cfg.bedanktSub, 284, u8g2_font_helvR14_tf, rgb(C_MUTED));
}

void tekenAlGestemd() {
  gfx->fillScreen(rgb(C_BG));
  tekst(cfg.bedankt, 165, u8g2_font_helvB24_tf, rgb(C_FG));
  tekst("Uw stem is ontvangen.", 205, u8g2_font_helvR14_tf, rgb(C_MUTED));
  tekst("Bediening: 2 sec. vasthouden", 300, u8g2_font_helvR12_tf, rgb(C_DIM));
}

void teken() {
  switch (scherm) {
    case S_INSTALLEER: tekenInstalleer(); break;
    case S_TAFEL: tekenTafel(); break;
    case S_GAST: tekenGast(); break;
    case S_AL_GESTEMD: tekenAlGestemd(); break;
    default: break;
  }
  gfx->flush();
  opnieuwTekenen = false;
}

// ============================================================ instellingen
void laadCfg() {
  prefs.begin("echo", true);
  cfg.ssid = prefs.getString("ssid", ""); cfg.pass = prefs.getString("pass", "");
  cfg.box = prefs.getString("box", ""); cfg.sleutel = prefs.getString("sleutel", "");
  cfg.url = prefs.getString("url", ""); cfg.naam = prefs.getString("naam", "");
  String srv = prefs.getString("srv", "");
  prefs.end();
  if (srv.length()) {
    JsonDocument d;
    if (!deserializeJson(d, srv)) {
      cfg.zaak = d["zaak"] | cfg.zaak; cfg.vraag = d["vraag"] | cfg.vraag; cfg.sub = d["sub"] | cfg.sub;
      cfg.bedankt = d["bedankt"] | cfg.bedankt; cfg.bedanktSub = d["bedanktSub"] | cfg.bedanktSub;
      cfg.tafelVragen = d["tafelVragen"] | cfg.tafelVragen; cfg.tafelVan = d["tafelVan"] | cfg.tafelVan;
      cfg.tafelTot = d["tafelTot"] | cfg.tafelTot; cfg.slaapNaMin = d["slaapNaMin"] | cfg.slaapNaMin;
      cfg.helderheid = d["helderheid"] | cfg.helderheid;
    }
  }
  if (cfg.tafelTot < cfg.tafelVan) cfg.tafelTot = cfg.tafelVan;
}

void bewaarServerCfg(JsonVariant inst) {
  if (inst.isNull()) return;
  String s; serializeJson(inst, s);
  prefs.begin("echo", false);
  if (prefs.getString("srv", "") != s) prefs.putString("srv", s);
  prefs.end();
  laadCfg();
}

// ---------- wachtrij voor stemmen die (nog) niet verstuurd zijn ----------
// regels "id;score;tafel;ts"
String leesRij() { prefs.begin("echo", true); String q = prefs.getString("rij", ""); prefs.end(); return q; }
void schrijfRij(const String &q) { prefs.begin("echo", false); prefs.putString("rij", q); prefs.end(); }
int telRij(const String &q) { int n = 0; for (char c : q) if (c == '\n') n++; return n; }
void zetInRij(const String &regel) {
  String q = leesRij() + regel + "\n";
  while (telRij(q) > 20) q = q.substring(q.indexOf('\n') + 1);  // oudste eruit
  schrijfRij(q);
}

// ============================================================ wifi + server
volatile int wifiReden = 0;  // laatste reden van de router bij verbreken (201 = niet gevonden, 15/202/204 = wachtwoord)
bool wifiEventAan = false;
bool wifiAan(uint32_t maxMs = 9000) {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (!wifiEventAan) {
    WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) { wifiReden = info.wifi_sta_disconnected.reason; }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
    wifiEventAan = true;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setMinSecurity(WIFI_AUTH_OPEN);  // ook oudere routers (WPA/TKIP) en open netwerken
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
  if (wifiKanaal) WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str(), wifiKanaal, wifiBssid);
  else WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < maxMs) {
    delay(50);
    if (wifiKanaal && millis() - t0 > 3500) {  // opgeslagen kanaal werkt niet (meer): normaal zoeken
      wifiKanaal = 0; WiFi.disconnect(); WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
    }
  }
  if (WiFi.status() != WL_CONNECTED) return false;
  wifiKanaal = WiFi.channel(); memcpy(wifiBssid, WiFi.BSSID(), 6);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // klok loopt door in diepe slaap
  return true;
}

// stuurt één verzoek; geeft HTTP-status (of <0 bij geen verbinding)
int post(JsonDocument &body, JsonDocument &antwoord) {
  WiFiClientSecure client;
  client.setCACert(ROOT_CAS);
  client.setTimeout(10);
  HTTPClient http;
  if (!http.begin(client, cfg.url)) return -1;
  http.addHeader("content-type", "application/json");
  http.setTimeout(10000);
  body["actie"] = "tap"; body["box"] = cfg.box; body["sleutel"] = cfg.sleutel;
  body["batterij"] = batterijMv(); body["versie"] = ECHO_VERSIE; body["rssi"] = WiFi.RSSI();
  String s; serializeJson(body, s);
  int code = http.POST(s);
  if (code > 0) deserializeJson(antwoord, http.getString());
  http.end();
  return code;
}

// verstuurt de wachtrij; true als alles weg is
bool verstuurRij() {
  String q = leesRij();
  if (!q.length()) return true;
  if (!wifiAan()) return false;
  String rest = "";
  int start = 0;
  while (start < (int)q.length()) {
    int eind = q.indexOf('\n', start); if (eind < 0) break;
    String regel = q.substring(start, eind); start = eind + 1;
    int p1 = regel.indexOf(';'), p2 = regel.indexOf(';', p1 + 1), p3 = regel.indexOf(';', p2 + 1);
    if (p1 < 0 || p2 < 0 || p3 < 0) continue;
    JsonDocument b, a;
    b["id"] = regel.substring(0, p1); b["score"] = regel.substring(p1 + 1, p2).toInt();
    b["tafel"] = regel.substring(p2 + 1, p3); b["ts"] = (uint32_t)regel.substring(p3 + 1).toInt();
    int code = post(b, a);
    if (code == 200) bewaarServerCfg(a["instellingen"]);
    else if (code < 0 || code >= 500 || code == 429) rest += regel + "\n";  // later opnieuw
    // 400/401: stem is ongeldig of box uitgeschakeld → niet blijven proberen
    if (code == 401) melding = "Box niet herkend, opnieuw installeren";
  }
  schrijfRij(rest);
  return rest.length() == 0;
}

String nieuwId() { char b[17]; snprintf(b, sizeof b, "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random()); return b; }

// ============================================================ seriële installatie (roboshift.nl/echo/tap)
void info() {
  JsonDocument d;
  d["versie"] = ECHO_VERSIE; d["mac"] = WiFi.macAddress(); d["ingesteld"] = ingesteld();
  d["box"] = cfg.box; d["naam"] = cfg.naam; d["ssid"] = cfg.ssid; d["batterij"] = batterijMv(); d["wachtrij"] = telRij(leesRij());
  Serial.print("ECHO-INFO "); serializeJson(d, Serial); Serial.println();
}

void test() {
  Serial.println("ECHO-STAP wifi");
  WiFi.disconnect(); wifiKanaal = 0;
  wifiReden = 0;
  bool ok = wifiAan(15000);
  if (!ok) {  // tweede poging met minder zendvermogen (helpt bij sommige ESP32-S3-bordjes)
    Serial.printf("ECHO-STAP wifi2 %d\n", (int)wifiReden);
    WiFi.disconnect(true); delay(200); WiFi.mode(WIFI_STA); WiFi.setTxPower(WIFI_POWER_8_5dBm);
    ok = wifiAan(15000);
  }
  if (!ok) {
    Serial.printf("ECHO-FOUT wifi %d %d\n", (int)WiFi.status(), (int)wifiReden);
    // laat zien welke netwerken de box wel ziet
    WiFi.disconnect(); delay(100);
    int n = WiFi.scanNetworks();
    JsonDocument d; JsonArray a = d.to<JsonArray>();
    for (int i = 0; i < n && i < 15; i++) {
      JsonObject o = a.add<JsonObject>();
      o["ssid"] = WiFi.SSID(i); o["rssi"] = WiFi.RSSI(i); o["kanaal"] = WiFi.channel(i); o["beveiliging"] = (int)WiFi.encryptionType(i);
    }
    Serial.print("ECHO-NETWERKEN "); serializeJson(d, Serial); Serial.println();
    WiFi.scanDelete();
    melding = "Wifi lukt niet"; opnieuwTekenen = true; return;
  }
  Serial.printf("ECHO-STAP server %d\n", WiFi.RSSI());
  JsonDocument b, a;
  int code = post(b, a);
  if (code == 200) {
    bewaarServerCfg(a["instellingen"]);
    Serial.printf("ECHO-KLAAR %d\n", WiFi.RSSI());
    melding = "Verbonden met Echo"; tril(80);
    scherm = cfg.tafelVragen ? S_TAFEL : S_GAST;
  } else {
    Serial.printf("ECHO-FOUT server %d\n", code);
    melding = "Server: fout " + String(code);
  }
  opnieuwTekenen = true;
}

void verwerkSerieel() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (buf.length() < 1500) buf += c; continue; }
    String regel = buf; buf = "";
    laatsteActie = millis();
    if (regel == "ECHO?") info();
    else if (regel == "ECHO-TEST") test();
    else if (regel == "ECHO-WIS") {
      prefs.begin("echo", false); prefs.clear(); prefs.end();
      Serial.println("ECHO-OK"); delay(200); ESP.restart();
    } else if (regel.startsWith("ECHO-CFG ")) {
      JsonDocument d;
      if (deserializeJson(d, regel.substring(9))) { Serial.println("ECHO-FOUT json"); continue; }
      prefs.begin("echo", false);
      for (const char *k : { "ssid", "pass", "box", "sleutel", "url", "naam" })
        if (d[k].is<const char *>()) prefs.putString(k, (const char *)d[k]);
      prefs.end();
      laadCfg();
      Serial.println("ECHO-OK");
      test();
    }
  }
}

// ============================================================ slapen
void slaap() {
  Serial.println("ECHO-SLAAP");
  Serial.flush();
  for (int i = cfg.helderheid; i > 0; i -= 6) { achtergrondlicht(i); delay(12); }
  achtergrondlicht(0);
  panel->displayOff();
  trilUit();
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  // touch-chip blijft aan en wekt ons via INT (laag bij aanraking)
  pinMode(LCD_BL, OUTPUT); digitalWrite(LCD_BL, LOW); gpio_hold_en((gpio_num_t)LCD_BL);
  digitalWrite(TP_RST, HIGH); gpio_hold_en((gpio_num_t)TP_RST);
  gpio_deep_sleep_hold_en();
  rtc_gpio_pullup_en((gpio_num_t)TP_INT); rtc_gpio_pulldown_dis((gpio_num_t)TP_INT);
  // wacht tot de vinger los is, anders worden we meteen weer wakker
  uint32_t t0 = millis(); while (digitalRead(TP_INT) == LOW && millis() - t0 < 3000) delay(10);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)TP_INT, 0);
  esp_deep_sleep_start();
}

// ============================================================ stemmen
void stem(int score) {
  scherm = S_BEDANKT;
  tekenBedankt(score); gfx->flush();
  tril(90); delay(90); tril(140);
  uint32_t t0 = millis();
  time_t nu = time(nullptr);
  String regel = nieuwId() + ";" + score + ";" + (cfg.tafelVragen ? String(tafel) : String("")) + ";" + (nu > 1700000000 ? (uint32_t)nu : 0);
  zetInRij(regel);        // eerst bewaren, dan versturen: zo gaat er nooit een stem verloren
  verstuurRij();
  while (millis() - t0 < 3500) delay(20);  // "Bedankt" minstens 3,5 s laten staan
  gestemd = true;
  slaap();
}

// ============================================================ setup / loop
void setup() {
  Serial.begin(115200);
  esp_sleep_wakeup_cause_t wek = esp_sleep_get_wakeup_cause();
  gpio_deep_sleep_hold_dis();
  gpio_hold_dis((gpio_num_t)LCD_BL); gpio_hold_dis((gpio_num_t)TP_RST);
  if (wek == ESP_SLEEP_WAKEUP_EXT0) rtc_gpio_deinit((gpio_num_t)TP_INT);

  Wire.begin(TP_SDA, TP_SCL, 400000);
  pinMode(TP_INT, INPUT_PULLUP);
  if (wek != ESP_SLEEP_WAKEUP_EXT0) {  // alleen na stroom aan: touch-chip resetten
    pinMode(TP_RST, OUTPUT);
    digitalWrite(TP_RST, LOW); delay(10); digitalWrite(TP_RST, HIGH); delay(50);
  } else { pinMode(TP_RST, OUTPUT); digitalWrite(TP_RST, HIGH); }
  pinMode(ENC_A, INPUT_PULLUP); pinMode(ENC_B, INPUT_PULLUP);
  analogReadResolution(12);
  ledcAttach(LCD_BL, 50000, 8);
  achtergrondlicht(0);
  trilInit();

  gfx->begin(40000000);  // 40 MHz: 80 MHz geeft soms een kapotte init op dit bord
  gfx->setUTF8Print(true);
  gfx->fillScreen(rgb(C_BG)); gfx->flush();

  laadCfg();
  if (cfg.tafelVan <= tafel && tafel <= cfg.tafelTot) {} else tafel = cfg.tafelVan;
  if (!ingesteld()) scherm = S_INSTALLEER;
  else if (gestemd) scherm = S_AL_GESTEMD;
  else scherm = cfg.tafelVragen ? S_TAFEL : S_GAST;
  teken();
  achtergrondlicht(cfg.helderheid);
  xTaskCreatePinnedToCore(ringTaak, "ring", 2048, nullptr, 2, nullptr, 0);
  laatsteActie = millis();
  delay(300);
  info();  // laat de installatiepagina weten dat we er zijn

  // eerdere stemmen die nog niet weg zijn: alleen bij de bediening proberen (niet als de gast kijkt)
  if (scherm == S_TAFEL && telRij(leesRij()) > 0) {
    melding = "Stemmen versturen..."; teken();
    melding = verstuurRij() ? "" : String(telRij(leesRij())) + " stem(men) wachten op wifi";
    opnieuwTekenen = true;
  }
}

void loop() {
  verwerkSerieel();
  uint32_t nu = millis();

  // ---------- ring ----------
  int d = encDelta; encDelta = 0;
  if (d) {
    laatsteActie = nu;
    if (scherm == S_TAFEL) {
      tafel += d;
      if (tafel > cfg.tafelTot) tafel = cfg.tafelVan;
      if (tafel < cfg.tafelVan) tafel = cfg.tafelTot;
      melding = ""; opnieuwTekenen = true;
    } else if (scherm == S_GAST) {
      gekozen = gekozen < 0 ? 2 : constrain(gekozen + (d > 0 ? 1 : -1), 0, 4);
      opnieuwTekenen = true;
    }
  }

  // ---------- touch: tik bij loslaten, vasthouden = bediening ----------
  static bool vinger = false; static int16_t tx, ty; static uint32_t neer = 0; static bool lang = false;
  int16_t x, y;
  bool nuVinger = leesTouch(x, y);
  if (nuVinger) {
    laatsteActie = nu;
    if (!vinger) { vinger = true; neer = nu; lang = false; }
    tx = x; ty = y;
    if (!lang && nu - neer > 2000 && (scherm == S_AL_GESTEMD || scherm == S_GAST)) {
      lang = true; gestemd = false; gekozen = -1; melding = "";
      scherm = cfg.tafelVragen ? S_TAFEL : S_GAST; tril(60); opnieuwTekenen = true;
    }
  } else if (vinger) {
    vinger = false;
    if (!lang) {
      if (scherm == S_TAFEL) {
        if (binnen(tx, ty, 58, 175, 76, 76)) { tafel = tafel <= cfg.tafelVan ? cfg.tafelTot : tafel - 1; opnieuwTekenen = true; }
        else if (binnen(tx, ty, 302, 175, 76, 76)) { tafel = tafel >= cfg.tafelTot ? cfg.tafelVan : tafel + 1; opnieuwTekenen = true; }
        else if (binnen(tx, ty, CX, 268, 190, 70)) { scherm = S_GAST; gekozen = -1; tril(40); opnieuwTekenen = true; }
      } else if (scherm == S_GAST) {
        int raak = -1;
        for (int i = 0; i < 5; i++) if (abs(tx - FX[i]) <= 32 && abs(ty - FY) <= 40) raak = i;
        if (raak >= 0) { stem(raak + 1); return; }
        if (gekozen >= 0 && ty > 215) { stem(gekozen + 1); return; }  // "Kiezen" of onder de gezichtjes
      }
    }
  }

  if (opnieuwTekenen) teken();

  // ---------- slapen als er niets gebeurt ----------
  uint32_t stil = nu - laatsteActie;
  uint32_t grens = scherm == S_GAST ? (uint32_t)cfg.slaapNaMin * 60000UL
                 : scherm == S_TAFEL ? 90000UL
                 : scherm == S_AL_GESTEMD ? 8000UL
                 : 10UL * 60000UL;  // installeren
  if (stil > grens) slaap();
  delay(15);
}
