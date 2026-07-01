# absolutely.cool — Transparenz-Zeuge

Dieses Repository ist der **unabhängige Zeuge** der Bewertungs-Integrität von
[absolutely.cool](https://absolutely.cool): Es spiegelt jeden **Bitcoin-Anker**
der Plattform **append-only** — inklusive der OpenTimestamps-Beweise (`.ots`).

## Warum gibt es das?

absolutely.cool versiegelt jede freigegebene Bewertung und jedes
Moderations-Ereignis in kryptografischen Hash-Ketten und verankert deren
Merkle-Root regelmäßig in der Bitcoin-Blockchain (via
[OpenTimestamps](https://opentimestamps.org)). Die Anker sind zusätzlich
**kreuzverkettet**: `stamped_digest = sha256(prev_root ‖ root)`.

Dieses Repo löst das letzte „vertrau uns"-Problem: Selbst wenn jemand die
Plattform-Datenbank komplett übernehmen, die Historie umschreiben und frisch
neu verankern würde — die **hier bezeugten Original-Anker** (mit eigener
GitHub-Commit-Historie) würden den Austausch öffentlich beweisbar machen.
Der tägliche Workflow schlägt in dem Fall **Tamper-Alarm** (roter Lauf).

## Regeln (append-only)

- `anchors/anchor-<id>.json` — unveränderliche Anker-Felder (kanonisch sortiert)
- `anchors/anchor-<id>.ots` — der zuerst gesehene OpenTimestamps-Beweis
- `anchors/anchor-<id>.confirmed.ots` — der Bitcoin-bestätigte Beweis (einmalig)
- Bestehende Dateien werden **niemals** überschrieben. Abweichung ⇒ Alarm.

## Selbst prüfen

```bash
# 1. Beweis gegen Bitcoin verifizieren (digest = stamped_digest aus der .json):
ots verify -d <stamped_digest> anchors/anchor-<id>.ots

# 2. Kompletter Audit (Hash-Ketten, Merkle-Root, Kreuzverkettung, Proof) mit dem
#    Referenz-Tool der Plattform — nutzt nur öffentliche Endpunkte:
node scripts/verify-anchor.mjs <id>
```

Alle Rohdaten sind öffentlich: Anker-Register unter
[absolutely.cool/transparenz](https://absolutely.cool/transparenz), Hash-Blätter
via öffentlicher API (`chain_leaves`, `moderation_events`) — PII-frei, nur Hashes.

*Keine Bewertung kann gekauft, heimlich geändert oder heimlich gelöscht werden —
kein Unternehmen, kein Hacker, auch wir nicht. Das hier ist der Beweis.*
