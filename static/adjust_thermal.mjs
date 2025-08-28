//@ts-check

/** @type {[number, number, number]} */
export const RISE_COEFFS = await fetch("/static/src/rise_coeffs.json").then(res => res.json());
/** @type {[number, number, number]} */
export const RETURN_COEFFS = await fetch("/static/src/return_coeffs.json").then(res => res.json());

/**
 * Computes the maximum thermal slope at a given delta temperature.
 * @param {[number, number, number]} coeffs - Coefficients [a, b, c] for T
 * @param {number} delta - current ΔT value (can be negative, treated as magnitude)
 * @returns {number} -
 */
function compute_max_thermal_slope_at_delta(coeffs, delta) {
    return 1 / (coeffs[1] + 2 * coeffs[2] * Math.abs(delta));
}
/**
 * Computes the maximum thermal change at a given temperature for a specified time. Could be NaN if delta_temp is close to min/max and delta_time is large, which is clamped to 0.
 * @param {[number, number, number]} coeffs - Coefficients [a, b, c] for T
 * @param {number} delta_temp - current ΔT value (can be negative, treated as magnitude)
 * @param {number} delta_time - Time duration in seconds
 * @param {boolean} negative - If true, computes for negative slope
 * @returns {number} - Maximum thermal change
 */
export function compute_max_thermal_change_at_temp_for_time(coeffs, delta_temp, delta_time, negative) { // DSolve[{T'[x] == 1/(b + 2 c T[x]), T[0] == T0}, T[x], x][[2, 1, 2]] - T0 // FullSimplify (negative is same DSolve with -1/(b + 2 c T[x]))
    const [a, b, c] = coeffs;
    const T0 = Math.abs(delta_temp);
    const x = delta_time;
    const nf = negative ? -1 : 1;
    const max_change = (Math.sqrt((b + 2*c*T0)**2 + nf * 4*c*x) - (b + 2*c*T0))/(2*c)
    return Number.isNaN(max_change) ? 0 : max_change;
}

/**
 * Evaluate a 2nd-degree polynomial f(Δ) = a + bΔ + cΔ²
 * @param {[number, number, number]} coeffs - Coefficients [a, b, c]
 * @param {number} delta - Δ value (can be negative, treated as magnitude)
 * @returns {number}
 */
function evaluatePolynomial(coeffs, delta) {
    return coeffs[0] + coeffs[1] * Math.abs(delta) + coeffs[2] * delta * delta;
}

/**
 * Generate thermal waveform using delta + calculated rise/return time
 * @param {number} delta - Δ value (target temperature change)
 * @param {[number, number, number]} riseCoeffs - Polynomial coefficients for rise time
 * @param {[number, number, number]} returnCoeffs - Polynomial coefficients for return time
 * @param {number} duration - total duration in seconds
 * @param {number} sampleRate - samples per second (default: 10Hz)
 * @returns {number[]} - thermal waveform array
 */
function generateThermalWaveform(delta, riseCoeffs, returnCoeffs, duration, sampleRate = 10) {
    if (delta === 0) return new Array(duration * sampleRate).fill(0);

    const riseTime = evaluatePolynomial(riseCoeffs, Math.abs(delta));
    const returnTime = evaluatePolynomial(returnCoeffs, Math.abs(delta));

    const totalSamples = Math.floor(duration * sampleRate);
    const riseSamples = Math.floor(riseTime * sampleRate);
    const returnSamples = Math.floor(returnTime * sampleRate);
    const holdSamples = Math.max(0, totalSamples - riseSamples - returnSamples);

    const signal = [];

    // Rise phase
    for (let i = 0; i < riseSamples; i++) {
        signal.push((i / riseSamples) * delta);
    }

    // Hold phase
    for (let i = 0; i < holdSamples; i++) {
        signal.push(delta);
    }

    // Return phase
    for (let i = 0; i < returnSamples; i++) {
        signal.push(delta * (1 - i / returnSamples));
    }

    // Padding if needed
    while (signal.length < totalSamples) {
        signal.push(0);
    }

    return signal;
}

/**
 * Apply slope constraint based on ΔT-specific rise/return time
 * @param {number[]} samples - Thermal waveform array
 * @param {number} delta - Target delta temperature
 * @param {[number, number, number]} rise_coeffs - Polynomial coefficients for rise time
 * @param {[number, number, number]} return_coeffs - Polynomial coefficients for return time
 * @param {number} sampleRate - samples per second (default: 10Hz)
 * @returns {number[]} - waveform with slope-limited transitions
 */
function limit_gradient_by_delta(samples, delta, rise_coeffs, return_coeffs, duration, sampleRate = 10) {
    const new_samples = [...samples];

    const rise_time = evaluatePolynomial(rise_coeffs, Math.abs(delta));
    const return_time = evaluatePolynomial(return_coeffs, Math.abs(delta));

    // Relax factor: control how strict the slope limitation is
    const RELAX_FACTOR = 1.5;

    const slope_rise = (Math.abs(delta) / rise_time) * (duration / rise_time) * RELAX_FACTOR;
    const slope_return = (Math.abs(delta) / return_time) * (duration / return_time) * RELAX_FACTOR;

    const max_rise_step = slope_rise / sampleRate;
    const max_return_step = slope_return / sampleRate;

    for (let i = 1; i < new_samples.length; i++) {
        const delta_y = new_samples[i] - new_samples[i - 1];
        const is_rising = Math.sign(delta_y) === Math.sign(delta);

        const max_step = is_rising ? max_rise_step : max_return_step;

        if (Math.abs(delta_y) > max_step) {
            new_samples[i] = new_samples[i - 1] + Math.sign(delta_y) * max_step;
        }
    }

    return new_samples;
}
