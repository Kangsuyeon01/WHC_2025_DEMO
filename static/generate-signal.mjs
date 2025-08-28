//@ts-check
import { DrawCanvasElement } from "./drawcanvas.mjs";
import { notnull } from "./util.mjs";

export const SAMPLE_RATE = 10000;
export const MIN_FREQ = 50;
export const MAX_FREQ = 500;
export const MIN_THERMAL = -6;
export const MAX_THERMAL = 6;


/** @type {DrawCanvasElement} */
const vib_amp_env_dcanvas = notnull(document.querySelector("#drawvibaenv"));
/** @type {DrawCanvasElement} */
const vib_freq_env_dcanvas = notnull(document.querySelector("#drawvibfenv"));
/** @type {DrawCanvasElement} */
const thr_amp_env_dcanvas = notnull(document.querySelector("#drawthraenv"));
/** @type {HTMLInputElement} */
const duration_input = notnull(document.querySelector("#signalduration"));

/**
 * Maps a given frequency value to the MIN_FREQ - MAX_FREQ range.
 * @param {number} value - The original frequency value.
 * @param {number} minValue - The minimum value in the dataset.
 * @param {number} maxValue - The maximum value in the dataset.
 * @returns {number} - The mapped frequency in the range [MIN_FREQ, MAX_FREQ].
 */
function map_frequency(value, minValue, maxValue) {
    return linear_map(value, minValue, maxValue, MIN_FREQ, MAX_FREQ);
}
/**
 * Maps a given thermal value to the MIN_THERMAL to MAX_THERMAL range.
 * @param {number} value - The original thermal value.
 * @param {number} minValue - The minimum value in the dataset.
 * @param {number} maxValue - The maximum value in the dataset.
 * @returns {number} - The mapped thermal value in the range [MIN_THERMAL, MAX_THERMAL].
 */
export function map_thermal(value, minValue, maxValue) {
    return linear_map(value, minValue, maxValue, MIN_THERMAL, MAX_THERMAL);
}
/**
 * Inversely maps a given thermal value from the MIN_THERMAL to MAX_THERMAL range to the original range.
 * @param {number} value - The original thermal value.
 * @param {number} minValue - The minimum value in the dataset.
 * @param {number} maxValue - The maximum value in the dataset.
 * @returns {number} - The inversely mapped thermal value in the range [minValue, maxValue].
 */
export function inv_map_thermal(value, minValue, maxValue) {
    return linear_map(value, MIN_THERMAL, MAX_THERMAL, minValue, maxValue);
}

/**
 * Maps a given value from one range to another.
 * @param {number} value - The original value.
 * @param {number} orig_min - The minimum value in the original range.
 * @param {number} orig_max - The maximum value in the original range.
 * @param {number} new_min - The minimum value in the new range.
 * @param {number} new_max - The maximum value in the new range.
 * @returns {number} - The mapped value in the new range.
 */
function linear_map(value, orig_min, orig_max, new_min, new_max) {
    return new_min + (new_max - new_min) * ((value - orig_min) / (orig_max - orig_min));
}

function linterp_index(arr, perc) {
    const index = perc * (arr.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    const value = arr[lower] * (1 - weight) + arr[upper] * weight;
    return value;
}


/**
 * Generate a signal based on the current envelope values.
 * @param {boolean} [force_full_duration=false] - If true, the full duration of the signal is generated regardless of the active duration.
 * @returns {{ vib_signal: Float32Array, thermal_signal: Float32Array, duration: number }}
 */
export function generate_signal(force_full_duration = false) {
    const vib_amp = vib_amp_env_dcanvas.get_samples();
    const vib_freq = vib_freq_env_dcanvas.get_samples();
    const thr_amp = thr_amp_env_dcanvas.get_input_samples();

    const current_total_duration = vib_amp_env_dcanvas.get_total_duration();
    if (current_total_duration != vib_freq_env_dcanvas.get_total_duration() || current_total_duration != thr_amp_env_dcanvas.get_total_duration()) {
        throw new Error("All cavnases must have the same total duration");
    }
    const current_active_duration = vib_amp_env_dcanvas.get_active_duration();
    if (current_active_duration != vib_freq_env_dcanvas.get_active_duration() || current_active_duration != thr_amp_env_dcanvas.get_active_duration()) {
        throw new Error("All cavnases must have the same active duration");
    }
    const total_sample_duration = current_total_duration;
    const active_duration = force_full_duration ? current_total_duration : current_active_duration;
    const active_perc = active_duration / total_sample_duration;
    const num_output_samples = Math.floor(active_duration * SAMPLE_RATE);
    const vib_signal = new Float32Array(num_output_samples);

    let phase_acc = 0;
    for (let i = 0; i < num_output_samples; i++) {
        const perc = i / num_output_samples;
        const lperc = perc * active_perc;

        const s_freq = linterp_index(vib_freq, lperc);
        const s_amp = linterp_index(vib_amp, lperc);

        const current_freq = map_frequency(s_freq, 0, 1);
        const phase_delta = 2 * Math.PI * current_freq / SAMPLE_RATE;

        phase_acc += phase_delta;
        vib_signal[i] = s_amp * Math.sin(phase_acc);
    }

    const thermal_signal = new Float32Array(num_output_samples);
    for (let i = 0; i < num_output_samples; i++) {
        const perc = i / num_output_samples;
        const lperc = perc * active_perc;

        const s_amp = linterp_index(thr_amp, lperc);

        // Map [0, 1] to [-6, 6]
        const current_s_amp = map_thermal(s_amp, 0, 1);
        thermal_signal[i] = current_s_amp
    }

    return { vib_signal, thermal_signal, duration: active_duration };
}