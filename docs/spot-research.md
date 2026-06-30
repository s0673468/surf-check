# Floripa Spot Research Wiki

Manual source pass from 2026-06-16. Treat this as forecast priors, not truth:
public surf pages often disagree, and they cannot see live banks, crowd, access,
or whether a section is actually breaking. Local checks should win over this file.

## Applied Calibration (2026-06-17)

A research + adversarial-verification pass (Surf-Forecast per-break "ideal swell +
offshore wind", a local PT guide, Wikipedia) was fact-checked for geographic
plausibility and applied to `BEACHES` in `app.js`. `swellCenter` = degrees the swell
ideally comes **from**; `offshoreWind` = degrees the grooming wind comes **from**;
`idealTide` is now a normalized **0 (low) – 1 (high)** state, not metres.

| Spot | swellCenter | swellSpread | offshoreWind | idealHeight | maxHeight | idealTide | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| praia-mole | 128 (ESE/SE) | 80 | 300 (WNW/NW) | 0.7–1.8 | 2.8 | 0.4 | ESE swell, more easterly than Joaquina (151/315 was an overcorrection). |
| joaquina | 148 (SE) | 85 | 315 (NW) | 0.8–2.1 | 3.2 | 0.4 | SE groundswell + NW terral; marquee big-swell beach. |
| campeche | 174 (S) | 70 | 318 (NW) | 0.8–2.0 | 2.9 | 0.5 | **Faces SOUTH** — old 124 (ESE) was the wrong corner. |
| barra-da-lagoa | 75 (ENE) | 60 | 250 (WSW) | 0.5–1.4 | 1.9 | 0.5 | **Backwards before** — headland blocks S/SE, behaves like a north beach; all tides. |
| mocambique | 118 (SE) | 88 | 312 (NW) | 0.7–2.2 | 3.2 | 0.5 | Most exposed; widest E-to-S window; holds the most size. |
| santinho | 118 (ESE/SE) | 72 | 292 (WNW) | 0.7–1.9 | 2.8 | 0.4 | Already near-right; rejected a push to E/100. |
| brava | 88 (E) | 60 | 268 (W) | 0.6–1.7 | 2.5 | 0.4 | East swell + W offshore. See contamination note below. |
| ingleses | 52 (NE) | 62 | 220 (SW) | 0.8–1.7 | 2.2 | 0.5 | NE swell + strong S/SW offshore; `minSurfHeight` 0.7; shadowed from winter S groundswell. |
| matadeiro | 125 (ESE/SE) | 70 | 228 (SW) | 0.6–1.6 | 2.4 | 0.35 | **offshore is SW**, not NW (NW is onshore for this cove). |
| armacao | 130 (SE) | 58 | 238 (SW) | 0.6–1.5 | 2.1 | 0.5 | Same SW-offshore fix; tight window; `minSurfHeight` 0.65 (flat most days). |
| lagoinha-do-leste | 135 (SE) | 82 | 312 (NW) | 0.8–2.0 | 3.0 | 0.5 | Already right; very exposed/powerful; any tide. |

**Data-contamination flag:** Surf-Forecast's `Praia-Brava_1` page is the **Itajaí /
Balneário Camboriú** Brava (26.95°S), *not* the Florianópolis Brava — do not use its
NW-offshore values. Also discard the PT guide's "vento nordeste" offshore notes for
Joaquina/Lagoinha (NE is onshore for an E/SE-facing beach).

## Scoring Tighten-Ups Suggested By Sources

- Keep the `0.6 m` surfable-height floor as a default. The sources support the
  user call that sub-0.6 m surf in Ingleses should not be fair, and the same floor
  is a reasonable first pass across Floripa unless a specific longboard/learner
  mode is added.
- Add per-spot size curves instead of only `idealHeight` and `maxHeight`.
  Ingleses, Barra, Campeche, Matadeiro, and Armacao have either protected/filtering
  geometry or high "too small" rates in available surf climatology; they should
  be harder to lift above poor/fair on marginal swell. More exposed beaches such
  as Mole, Joaquina, Mocambique, Santinho, and Lagoinha do Leste can keep higher
  upside on the same open-water forecast, but should be punished more for raw
  windsea and closeout size.
- Strengthen the swell-direction gate by exposure class. The current model mostly
  modulates direction fit; for filtered or bay-shaped spots a bad swell angle
  should be a real cap, because open-water swell height can overstate what reaches
  the beach. Exposed beaches can have a wider angle window, but need stronger
  windsea and overpowered penalties.
- Separate "spot consistency" from the hour's physics. Surf-Forecast's monthly
  clean/blown-out/too-small stats are not a live report, but they are useful priors:
  Matadeiro and Armacao should not rank highly on a single marginal modeled swell
  without strong corroborating angle, period, and wind signals.
- Tune tide per spot only where we have evidence. Barra da Lagoa and Ingleses are
  described as working through all tides by Surf-Forecast. For the rest, keep tide
  low-weight until local observation or a better source justifies a narrower rule.
- Keep hazard, crowd, and access mostly out of the numeric score for now. Rips,
  rocks, urchins, localism, crowding, and remote access belong in UI notes or
  confidence warnings unless the product goal becomes "where should we actually go"
  rather than "where is the surf best."
- Do not use the Surf-Forecast page named `Praia-Brava` as evidence for Floripa
  Brava; that page is for Praia Brava in Rio de Janeiro.

## Source-Backed Spot Priors

| Spot | Exposure and bottom | Source-backed swell / wind hints | Reliability and season notes | Forecasting implication |
| --- | --- | --- | --- | --- |
| Praia Mole | Guia Floripa describes a steep "praia de tombo" with strong medium-to-large waves; Surf-Forecast calls it an exposed beach break. | Surf-Forecast points to ESE/SE-style swell with WNW to S-side offshore language, with internal source inconsistency. | Consistent by Floripa standards, winter-favored, crowded, with rips. | Keep high upside and the 0.6 m floor, but apply strong wind and closeout penalties because it gets powerful quickly. |
| Joaquina | Exposed ocean beach and famous sandbar setup; Guia Floripa highlights strong waves and surf competitions. | Surf-Forecast favors SE swell with NW offshore wind. | Usually a safer bet, winter-favored, crowded, with rips. | Allow a high ceiling when swell and wind align; bank/tide uncertainty should keep confidence from becoming absolute. |
| Campeche | Long, fairly exposed beach with variable sandbars; Guia Floripa notes strong waves and wind/kite exposure. | Surf-Forecast favors S swell with NW offshore wind. | Can be too small even in favorable seasonal windows. | Candidate change: current model may be too ESE-centered; consider shifting or widening the swell center toward S/SSE and adding a stricter marginal-size prior. |
| Barra da Lagoa | Shallow/channel-influenced beach; Guia Floripa describes both smaller and stronger wave states. | Surf-Forecast favors ENE swell with WSW offshore wind and says it works through all tides. | Reliable enough as a beach break, but often small and crowded. | Treat as a filtered fallback: lower high-performance ceiling, stronger angle filter, and all-tide handling. |
| Mocambique | Very long, exposed, undeveloped beach; Guia Floripa lists strong waves. | Surf-Forecast favors SE swell with NW offshore wind. | Fairly consistent, winter-favored, with strong rips and many shifting peaks. | Score as an open-coast swell magnet, but punish windsea and raw exposure; one point forecast may hide section variability. |
| Santinho | Intermediate beach with open-sea energy, dunes/headlands, and possible reef influence. | Surf-Forecast favors SE swell with WNW offshore wind, though one paragraph has conflicting wind wording. | Quite consistent, winter-favored, with rips, rocks, and urchins noted. | Candidate change: current model may be too ENE/E-centered; consider a more SE-aware direction curve and hazard notes. |
| Brava | Cliff-framed, strong-wave north beach; Guia Floripa calls it intermediate with strong waves, and Wikipedia describes east-swell exposure. | Best local public hints point to E/east-family swell, but no clean Floripa Surf-Forecast page was found. | High-energy, surf/bodyboard/SUP-oriented beach; local validation needed. | Keep it punchier than Ingleses at the same height, but mark data confidence lower until a local source or observation set confirms angle/tide behavior. |
| Ingleses | Broad north bay with intermediate sandbars; Guia Floripa describes both medium-small and strong wave states. | Surf-Forecast favors NE swell with SW offshore wind and says it works through all tides. | Inconsistent, sometimes crowded, and frequently too small in the available climatology. | Keep the explicit `0.6 m` floor. Add a lower consistency prior or stronger cap unless NE swell, enough period, and clean wind all align. |
| Matadeiro | Cove and river-mouth beach; Guia Floripa lists strong waves and a natural setting. | Surf-Forecast calls it a river break with lefts; source text conflicts between SE and NE swell hints, with SW offshore wind. | Unreliable and often too small in the available stats, despite high upside on aligned days. | Avoid over-ranking on marginal forecasts. This spot needs local bathymetry/river-mouth observation before direction tuning. |
| Armacao | More protected south pocket and fishing village; Guia Floripa lists shallow sections plus smaller-to-stronger wave states. | Surf-Forecast favors NE swell with SW offshore wind and notes shelter from north winds. | Reliable as a beach but often too small in the available stats. | Treat as protected/fallback rather than open-performance: stronger underpowered caps, possible shelter bonus only when open beaches are messy. |
| Lagoinha do Leste | Remote, exposed beachbreak with strong waves; access is by trail or boat. | Surf-Forecast favors SE swell with NW offshore wind. | Quite reliable, winter-favored, less crowded, with strong rips. | High upside when aligned, but wind and raw exposure should matter; access/hazard belongs in the UI, not the score. |

## Open Questions Before More Code Changes

- Addressed in `session-planner.js`: the app now has a practical "Your next
  sessions" planner that ranks contiguous surf windows across beaches, days, and
  hours. It adds visible driving friction through a home point and max-distance
  filter while keeping access, crowd, and hazards as non-numeric spot context.
- Addressed in `session-planner.js`: the planner has a board/intent mode. The
  score model still keeps its default surfable floor, while longboard mode lowers
  the planner's effective window floor so small clean surf can qualify.
- Do we trust generic public spot pages enough to change direction centers now,
  or should we collect a few local validation days first? Campeche and Santinho are
  the clearest candidates where public priors and current model centers disagree.
- Should the model surface confidence separately from score? Low-source-confidence
  places like Brava and conflicted places like Matadeiro would benefit from a
  visible "confidence" label.

## Source Index

- Surf-Forecast: [Praia Mole](https://www.surf-forecast.com/breaks/Praia-Mole),
  [Joaquina](https://www.surf-forecast.com/breaks/Joaquina),
  [Campeche](https://www.surf-forecast.com/breaks/Campeche),
  [Barra da Lagoa](https://www.surf-forecast.com/breaks/Barra-da-Lagoa),
  [Mocambique](https://www.surf-forecast.com/breaks/Mocambique),
  [Santinho](https://www.surf-forecast.com/breaks/Santinho),
  [Ingleses](https://www.surf-forecast.com/breaks/Ingleses),
  [Matadeiro](https://www.surf-forecast.com/breaks/Matadeiro),
  [Armacao](https://www.surf-forecast.com/breaks/Armacao),
  [Lagoinha do Leste](https://www.surf-forecast.com/breaks/Lagoinhado-Leste).
- Guia Floripa: [Praia Mole](https://guiafloripa.com.br/turismo/praias/praia-mole),
  [Joaquina](https://guiafloripa.com.br/turismo/praias/joaquina),
  [Campeche](https://guiafloripa.com.br/turismo/praias/campeche),
  [Barra da Lagoa](https://guiafloripa.com.br/turismo/praias/barra-da-lagoa),
  [Mocambique](https://guiafloripa.com.br/turismo/praias/praia-mocambique),
  [Santinho](https://guiafloripa.com.br/turismo/praias/praia-do-santinho),
  [Brava](https://guiafloripa.com.br/turismo/praias/praia-brava),
  [Ingleses](https://guiafloripa.com.br/turismo/praias/ingleses),
  [Matadeiro](https://guiafloripa.com.br/turismo/praias/praia-matadeiro),
  [Armacao](https://guiafloripa.com.br/turismo/praias/praia-da-armacao),
  [Lagoinha do Leste](https://guiafloripa.com.br/turismo/praias/lagoinha-do-leste).
- Wikipedia cross-checks used lightly where source coverage was thin:
  [Praia Mole](https://en.wikipedia.org/wiki/Mole_Beach),
  [Joaquina](https://en.wikipedia.org/wiki/Praia_da_Joaquina),
  [Praia dos Ingleses](https://en.wikipedia.org/wiki/Praia_dos_Ingleses),
  [Praia do Matadeiro](https://en.wikipedia.org/wiki/Praia_do_Matadeiro),
  [Praia Brava](https://en.wikipedia.org/wiki/Praia_Brava_(Florianopolis)).
