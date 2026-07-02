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

/* Leaves-Snapshots (Proof-Custody-Rest aus §15-P1): Ohne die Blätter wäre ein
   verankerter Root zwar beweisbar, aber nicht mehr NACHRECHENBAR, falls die
   Primär-DB verloren geht. Darum bezeugen wir pro Anker auch die Hash-Blätter
   beider Ketten (PII-frei, append-only, gleicher Tamper-Check). */
const rpc = async (fn, body) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status}`);
  return r.json();
};

const reviewLeaves = async (from, to) => {
  const out = [];
  let cursor = from;
  while (cursor <= to) {
    const page = await rpc("chain_leaves", { p_from: cursor, p_to: to });
    if (!page.length) break;
    out.push(...page);
    cursor = page[page.length - 1].integrity_id + 1;
  }
  return out.map((l) =>
    JSON.stringify({
      integrity_id: l.integrity_id, tenant_id: l.tenant_id,
      content_hash: l.content_hash, prev_hash: l.prev_hash, chain_hash: l.chain_hash,
    }),
  ).join("\n") + "\n";
};

const modLeaves = async (from, to) => {
  const r = await fetch(
    `${URL}/rest/v1/moderation_events?select=id,tenant_id,content_hash,prev_hash,chain_hash&id=gte.${from}&id=lte.${to}&order=id.asc`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!r.ok) throw new Error(`moderation_events: HTTP ${r.status}`);
  const rows = await r.json();
  const hex = (v) => String(v).replace(/^\\x/, "");
  return rows.map((l) =>
    JSON.stringify({
      id: l.id, tenant_id: l.tenant_id,
      content_hash: hex(l.content_hash), prev_hash: hex(l.prev_hash), chain_hash: hex(l.chain_hash),
    }),
  ).join("\n") + "\n";
};

const witnessFile = (path, content, label) => {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      console.error(`TAMPER-ALARM: ${label} weicht von der bezeugten Kopie ab!`);
      return { alarm: true, added: false };
    }
    return { alarm: false, added: false };
  }
  writeFileSync(path, content);
  console.log(`bezeugt: ${label}`);
  return { alarm: false, added: true };
};

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

  // Blätter des Anker-Fensters bezeugen (Review-Kette + Moderations-Kette).
  try {
    if (a.from_integrity_id != null && a.to_integrity_id != null) {
      const r = witnessFile(
        `anchors/anchor-${a.id}.leaves.jsonl`,
        await reviewLeaves(a.from_integrity_id, a.to_integrity_id),
        `Blätter Anker ${a.id} (Reviews ${a.from_integrity_id}–${a.to_integrity_id})`,
      );
      if (r.alarm) alarms++;
      if (r.added) added++;
    }
    if (a.mod_from_id != null && a.mod_to_id != null && a.mod_count > 0) {
      const r = witnessFile(
        `anchors/anchor-${a.id}.modleaves.jsonl`,
        await modLeaves(a.mod_from_id, a.mod_to_id),
        `Mod-Blätter Anker ${a.id} (Events ${a.mod_from_id}–${a.mod_to_id})`,
      );
      if (r.alarm) alarms++;
      if (r.added) added++;
    }
  } catch (e) {
    // Blätter-Snapshot ist Zusatz-Custody: Fehler loggen, Anker-Zeugnis bleibt gültig.
    console.error(`Leaves-Snapshot Anker ${a.id} übersprungen: ${e.message}`);
  }
}
console.log(`Fertig: ${anchors.length} Anker geprüft, ${added} Datei(en) neu, ${alarms} Alarm(e).`);
process.exit(alarms > 0 ? 1 : 0);
