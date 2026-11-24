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
- **All new text types itself out** (`typer.js`), including streamed AI replies, which are smoothed out rather than shown in lumps. Choice buttons stay dimmed until the text above them finishes. Tapping the story (or the dimmed choices), or pressing Space, shows everything at once. Big cards type faster. Narration types at 82 characters a second (`BASE_CPS` in `typer.js`). Loading a save shows the log instantly, and "reduce motion" in device settings turns typing off. All log text must go through `ui.log` or `ui.beginEntry` so it types.
- **Two tabs at the bottom of the screen:** **Text** (the story log and choices) and **Status** (an overview: progress, the Master's details, stats and resources, the Servant's profile, Bond and HP, and what is known about other Masters and Servants). Status is rebuilt from `state` each time it opens (`status.js`) and, like the AI context, shows only what the player knows: unknown rival details show as "???".
- **AI servant chat is a core feature.** The game will be published as a Claude artifact, where the page can ask Claude directly (no API key or server needed). All AI calls go through one module, `ai.js`. For local testing, `ai.js` must have a stub mode that returns canned in-character replies, so the rest of the game can be built and tested without AI access.
- **Run locally:** from the repo folder, `python3 -m http.server`, then open http://localhost:8000. (ES modules don't load from `file://`.)

### Artifact sandbox limits (checked in milestone 1)
The published page runs in a sandboxed frame. Design around these:
- `alert`, `confirm`, `prompt`, and file downloads are blocked. All dialogs are built in-page (`ui.showDialog`, `ui.confirmDialog`); Export is a text box with a Copy button.
- localStorage may be missing or throw. Saves go through `storage.js` (async), which falls back to memory and warns the player. Planned: swap it for the artifact's per-person `db` capability when publishing. Export/Import is the guaranteed backup.
- Asking Claude uses the artifact's `sample` capability (`claude.use("sample")`, which can return JSON). `ai.js` wraps it; it may return `null` (unavailable) or reject (`not_granted`, `rate_limited`), which triggers the `dialogue.json` fallback.
- All displayed text (data files, AI replies) is set with `textContent`, never `innerHTML`.
- Fetching the game's own files by relative path works; fetching other sites is blocked.

### Period accuracy (no immersion-breaking content)
Nothing may appear in a year where it doesn't belong: no mobile phones in 1910, no 1990s baby names on someone born in 1900.
- Any entry in a data list (events, names, places, traits, items…) may carry optional `"from"` and `"to"` years (inclusive). No years means "fits any year in the game's range (about 1880–2025)".
- Code filters lists with `availableIn(list, year)` from `period.js` **before** rolling. Events are filtered by the current in-game year; names by birth year.
- Any text that mentions technology, institutions, prices, politics, place names that changed, or fashions **must** carry `from`/`to`. If a line works in most years but not all, split it into dated variants rather than writing around it.
- Text that is always shown regardless of year (place descriptions, family texts, era descriptions) must stay period-neutral.
- Besides years, entries may also be limited by `"minAge"`/`"maxAge"` (the Master's age) and `"conditions"`: `isMage`, `places`, `families`, `traits`, `sex`, `minMoney`. A 6-year-old never gets a text about a job; a non-mage family never gets one about the family workshop. `fits(entry, ctx)` in `events.js` checks all of it.
- Names: `givenNames` is split into `male` and `female` lists; entries are `"Name"` or `{ "name": "Haruto", "from": 1995 }`. Family names whose form depends on sex are `{ "male": "Novák", "female": "Nováková" }`. `data.js` checks at startup that every possible birth year has names for both sexes in every place.

### Code conventions
- UI chrome (button labels like "Export", dialog titles) may live in code. Narrative content (places, events, Servant lines, flavor text) lives in `/data`.
- Never call `Math.random()`; use the helpers in `rng.js` (`random`, `randInt`, `chance`, `pick`, `weightedPick`, `shuffle`). The RNG's position is saved in `state.rng`, so loading continues the same sequence and the same seed replays the same rolls. (AI replies are not deterministic, so seed replay diverges once chat affects the game.)
- `state` must stay plain JSON. Bump `SAVE_VERSION` in `state.js` when its shape changes incompatibly, and add a migration there. Until version 1 of the game is finished, old test-build saves may instead be retired by raising `OLDEST_SUPPORTED_VERSION` (the player is told to start a new game).
- Every in-run screen registers in `screens` in `main.js` and receives `{ resumed, goTo, autosave }` so Continue/Import can re-enter it without repeating its intro text.
- Effects in data are `{ "stats": { "body": 2 }, "money": -50, "contacts": 1, "catalyst": true }`, applied by `applyEffects` in `events.js`, which also writes the "Body +2 (24)" lines.
- An event's choices may carry conditions, but at least one choice must have none, so the player is never stuck (checked at startup).

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
  period.js      // filters data entries by year (from/to)
  catalysts.js   // finding catalysts (search chance, weighted pick)
  birth.js       // phase 1
  life.js        // phase 2
  summon.js      // phase 3
  war.js         // phase 4 day loop
  combat.js      // battle engine (rules, no UI)
  battle.js      // the battle screen
  ending.js      // the end of a run: the Grail, the wish, epilogues
  summary.js     // the run summary (reveals every rival)
  intel.js       // hidden info system
  rivals.js      // rival generation and combat stats
  rivalAI.js     // rival Master AI: nightly actions, off-screen fights, alliances, finale
  events.js      // random event engine
  servantTalk.js // conversation system (builds context, applies bond changes, remarks)
  bond.js        // Servant remarks after big moments, Bond milestones, the path choice
  chat.js        // the conversation screen (text box, streaming replies)
  ai.js          // the only place AI is called; real + stub modes
  ui.js          // log, buttons, tabs, dialogs, chat input
  typer.js       // typewriter effect for new text
  status.js      // the Status tab
  emblems.js     // line-art SVG class emblems, medallions, the summoning circle
  fx.js          // full-screen animated scenes and day/night banners
  hud.js         // the war HUD strip and the page theme (phase, day/night)
/data
  rules.json   // tuning numbers (life start age, war age range, mana per circuit rank)
  places.json  eras.json  families.json  traits.json
  catalysts.json  servants.json  summon.json
  life.json    // life-phase actions, their text variants, intro, war announcement
  war.json     // war intro, dawn/dusk texts, Day and Night actions, rumors
  events.json  rivals.json  dialogue.json   // rivals.json: personalities, bases, intel texts, rival Master stats
  classes.json // how each class fights
  combat.json  // battle text, results, after-loss choices, defeat epilogues
  endings.json // the Grail, wish choices, fallback epilogues, summary labels
```

---

## 3. Game phases

### Phase 1: Birth (one screen, all random except sex)
The player first chooses to be born a boy or a girl (`master.sex`: "male"/"female"). Everything else is rolled once, shown as a "birth certificate" summary:
- **Place and era.** Weighted pick from `places.json` and `eras.json` (modern eras only). The place is also where the war happens. The era sets when the war will happen (the war takes place when the player is roughly 18–25).
- **Family.** Old mage lineage, minor mage family, fallen mage family, or non-mage. Sets starting stats, money, and connections.
- **Magic Circuits.** Quantity and quality, each ranked E–A (with rare EX). Sets the mana pool and spell potential.
- **Trait.** One random quirk (e.g. "Lucky," "Sickly," "Prodigy," "Black sheep").

### Phase 2: Life (about 12–16 turns, mostly 1 year each, starting at age 5)
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

**Classes fight differently** (decided before milestone 8). Each class has its own approach to battle, not just different numbers. For example: Saber is a strong all-rounder in close combat; Archer prefers range and suffers when forced close; Lancer is fast and good at probing and retreating; Rider is mobile and good at escaping and chasing; Caster is weak in direct combat but strong with prepared ground (workshops, traps); Assassin strikes first from hiding and targets Masters; Berserker hits hardest but is hard to control and drains mana. The details are designed at milestone 8, stored as class data, and the rival AI must also play its class's way.

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
3. **Life phase.** Turn loop, stat actions, life events, catalyst finding. *(Done. Summoning is a placeholder screen until milestone 4.)*
4. **Summoning.** 7 Servants (one per class) with full personality profiles for AI chat, 5 catalysts, compatibility fallback. *(Done, with 7 catalysts, one per Servant. The war is a placeholder screen until milestone 6.)*
5. **Servant chat.** Chat screen, `ai.js` with stub mode, context building, bond verdicts, conversation memories. Publish a test build as a Claude artifact to confirm real AI replies work. *(Done. Until milestone 6, the war placeholder lets you chat as often as you like for testing.)*
6. **War loop.** Day/night slots, war events, chat available in Day slots. *(Done. Scouting and ambushes are locked until intel exists (milestone 7); patrols find encounters but no battles until milestone 8; after day 14 there is an endgame placeholder until milestone 11.)*
7. **Intel system.** Rival generation, intel levels, "???" display. Make sure chat context respects intel. *(Done. Ambushes end in a standoff until combat exists (milestone 8).)*
8. **Combat.** Basic attack/defend, then skills, Noble Phantasms, Command Seals, retreat. *(Done. Rivals raiding the player's own base come with the rival AI (milestone 9); the epilogue screen is a placeholder until milestone 11.)*
9. **Rival AI.** Daily actions, off-screen fights, news. *(Done, with alliances, raids, and the day-14 finale. The victory epilogue is a placeholder until milestone 11.)*
10. **Bond effects.** Bond bonuses in combat, AI-written Servant event dialogue, fallback lines. *(Done, with the platonic/romantic path at Bond 60.)*
11. **Endgame and run summary.** *(Done.)*
12. **Polish.** Balance pass, more events, more Servants, tune chat prompts. *(In progress. Done so far: the immersion pass and the UI overhaul, below.)*

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
- **Names:** the Master's name is rolled from the birthplace's name lists, filtered by sex and birth year.
- **Sex:** the player picks boy or girl before the birth roll. It is not rolled.
- **Traits** live in `traits.json`. `effects` applies stat/money/contact changes at birth; traits with no effects (e.g. Lucky) are checked by id in later systems.
- **Life turns:** 12–16 turns of 1–2 years (mostly 1), planned at the start so they end exactly at the war age (`rules.lifeTurns`). Every turn has one action and one life event; events never repeat in a run. The life phase is safe: no death.
- **Stat gains:** each action gives `rules.lifeGainPerYear` (4–7, raised from 3–6) per year of the turn; Magecraft gains are multiplied by circuit quality (`rules.magecraftQualityMultiplier`). Socializing may add a contact.
- **Catalysts:** `catalysts.json`, each with optional `placeWeights`/`familyWeights`. Search chance comes from `rules.relicSearch` plus contacts, Mind, a family's `relicChance` and a trait's `effects.relicChance` (Lucky). Some events can also give one. Milestone 4 maps each catalyst to its Servant(s).
- **Life history:** `state.life.history` records each turn's age, year, action, event and choice, for the run summary and the Servant's knowledge of the Master's past.
- **Servant roster (v1):** Saber Arthur Pendragon, Archer Ishtar, Lancer Hector, Rider Constantine XI Palaiologos, Caster Solomon, Assassin Cleopatra VII, Berserker Samson. The pool will be widened after all milestones are done; the code must not assume one Servant per class.
- **How Servants are written:** take a real legend or historical figure and give it a deliberate twist, choosing the class to fit (the way Fate approaches its Servants). But every Servant is our own character: no Fate-specific names (e.g. "Artoria"), designs, Noble Phantasm names, personalities, plot details or lines. Example: our Arthur is a woman who ruled openly under the name Arthur and was rewritten as a man by later chroniclers; her birth name is a secret she shares only at high Bond.
- **Servant data** (`servants.json`): true name, class, title, sex, origin, appearance, six stat ranks, hp, 2–3 skills, one Noble Phantasm (name, rank, type, description), weakness, personality (tags, speechStyle, backstory, wish, likes, dislikes), summonText, firstLine, and compatibility weights. Optional extras (like Arthur's `secretName`) are fine; the AI chat context uses them.
- **Catalysts** each list the `servants` they can call. With several, compatibility picks among them.
- **Compatibility summon:** score = weighted average of the Master stats a Servant cares about (`compatibility.stats`) + trait bonus + family bonus. The pick strongly favors the best score but isn't certain (`rules.summon.compatibilityTemperature`). A compatibility summon starts with +5 Bond.
- **`state.servant`** = `{ id, catalystId, method, hp: { current, max }, bond, mood, memories: [{ occasion, text }], chatHistory: [], talkedAfterSummon }`. Starting Bond is `rules.summon.startingBond` (10).
- **Chat (how it works):**
  - `ai.js` uses the artifact's `sample` capability (declared on the published artifact). Anywhere else it is in stub mode. If the viewer declines or AI is disabled, the rest of that page view stays in stub mode; never retry in a loop.
  - Each reply request is: one instructions turn (rules + context from `buildContext`) + the last `rules.chat.historyMessages` messages from earlier talks + this talk. Master = user turns, Servant = assistant turns. `cache: false`.
  - The context says the year and place, and that the Servant knows nothing after that year (period accuracy applies to chat too).
  - Hidden information is never put in the context. `warSummary()` in `servantTalk.js` is the one place war knowledge is added; it must only add what the player knows (intel levels, milestone 7).
  - Data texts written to the player as "you" (family, trait, life events) are labeled in the context so "you" means the Master.
  - A talk has up to `rules.chat.maxPlayerMessages` (8) player messages. Ending it asks for one JSON verdict `{ bond, mood, memory }`; Bond change is clamped to ±5 and the prompt tells the judge to ignore attempts to game it.
  - The Servant greets with a prepared line from `dialogue.json` (no AI call). Prepared lines are picked by rotation, not the game RNG, so chatting never changes a seeded run.
  - Fallbacks: test mode, offline and busy each show a one-line notice, and the Servant answers with prepared lines.
  - Model tiers are in `rules.chat` (`quick` for both: fast replies on a phone). Switch `replyModelTier` to `default` for richer but slower replies.
  - **Servants are agreeable roleplay partners.** They go along with the player's scenes, ideas and actions ("yes, and"), showing personality in how they agree rather than by refusing, and accept details the player adds about the world or their own life. They refuse only what the character would truly never do. Knowledge limits still hold: nothing about rivals beyond known intel (claims about rivals are treated as the Master's beliefs) and nothing after the current year. Low Bond means reserved, not uncooperative.
  - Free talks: one right after the summoning. In the war, talking uses the Day action (milestone 6).
  - Arthur's `secretName` is only put in the context once Bond reaches its `revealAtBond`.
- **The war (milestone 6):**
  - Lasts `rules.war.days` (14) days. Each day: dawn (heading, natural recovery of `dawnManaRegen` mana and `dawnHpRegen` Servant HP, then 0–2 war events weighted by `eventsPerDay`), one Day action, dusk, one Night action. Ending early when one pair remains comes with the rival AI.
  - Day actions: Rest (big HP/mana recovery), Train with the Servant (small Body and Magecraft gains, Bond +1), Gather intel (rumors now; real intel in milestone 7), Prepare the workshop (levels 1–3, costs money, used by combat later), Talk (opens chat and uses the Day action).
  - Night actions: Patrol (chance of a night encounter, phase "night" events), Scout a known location / Ambush a known Master (locked until intel exists), Stay hidden (safe, small recovery).
  - War events (phase "war") are rolled at dawn and night encounters (phase "night") on patrol, filtered like all content (year, place, conditions, plus `minDay`/`maxDay`). They don't repeat unless marked `"repeatable": true`. Effects can also change `bond`, `servantHp` and `mana`; `{servant}` in any text is the Servant's name.
  - `state.war` = `{ day, stage, eventQueue, eventId, eventReturn, seenEvents, seenRumors, workshop, history: [{ day, events, dayAction, nightAction, nightEvent }] }`. Every stage change is saved, so a reload or a talk resumes the day exactly where it was.
  - The Servant's chat context includes the day, day/night, workshop level, and the last 3 days of what the player did and saw.
- **Rivals (milestone 7):**
  - **Every war has all seven Servants, no repeats:** the player's Servant, plus one for each of the six rivals (`rivals.json` `count` must equal the number of Servants − 1, checked at startup). When the Servant pool grows, this rule will need revisiting.
  - Each rival Master has: name (from their origin city's name lists, fitting their birth year; 30% come from another city), sex, age (18–55), family (weighted toward mage families), personality (aggressive, cautious, schemer, honorable, reckless), a short description, a home district (from the city's `districts`, all different) and a base (all different, filtered by city and year).
  - **Aggression meter (0–100):** random within the personality's range (aggressive 65–95, cautious 0–35, …). 0 means they stay inside their bounded field; 100 means they hunt other Masters. Milestone 9's rival AI uses it.
  - `state.rivals` = `[{ id, master: {…, aggression, district, base}, servant: { id, hp }, intel: { master, servant }, status }]`.
- **Intel (milestone 7):**
  - Two tracks per rival, each 0–3. Master: 1 = description + district (unlocks scouting), 2 = name + base (unlocks ambush), 3 = family, age, origin, personality, aggression. Servant: 1 = class, 2 = stat ranks, 3 = true name, Noble Phantasm, weakness.
  - Gained by: Gather intel (Mind and contacts check, `rules.intel`), contact tips at dawn, some war events and night encounters (effect `"intel": 1`), all up to level 2; and scouting (night), which raises both tracks by one and is the only way to level 3, with a risk of being spotted that grows with the rival's aggression.
  - `knownView()` in `intel.js` is the single place that turns a rival into what the player knows (unknown = null, shown as "???"). The Status tab and the AI context both use it, so neither can leak.
  - Scout/ambush let the player choose a target. Ambush is a standoff that reveals one Servant level until combat exists.
- **Combat (milestone 8):**
  - Both sides field a Servant (if they still have one) and a **Master**, both with HP. A Master's HP comes from Body (`rules.combat.masterHp`); spells use Magecraft and mana. Masters fight too: support spell, heal, magic attack (bare hands for non-mages), observe for intel, or a Command Seal. Attacks on a Master may be intercepted by their Servant (always, if it is defending or guarding).
  - Each round: the player orders their Servant (attack Servant / attack Master / defend / a skill with a cooldown / Noble Phantasm / retreat), then picks a Master action (with Back). The enemy AI decides by personality, aggression and class. Everyone acts in speed order. Max `rules.combat.maxRounds` (12) rounds, then both sides break off.
  - **Classes fight differently** (`classes.json`): Saber sturdy; Archer strong for the first 2 rounds, then weaker; Lancer fast, good at retreating, probing attacks can reveal intel; Rider best at escaping and chasing; Caster attacks with magic (Mana rank, half-resisted by knight classes) and is much stronger at its own workshop; Assassin always acts first in round 1 with bonus damage and bypasses guards to reach Masters; Berserker hits hard, drains mana, and sometimes ignores orders. Archer and Assassin attack with Agility, Caster with Mana, others with Strength.
  - Every skill and Noble Phantasm has a `combat` block in `servants.json` (buff, weaken, strike, heal, gamble, guard, reveal, stun, dot, lastStand; NPs: power, splash on the Master, stun, burn, self-damage, money cost, defense penalty).
  - A Noble Phantasm costs Master mana (or money, for Cleopatra), is once per battle, and reveals the true name: a rival who sees the player's NP knows their Servant (`knowsPlayerServant`); a rival's NP gives the player servant intel 3. Knowing an enemy's true name gives +15% damage (weakness).
  - Command Seals: Empower (attack and healing), Escape (always works), Absolute Order (free Noble Phantasm). Each costs 3 Bond. With all three used and Bond below 30, the Servant may leave after the battle.
  - Battles start from an ambush (at their base: their workshop helps them), being spotted while scouting, or a patrol run-in (`patrolBattleChance`).
  - **After a battle:** a beaten Servant makes an escape saving throw (Agility, Luck, class), for rivals and the player alike; escaping leaves it at 1 HP. A destroyed rival Servant or a killed rival Master puts that rival out of the war (`status: 'eliminated'`). Surviving a battle gives +1 servant intel; a win gives Bond +2.
  - **Losing your Servant:** choose **Flee to the Church** (game over with an epilogue; a saving throw decides whether you make it or are killed, easier against low-aggression rivals) or **Fight on alone** (the war continues; no training or talking; every battle is Master vs Servant and Master). If the player's Master dies, it is game over (epilogue).
  - Text that mentions `{servant}` carries `"conditions": { "hasServant": true }` and has a servant-less variant where needed.
  - During a battle, an HP summary is pinned above the order buttons. Enemy exact HP shows only with enough intel (servant level 2, Master level 3); otherwise "wounded", "badly hurt" etc.
  - Balance (sensible-play simulation, 2,800 battles): every class beats its opponent 29–58% of the time. Masters die in about 1 battle in 10 if the player never defends or retreats. Revisit in the balance pass.
- **Rival AI (milestone 9):**
  - Every night, after the player's action, each active rival picks hunt / scout / fortify / ally / hide by weighted rules (`rivals.json` `ai`): aggression drives hunting, low HP drives hiding, personality drives alliances, and class biases the choice (Casters fortify, Berserkers hunt, Assassins scout). Rule-based and readable; no simulation beyond that.
  - What rivals know: `rival.knows = { player: 0–2, rId: 0–2 }` (1 = can find them, 2 = knows their base). They learn by scouting (scouting the player can fail; each workshop level makes the player's base harder to find), by fighting, and through alliances.
  - Rival vs rival fights are resolved off-screen by `autoBattle()` using the same stats as combat (class attack stat, Endurance, workshops at home). The loser's Servant makes an escape saving throw; otherwise that rival is out. Results arrive at dawn as news (`state.war.news`), naming only what the player's intel allows. The church announces how many Masters remain.
  - Raids: a rival who knows the player's base and hunts them while the player **stays hidden** attacks the base: a battle at the player's base, where the player's workshop helps them. If the player is out that night, the base is ransacked (workshop −1). A rival scouting the player may be noticed (Mind check, which also reveals a little about them).
  - **The war ends as soon as no rivals remain** (victory). **Day 14 is a hard stop:** on the last night all alliances end; if more than one rival is left they fight each other until one remains (`finalShowdown`), and the survivor faces the player in a **final battle**: no retreat, no Escape seal, no escape saving throws, fought until someone falls. Losing your Servant there still offers Flee to the Church or fighting on alone (a new Master-only final battle).
  - **Alliances:** rivals ally with each other (`state.alliances`), ending at random or once few remain. **The player can ally too** (Day action "Propose an alliance", needs a rival's name and base; Charisma, personality and aggression set the odds; one ally at a time). An ally won't hunt the player, may share intel at dawn, and appears in Status and the Servant's context. A scheming ally may betray the player (and come for their base). The player can betray an ally by ambushing them; each Servant reacts by its own `betrayalBond` (Arthur −5, Hector and Constantine −4, Samson −3, Solomon −1, Ishtar 0, Cleopatra +1).
  - The player only learns which rival is out if they could identify it (intel ≥ 1) or did it themselves; otherwise only the church's count changes.
- **Bond (milestone 10):**
  - **Bond matters in battle** (`rules.bond.tiers`): +5% attack and defense at 40, +10% at 60, +15% at 80; at 80+ a 50% chance the Servant takes a killing blow meant for the Master. (Simulation: the same battles go from 54% to 76% beaten at Bond 85 vs 10.)
  - **Bond shapes how the Servant speaks:** the chat context carries the Bond level's guidance (`dialogue.json` `bondBands`), which from 60 up follows the chosen path; greetings warm up at 40 (`greetingsWarm`) and change on the romantic path (`greetingsRomantic`).
  - **The path choice at Bond 60** (`rules.bond.pathAt`): the next morning, the player chooses how they see their Servant: **"As my closest comrade"** (platonic) or **"As someone I love"** (romantic). Stored as `state.servant.path`; shown in Status. Each Servant has a `friendshipStyle` and a `romanceStyle` (`servants.json` personality) that the AI follows. Romance is affectionate and in character, kept tender and never explicit; on the platonic path the Servant answers flirting warmly, as a friend. Both paths give the same combat bonuses.
  - **The Servant speaks up on their own** after big moments, in one to three AI-written sentences (`getServantRemark`, using the full chat context), shown as "Name: “…”": after winning a battle, a narrow escape, the Master nearly dying, betraying an ally, being betrayed, reaching Bond 40 and 80, the path choice, and war events marked `"servantRemark": true`. Every moment has a prepared fallback line per Servant (`dialogue.json` `remarks`), used offline.
  - Bond milestones remarked on are recorded in `state.servant.bondMilestones`.
- **Endgame (milestone 11):**
  - **Victory** (the last Master standing, early or after the final battle): the Grail appears; the player may **talk with their Servant one last time** (a free chat), then chooses a wish: **their own wish** (typed in their own words, up to 200 characters), **their Servant's wish**, **wish for their Servant to stay** (unlocked on the romantic path, or the platonic path at Bond 80+), or **destroy the Grail**. Winning without a Servant offers only their own wish or destroying the Grail.
  - The epilogue is AI-written (`getEpilogue`, `default` tier: a once-per-game call, worth the richer writing): second person, 2–4 paragraphs, honest about what the wish does (never a cheap trick), with the Servant's farewell or future warmer the higher the Bond, romance shown tenderly and never explicitly, and nothing that didn't exist in the war year. Prepared fallbacks in `endings.json` vary by Bond (low/high/none) and path; they avoid gendered subject pronouns and use `{their}`/`{them}`, filled from the Servant's sex.
  - **Defeats** (the Church, killed fleeing, killed in battle) show their short epilogue.
  - **Every ending closes with a run summary** (`summary.js`): the Master's life (birth, family, trait, childhood highlights, final stats), the Servant (final Bond, relationship, when lost), the war (days survived, battles fought and won, Command Seals used, true names learned), the ending and wish, and **every rival revealed** (their Master, their Servant's true name, and their fate). Revealing everything is fine now: the war is over.
  - `state.ending` = `{ type, stage, talked, wishKind, wishText }`; every stage is saved, so a reload resumes the ending exactly.
- **Immersion pass (milestone 12):** the goal is a world that feels alive and choices that aren't on rails.
  - **Skill checks:** an event choice can be `{ "check": { "stat", "difficulty" }, "success": {…}, "failure": {…} }`. Chance = `rules.checks` base + (stat − difficulty) × perPoint, clamped; the button shows the stat and the odds.
  - **The Servant's values:** each Servant has `values` and `scorns` (`servants.json`), from a fixed list (courage, mercy, honesty, cunning, ambition, caution, pride, faith, loyalty, cruelty, generosity, curiosity, recklessness). A choice can say what it `shows`; the Servant visibly approves or disapproves (±2 Bond per matching value, capped at ±4). The same choice lands differently with different Servants.
  - **More conditions:** `servants`, `minBond`, `maxBond`, `path`, and `seen`/`notSeen` (event ids, for chains).
  - **Servant moments** (phase `"servant"`): shared everyday scenes (walks, food, clothes, sparring, disagreements, memories, the wish question, the night sky, path-specific moments) and three personal stories per Servant, the deepest gated at Bond 55. They come from the new Day action **Spend the day with {servant}** (Bond +1 plus a moment) and sometimes at dawn (`rules.servantEventAtDawn`). After a moment the Servant speaks up (AI-written, or rotating prepared lines offline).
  - **Work:** a life action (money per year of the turn) and a war Day action ("Earn some money"), so money has a source.
  - **Much more content:** about 103 life events (40 more were added with the longer life phase, spread across ages 5–25) (including city-and-year-specific history: Gion Matsuri, the 1952 London smog, the Prague Spring, Hurricane Betsy, the 1978 World Cup, …, plus family- and trait-specific events), 26 dawn events, 13 night encounters (several city-specific), 32 Servant moments, and many more text variants for life actions, war actions, dawns, dusks, rumors and quiet nights.
  - **No repeated lines:** `pickText(variants, ctx, used)` avoids lines already shown this run (`state.life.usedTexts`, `state.war.usedTexts`) while fresh ones remain.
- **UI overhaul (milestone 12):** from a plain shell to a finished-looking app.
  - **Look:** night-indigo background with gold and Command-Seal crimson; Cormorant Garamond for story text and headings, Inter for interface (Google Fonts, with system fallbacks). The background shifts with the phase (`body[data-phase]`) and, in the war, with day or night (`body[data-time]`).
  - **Class emblems** (`emblems.js`): every class has its own line-art emblem and colour (Saber blue, Archer gold, Lancer green, Rider copper, Caster violet, Assassin slate, Berserker red; unknown is grey). Medallions appear on the title screen, the Servant's profile card and speech, Status (the Servant and each rival: their class if known, otherwise unknown) and the HUD. No Fate artwork or symbols.
  - **Animated scenes** (`fx.js`, `playScene(name, data)`): full-screen, 3–6 seconds, skippable by tapping or Space/Enter/Escape, and skipped entirely with reduce motion. Scenes: birth (year and city at dawn), Command Seals, summoning (the circle draws itself, flash, class and true name revealed), the war begins (seven emblems in a ring), battle start (your emblem vs theirs, or unknown), a Noble Phantasm, the path choice, the Grail, losing your Servant, and a defeat. A scene never starts on its own: once the text above it has finished typing, a **Continue** button appears and the scene plays when the player taps it. The exceptions are scenes that follow straight from a tap (birth, after choosing boy or girl; the war start, after "The war begins"), which pass `{ gate: false }`. Scenes are never saved: a reload continues after them.
  - **Day and Night banners** slide in below the HUD at dawn and dusk without blocking play.
  - **War HUD** (`hud.js`): under the top bar during the war, battles and chats: day and time, the Servant's emblem and HP, the Master's HP, mana and Bond as small coloured bars. Rebuilt on every autosave.
  - **Log entry kinds:** `heading`, `system`, `effect`, `roll`, `np`, `card` (profile cards), `document` (the parchment birth certificate), `speech` and `player`. `ui.log(text, kind, { emblem })` adds a class medallion to an entry.
- **Circuit ranks** are rolled from each family's `circuitWeights`, which form a bell curve: C is the most common rank, and each step away from it is rarer (overall about E 7%, D 21%, C 47%, B 18%, A 6%, EX 1%). The family only shifts the curve a little (old lineages toward B, non-mages toward D). Max mana = quantity rank value × `manaPerCircuitRank`.
- **Published build:** the game is published as a private Claude artifact (Holy Grail War Simulator, https://claude.ai/artifact/4YZpAUQVQsMQJrANufHYYK). Republish its files after each milestone, including any new `/data` files.

## 12. Open questions (decide before or during the build)

- Can the player die in the life phase, or is it always safe?
- Permadeath, or save-anywhere?
