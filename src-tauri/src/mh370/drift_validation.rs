use super::drift_scoring::drift_likelihood;

pub fn validate_drift_model() -> bool {
    let probability = drift_likelihood(-34.23, 93.78, -20.9, 55.5, 507.0, 0.025);
    let passed = probability > 0.0 && probability > f64::MIN_POSITIVE;
    println!(
        "INFO debris inversion flaperon validation probability={probability:.6e} passed={passed}"
    );
    if !passed {
        eprintln!("warning: debris inversion drift validation failed; leeway coefficients may need tuning");
    }
    passed
}

#[cfg(test)]
mod tests {
    use super::validate_drift_model;

    #[test]
    fn reunion_validation_smoke_test() {
        assert!(validate_drift_model());
    }
}
