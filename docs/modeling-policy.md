# Modeling Policy

## Search vs Interpretation

The path sampler in this repo is allowed to remain exploratory.

That means it may generate raw candidates that are not ultimately credible under the repo's broader evidence base.

## Interpretation Rule

Raw candidate generation is not the same as endorsed interpretation.

For interpretation, the current policy is:

1. Treat inland terminal outcomes, including Kazakhstan-reaching branches, as non-credible.
2. Treat ocean-ending outcomes near the late satellite sequence as the credible class.
3. Allow residual northbound alternatives only as exploratory hypotheses, not as default interpreted answers.

## Why

This repo contains strong ocean-ending evidence:

- confirmed/probable western Indian Ocean debris
- late 7th-arc satellite terminal sequence
- underwater search-history framing

At the same time, the repo preserves some unresolved ambiguity around route class and BFO interpretation, so raw search should not be over-constrained prematurely.

## Practical Consequence

- Backend search may still enumerate northbound candidates.
- Frontend summaries, reports, and future ranking logic should not present inland/Kazakhstan outcomes as credible conclusions.
- When debugging path search, compare raw search behavior against this interpretation policy instead of assuming the sampler is already evidence-complete.
