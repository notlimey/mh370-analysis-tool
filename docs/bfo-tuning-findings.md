# BFO Tuning Reassessment

Date: 2026-04-05

## Summary

The previous assessment that the BFO model required significant artificial tuning (`sdu_horizontal_doppler_factor = 0.05` and `bfo_arc7_vertical_speed_fpm = -3000`) was incorrect. The perceived need for tuning was caused by **two fundamental physics and implementation errors** in the BFO model. 

Once these errors are corrected, the BFO model provides an excellent fit (mean absolute residual of **8.9 Hz**) with standard physics assumptions, requiring no artificial scaling factors.

## The Flaws

### 1. Incorrect AES Compensation Physics
The previous model used an artificial `sdu_horizontal_doppler_factor` to scale the aircraft's velocity vector when computing Doppler shift. In reality, the SDU (AES) does not "partially" apply velocity. Instead, the SDU calculates the expected Doppler shift assuming the satellite is perfectly stationary at its nominal geostationary position (e.g., 64.5°E, 0°N). 

The true uncompensated Doppler shift (the BFO) is the difference between the *actual* Doppler shift (using the actual satellite ephemeris position and velocity) and the *compensated* Doppler shift (calculated by the AES using the nominal satellite position and zero velocity).

### 2. Coupled Calibration Point
The previous tuning attempt used the 17:07:55 UTC airborne point for bias calibration. Because the aircraft was moving at 472 knots during this handshake, the calculation of the `bias` became intimately coupled with the flawed `sdu_horizontal_doppler_factor`. By tuning `sdu_horizontal_doppler_factor` down to `0.05`, the previous agent was mathematically forcing the bias to ignore the aircraft's speed, masking the underlying physics error.

The physically correct calibration point is the **16:00:13 UTC ground handshake**, where the aircraft is stationary at the gate. At speed = 0, the AES velocity compensation is 0, completely decoupling the bias calculation from the Doppler compensation logic.

## The Corrections

The codebase was updated to:
1. Revert the calibration point to the 16:00:13 UTC ground logon (`ACARS_KNOWN_POINT`).
2. Replace `sdu_horizontal_doppler_factor` with the correct mathematical model of AES compensation (`actual_rr - comp_rr`).

## Results

With the corrected physics model and `bfo_arc7_vertical_speed_fpm` set to standard `0.0`, running `model_probe bfo-fit` yields:

- **Mean absolute residual:** `8.9 Hz`
- **Max residual:** `21.9 Hz`

This is a massive improvement over the previous tuning (which achieved `23.0 Hz` mean absolute residual) and aligns almost perfectly with the expected BFO noise standard deviation of ~7 Hz. 

## Recommendation

The artificial `sdu_horizontal_doppler_factor` is physically obsolete and should be fully removed from the codebase and UI. The BFO model now stands on solid physical ground and points strongly to the `perpendicular` path family without any parameter hacking.