#!/usr/bin/env node
/* Zeugen-Script: spiegelt die Bitcoin-Anker von absolutely.cool append-only.
   Läuft täglich als GitHub Action UND lokal — identische Kanonisierung.

   Semantik (append-only Zeuge):
   - Neuer Anker  -> anchors/anchor-<id>.json (unveränderliche Felder, sortiert)
                     + anchors/anchor-<id>.ots (erster gesehener Proof).
   - Bestätigter Anker -> zusätzlich anchors/anchor-<id>.confirmed.ots (einmalig).
   - Existierende Dateien werden NIE überschrieben. Weicht ein bereits bezeugter
     Anker von der API ab -> TAMPER-ALARM (Exit 1, Workflow rot): jemand hat
     versucht, die Historie auszutauschen.                                        */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const URL = "https://ipezcnngfcrtyvauwmlc.supabase.co"; // öffentlich
const KEY =
  "sb_publishable_UmHkJhavyx1nkrFqN2y97g_oqceq6EM"; // publishable/anon — öffentlich per Design

const res = await fetch(`${URL}/rest/v1/anchor_log?select=*&order=id.asc`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`API nicht erreichbar: HTTP ${res.status}`);
  process.exit(2);
}
const anchors = await res.json();
mkdirSync("anchors", { recursive: true });

const CANON_KEYS = [
  "entry_count", "from_integrity_id", "id", "merkle_root", "mod_count",
  "mod_from_id", "mod_to_id", "stamped_at", "stamped_digest", "to_integrity_id",
];
const canon = (a) =>
  JSON.stringify(Object.fromEntries(CANON_KEYS.map((k) => [k, a[k] ?? null])), CANON_KEYS, 2) + "\n";
const otsBytes = (a) => Buffer.from(String(a.ots_proof).replace(/^\\x/, ""), "hex");

let added = 0, alarms = 0;
for (const a of anchors) {
  const jsonPath = `anchors/anchor-${a.id}.json`;
  const c = canon(a);
  if (existsSync(jsonPath)) {
    if (readFileSync(jsonPath, "utf8") !== c) {
      console.error(`TAMPER-ALARM: Anker ${a.id} weicht von der bezeugten Kopie ab!`);
      alarms++;
    }
  } else {
    writeFileSync(jsonPath, c);
    writeFileSync(`anchors/anchor-${a.id}.ots`, otsBytes(a));
    console.log(`bezeugt: Anker ${a.id}`);
    added++;
  }
  if (a.ots_upgraded && !existsSync(`anchors/anchor-${a.id}.confirmed.ots`)) {
    writeFileSync(`anchors/anchor-${a.id}.confirmed.ots`, otsBytes(a));
    console.log(`bestätigt: Anker ${a.id} (Bitcoin-Block ${a.bitcoin_block_height})`);
    added++;
  }
}
console.log(`Fertig: ${anchors.length} Anker geprüft, ${added} Datei(en) neu, ${alarms} Alarm(e).`);
process.exit(alarms > 0 ? 1 : 0);
