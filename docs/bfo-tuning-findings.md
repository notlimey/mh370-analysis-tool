# BFO Tuning Reassessment

Date: 2026-04-05

## Summary

The prior conclusion in this repo that the revised AES-compensation model had fully fixed BFO was wrong.

Current code status:

- the sampled best path now goes south again
- the current southern path is helped by an explicit removable northward-leg prior, not by BFO alone
- the BFO fit for the current best path is still weak: about `78.8 Hz` mean absolute residual

## What Was Actually Wrong

The app had two separate outputs that looked like they agreed when they did not:

1. The candidate-path sampler was still choosing a northbound best path.
2. The probability heatmap was hard-limited to a southern Arc 7 latitude window and also included a southern debris prior.

That made the UI look more "southern" than the path solver really was.

## Current Reassessment

The current BFO implementation in `src-tauri/src/mh370/bfo.rs` is still not strong enough to discriminate the southern corridor on its own. Evidence:

- `cargo run --bin compare_bfo_models` showed that partial-compensation variants were worse than the current full-compensation form.
- `cargo run --bin debug_corridor_survival` showed the corridor collapse point was Arc 3.
- `cargo run --bin debug_arc3_competition` showed that Arc-3 south candidates were being destroyed almost entirely by BFO score, not by speed or heading continuity.
- `cargo run --bin debug_arc3_bfo_variants` showed that the implemented BFO sign convention was backwards for the code's own range-rate definition and calibration scheme.
- After fixing that sign, the solver moved south again, but still with weak residuals.

This means the present issue is not just frontend residue or stale config. It is a model/assumption problem.

## Code Changes Made

1. The heatmap in `src-tauri/src/mh370/probability.rs` now derives from sampled path endpoints rather than a southern-only Arc 7 slice plus southern debris prior.
2. The UI now shows the best path endpoint separately from the heatmap peak and warns when they diverge or when BFO residuals are weak.
3. Persisted UI config is schema-versioned so stale saved model settings do not silently override current defaults.
4. BTO calibration now prefers the true ground logon sample instead of averaging all known-position BTO points.
5. Path scoring now includes both usable Arc-6 handshakes and reduced-weight Arc-7 uncertain BFO instead of dropping it entirely.
6. The BFO sign convention in `src-tauri/src/mh370/bfo.rs` was corrected, which allowed southbound candidates to survive Arc 3.
7. A temporary explicit northward-leg penalty prior was added in `src-tauri/src/mh370/paths.rs` to suppress implausible early northward doglegs.

## Practical Conclusion

The repo should currently be treated as follows:

- The blue path is the honest output of the current path sampler.
- The BFO model remains unresolved.
- The current southern result is usable as an explicit prior-guided path search result, not as a clean BFO-only inference.
- Any future improvement should be judged against two questions:
  1. does the path remain south without the northward-leg prior?
  2. do BFO residuals materially improve?

## Next Work

The next useful investigation is not another UI tweak. It is testing alternative BFO assumptions explicitly, likely including:

- whether early-arc BFO should be weighted differently than later arcs
- different handling of the 00:19 logon BFOs
- vertical-speed terms during the final handshake window
- whether the current sign/compensation decomposition is still incomplete beyond the main sign fix
- whether the explicit northward-leg prior can be reduced or removed after further physics work
