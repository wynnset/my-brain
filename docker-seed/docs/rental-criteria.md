# Rental Criteria — Hearth's source of truth

Living doc. Hearth reads this on every run. Aidin edits it directly.
Vancouver, BC area. Fill in every **TBD** before the first scored run —
Hearth refuses to score if any hard filter below is still `TBD`.

## Hard filters (required — failing any one drops the listing)

| Filter | Value |
|--------|-------|
| Price range | $TBD–$TBD / month (CAD) |
| Bedrooms | 2BR minimum |
| Location | Vancouver, BC — neighbourhoods of interest: TBD (e.g. Kitsilano, Mount Pleasant, Commercial Drive, East Van, North Van) |
| Max commute | TBD (or N/A) |
| Pet-friendly | TBD (yes / no / N/A) |
| Parking | At least 1 spot |
| Move-in window | TBD |
| In-unit laundry | TBD (yes / no / preferred) |

## Soft filters (LLM-scored 0–10 each, weighted)

The composite score is computed **only for listings that pass every hard
filter**. Composite = weighted sum of the soft scores below.

| Criterion | Weight |
|-----------|--------|
| West-facing OR south-facing windows in the main living area | 1.5 |
| EV charging available, OR 240V outlet in garage/parking, OR landlord open to install | 2.0 |
| Unobstructed view (mountains, water, or open sky — not another building's wall) | 1.5 |
| Quiet street (no arterial road, no nightlife strip) | 1.0 |
| Natural light in the second bedroom / office space | 1.0 |
| Outdoor space (balcony, patio, deck, or shared yard) | 1.0 |
| Walkable to groceries + a park within 10 min | 0.5 |
| Building age / condition / character (heritage, modern reno, well-maintained) | 0.5 |

## Hard exclusions (drop on sight, regardless of score)

- Basement suites with no above-grade windows
- Shared bathrooms
- Sublets under 6 months
- Anything requiring a deposit or wire transfer **before** an in-person viewing

## Scam heuristics (flag, never silently drop)

Flag — don't delete — listings that trip any of these. They go in the report's
"Flagged / needs review" section with the reason.

- **price_anomaly** — asking price >40% below the median for that neighbourhood/bed count
- **stock_photos** — photos look like generic stock / staged catalogue shots, or no photos at all
- **broker_mill** — copy-paste broker-mill language, same body across many listings, "schedule a tour" funnels
- **wire_deposit** — asks to wire a deposit, e-transfer, or "hold fee" before viewing
- **incomplete** — too little information to evaluate (no price, no location, no description)

## Notes for the LLM scorer

- Score each soft criterion 0–10 with a one-sentence rationale. Be conservative.
- Orientation: if "bright" / "sun-drenched" appears **without** a stated
  orientation, score 5–6 and note low confidence. If orientation is stated
  explicitly (e.g. "west-facing", "afternoon sun"), score 8–10.
- View: "city views" facing a wall of towers is **not** unobstructed. Mountains,
  water, or open sky only.
- EV: an existing charger or a stated 240V outlet scores high; "EV-friendly
  building" with no detail scores mid; street parking only scores low.
- Don't invent facts. If a criterion isn't addressed at all, score it 3–4 with
  "not mentioned" as the rationale, not 0.
- When photos are available, factor them in; when they aren't, say so and lean
  on the text.
