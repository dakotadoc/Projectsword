# Holy Grail War Simulator — Design Doc

Personal, non-distributed parody fan project inspired by the Fate series. Text-based, turn-based web game that runs in the browser.

Read this file at the start of every session. When a decision here changes, update this file in the same session.

---

## 1. Core concept

The player is born into a random time, place, and family. They spend a short life phase building their character and hunting for a summoning catalyst. Then a Holy Grail War begins: they summon a Servant and fight rival Masters, day by day, until one pair is left or they die.

Pillars:
1. **Every run is different.** Random birth, random rivals, random events.
2. **Information is power.** Rival Masters and Servants start hidden. Learning about them unlocks options.
3. **The Servant is a character, not a weapon.** The player talks with their Servant in free-form, AI-driven conversation, and Bond matters mechanically and narratively.

---

## 2. Tech rules

- Plain HTML, CSS, and JavaScript (ES modules). No framework, no build step.
- Must run by opening `index.html` through a simple local server, and must also work when published as a single web page with its data files beside it.
- **All content lives in `/data/*.json`**: servants, catalysts, events, birthplaces, families, rival templates. Code must never hard-code content.
- **All game state lives in one object** (`state`), saved to and loaded from localStorage as JSON. Add an Export/Import save button (copy/paste JSON text).
- Randomness goes through one seeded RNG function (`rng.js`), so a run can be replayed from its seed for debugging.
- Keep files small and focused: one system per file in `/src/`.
- Text-first UI: a scrolling log of narration, plus buttons for the current choices. Mobile-friendly.
- **AI servant chat is a core feature.** The game will be published as a Claude artifact, where the page can ask Claude directly (no API key or server needed). All AI calls go through one module, `ai.js`. For local testing, `ai.js` must have a stub mode that returns canned in-character replies, so the rest of the game can be built and tested without AI access.
- **Run locally:** from the repo folder, `python3 -m http.server`, then open http://localhost:8000. (ES modules don't load from `file://`.)

### Artifact sandbox limits (checked in milestone 1)
The published page runs in a sandboxed frame. Design around these:
- `alert`, `confirm`, `prompt`, and file downloads are blocked. All dialogs are built in-page (`ui.showDialog`, `ui.confirmDialog`); Export is a text box with a Copy button.
- localStorage may be missing or throw. Saves go through `storage.js` (async), which falls back to memory and warns the player. Planned: swap it for the artifact's per-person `db` capability when publishing. Export/Import is the guaranteed backup.
- Asking Claude uses the artifact's `sample` capability (`claude.use("sample")`, which can return JSON). `ai.js` wraps it; it may return `null` (unavailable) or reject (`not_granted`, `rate_limited`), which triggers the `dialogue.json` fallback.
- All displayed text (data files, AI replies) is set with `textContent`, never `innerHTML`.
- Fetching the game's own files by relative path works; fetching other sites is blocked.

### Code conventions
- UI chrome (button labels like "Export", dialog titles) may live in code. Narrative content (places, events, Servant lines, flavor text) lives in `/data`.
- Never call `Math.random()`; use the helpers in `rng.js` (`random`, `randInt`, `chance`, `pick`, `weightedPick`, `shuffle`). The RNG's position is saved in `state.rng`, so loading continues the same sequence and the same seed replays the same rolls. (AI replies are not deterministic, so seed replay diverges once chat affects the game.)
- `state` must stay plain JSON. Bump `SAVE_VERSION` in `state.js` when its shape changes incompatibly, and add a migration there.
- Every in-run screen registers in `screens` in `main.js` and receives `{ resumed }` so Continue/Import can re-enter it without repeating its intro text.

Suggested structure:
```
index.html
style.css
/src
  main.js        // boot, screen routing
  state.js       // state shape, save/load/export
  storage.js     // where saves are kept (localStorage now, artifact db later)
  rng.js         // seeded random
  data.js        // loads and checks /data/*.json at startup
  ranks.js       // E–A/EX rank letters and their numeric values
  birth.js       // phase 1
  life.js        // phase 2
  summon.js      // phase 3
  war.js         // phase 4 day loop
  combat.js      // battle system
  intel.js       // hidden info system
  rivals.js      // rival Master AI
  events.js      // random event engine
  servantTalk.js // conversation system (builds context, applies bond changes)
  ai.js          // the only place AI is called; real + stub modes
  ui.js          // log, buttons, panels
/data
  rules.json   // tuning numbers (life start age, war age range, mana per circuit rank)
  places.json  eras.json  families.json  traits.json
  catalysts.json  servants.json
  events.json  rivals.json  dialogue.json
```

---

## 3. Game phases

### Phase 1: Birth (one screen, all random)
Rolled once, shown as a "birth certificate" summary:
- **Place and era.** Weighted pick from `places.json` and `eras.json` (modern eras only). The place is also where the war happens. The era sets when the war will happen (the war takes place when the player is roughly 18–25).
- **Family.** Old mage lineage, minor mage family, fallen mage family, or non-mage. Sets starting stats, money, and connections.
- **Magic Circuits.** Quantity and quality, each ranked E–A (with rare EX). Sets the mana pool and spell potential.
- **Trait.** One random quirk (e.g. "Lucky," "Sickly," "Prodigy," "Black sheep").

### Phase 2: Life (about 8–10 turns, roughly 1–2 years each, starting at age 5)
Each turn the player picks one action:
- **Train body.** Raises Body.
- **Study magecraft.** Raises Magecraft (gains scale with circuit quality).
- **Study the world.** Raises Mind.
- **Socialize or network.** Raises Charisma and may create contacts.
- **Search for relics.** A chance to find a catalyst, weighted by place and family.

Each turn also rolls a life event from `events.json` (phase: "life"). Some events offer choices.
Ends with a summary and the war announcement: Command Seals appear on the player's hand.

### Phase 3: Summoning
- If the player holds a catalyst, it maps to a specific Servant (or a short list).
- With no catalyst, the Servant is matched by the player's stats and trait ("compatibility summon").
- Show a summoning scene, then the Servant's profile. Its true name is known to the player, hidden from rivals.

### Phase 4: The War (day by day, default 14 days)
Each day has two slots:
- **Day action:** rest, train with Servant, gather intel, prepare a workshop or traps, or talk to the Servant.
- **Night action:** patrol, scout a known location, ambush a known Master, or stay hidden.

Each day also rolls 0–2 war events (phase: "war"). Rival Masters act on their own each day (see section 7).
A night action can trigger a battle.

### Phase 5: Endgame
- Win: the last pair standing reaches the Grail, and the player makes a wish (an ending chosen from a few options).
- Lose: Servant defeated (the player may flee to the Church) or Master killed.
- Show a run summary: days survived, enemies defeated, true names learned, final bond.

---

## 4. Stats

**Master stats** (numbers 0–100): Body, Magecraft, Mind, Charisma.
**Master resources:** mana (max set by circuits), Command Seals (3), money, contacts.

**Servant stats:** Strength, Endurance, Agility, Mana, Luck, Noble Phantasm, each ranked E–A/EX. Ranks convert to numbers in combat (E=1 … A=5, EX=6).
**Servant also has:** class, HP, 2–3 skills, one Noble Phantasm, personality tags, Bond (0–100), and a weakness tied to its true name.

---

## 5. Hidden information (intel system)

Each rival has an **intel level** for the Master and for the Servant:

| Level | Player knows | Unlocks |
|---|---|---|
| 0 | Nothing (they exist) | — |
| 1 | Servant class, Master's rough location | Scout and ambush options |
| 2 | Servant stat ranks, Master's base | Targeted attack, avoid them |
| 3 | Servant true name and Noble Phantasm | Weakness exploit, counter strategies |

Intel is gained through: scouting, surviving a battle, war events, contacts, and Mind checks.
The UI must only show what the player knows. Unknown values display as "???".

---

## 6. Combat

Turn-based. Each round:
1. The player picks a **Servant action**: Attack, Defend, Skill, or Noble Phantasm (costs Master mana; big damage; reveals the true name to the enemy).
2. The player picks an optional **Master action**: support spell, heal, observe (intel), or use a Command Seal.
3. The enemy (rival AI) picks its actions.
4. Resolve by Agility order and print the results to the log.

**Command Seals** (3 per war): emergency boost, forced teleport/escape, or an absolute order. Using all 3 is risky (the Servant may leave if Bond is low).
**Retreat** is always an option, with a chance to fail.
Rival Masters can be targeted directly: killing a Master removes their Servant.

---

## 7. Rival Masters (AI)

6 rivals per war, generated from `rivals.json` templates, each with a Servant and a **personality**: aggressive, cautious, schemer, honorable, or reckless.

Each day, each rival picks one action by simple weighted rules based on personality, HP, and what it knows: hunt, scout, fortify, ally, or hide.
Rivals can fight each other off-screen. Results arrive as news or rumors ("A massive explosion was reported downtown last night").
Keep the AI rule-based and readable. No complex simulation.

---

## 8. Servant relationship

- **Bond** (0–100) rises with conversations, shared victories, and choices that match the Servant's personality. It falls with Command Seal abuse and choices it dislikes.
- Bond unlocks: bonus combat stats, special events, the Servant's backstory, and a better ending.
### AI conversation (core feature)
- The player can open a chat with their Servant during any Day action slot (and after major events). The player types freely; the Servant replies in character.
- **Each reply is generated with this context:**
  - The Servant's profile from `servants.json`: personality, speech style, backstory, wish, likes and dislikes.
  - The Master's profile: name, family, stats, trait.
  - A short **run summary**: current day, recent battles, intel gained, Command Seals used, current Bond level.
  - The last ~10 chat messages.
- **Rules for the AI** (included in every request): stay in character; never reveal information the player doesn't know (rival true names, hidden intel); keep replies to 1–4 short paragraphs; never break the fourth wall.
- **Mechanical effects:** after each conversation, ask the AI for a small structured verdict (e.g. `{"bond": +3, "mood": "pleased"}`), clamped to a safe range (−5 to +5 per conversation), so talking matters without being exploitable.
- **Memory:** after each conversation, ask the AI for a 1–2 sentence summary and store it in `state.servant.memories`. Include the most recent memories in future context so the Servant remembers past talks.
- **Event dialogue:** random Servant events (section 3) also use AI to write the Servant's lines, with the event as context.
- **Fallback:** if AI is unavailable or errors, use short pre-written lines from `dialogue.json` and tell the player that chat is offline.
- All of this lives behind `getServantReply(context, playerText)` in `servantTalk.js`, which calls `ai.js`.

---

## 9. Build order (one milestone at a time; play-test and commit after each)

1. **Skeleton.** Screens, text log, buttons, state object, save/load/export, seeded RNG. *(Done. Includes a temporary "Skeleton test" screen in `main.js` that milestone 2 replaces with the birth screen.)*
2. **Birth.** Data files for places, eras, and families; the birth screen. *(Done. Life phase is a placeholder screen until milestone 3.)*
3. **Life phase.** Turn loop, stat actions, life events, catalyst finding.
4. **Summoning.** 7 Servants (one per class) with full personality profiles for AI chat, 5 catalysts, compatibility fallback.
5. **Servant chat.** Chat screen, `ai.js` with stub mode, context building, bond verdicts, conversation memories. Publish a test build as a Claude artifact to confirm real AI replies work.
6. **War loop.** Day/night slots, war events, chat available in Day slots.
7. **Intel system.** Rival generation, intel levels, "???" display. Make sure chat context respects intel.
8. **Combat.** Basic attack/defend, then skills, Noble Phantasms, Command Seals, retreat.
9. **Rival AI.** Daily actions, off-screen fights, news.
10. **Bond effects.** Bond bonuses in combat, AI-written Servant event dialogue, fallback lines.
11. **Endgame and run summary.**
12. **Polish.** Balance pass, more events, more Servants, tune chat prompts.

---

## 10. Working rules for Claude

- Before a big feature: explain the plan and ask questions before writing code.
- Build only the milestone asked for. Don't add features that weren't requested.
- After changes, say what to test and how.
- Keep content in data files; when adding a system, include 3–5 sample entries so it can be play-tested.
- When fixing a bug, explain the cause in one or two plain sentences.

---

## 11. Decisions made

- **Era range:** modern only (1900s–2000s) for v1.
- **War location:** the war takes place in the player's birthplace. `places.json` entries serve as both birthplace and war city.
- **Life phase:** the first life turn begins at age 5.
- **War age:** rolled at birth (18–25, `rules.json`). The era picks the war year; birth year = war year − war age. Life turns (milestone 3) stretch so the last one ends at the war age. Because the war year is in the era, births can fall slightly before 1900.
- **Names:** the Master's name is rolled from the birthplace's name lists.
- **Traits** live in `traits.json`. `effects` applies stat/money/contact changes at birth; traits with no effects (e.g. Lucky) are checked by id in later systems.
- **Circuit ranks** are rolled from each family's `circuitWeights`. Max mana = quantity rank value × `manaPerCircuitRank`.
- **Published build:** the game is published as a private Claude artifact (Holy Grail War Simulator, https://claude.ai/artifact/4YZpAUQVQsMQJrANufHYYK). Republish its files after each milestone, including any new `/data` files.

## 12. Open questions (decide before or during the build)

- War length: fixed at 14 days, or end when only one pair remains?
- Can the player die in the life phase, or is it always safe?
- Which 7 Servants for version 1?
- Can the player ally with a rival (and betray them)?
- Permadeath, or save-anywhere?
- Should the Servant ever start a conversation on its own (e.g. after a big battle)?
