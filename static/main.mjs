//@ts-check
import { DrawCanvasElement } from './drawcanvas.mjs';
import { generate_signal, inv_map_thermal, map_thermal, SAMPLE_RATE } from './generate-signal.mjs';
import { NpWaveFormCanvas } from './np-waveform-canvas.mjs';
import { notnull, wait_ms } from './util.mjs';
import { compute_max_thermal_change_at_temp_for_time } from './adjust_thermal.mjs';

const TARGET_COUNT = 5;
let hasChanged = false; // Track if Play button has been modifyed
let hasPlayed = false; // Track if Play button has been pressed
let playheadAnimationId = null;
let stopRequested = false;
let eventSource = null; // Added
// trial label
/** @type {HTMLSpanElement} */
const trial_current_label = notnull(document.querySelector("#trial_current_label"));
/** @type {HTMLSpanElement} */
const trial_end_label = notnull(document.querySelector("#trial_end_label"));
trial_end_label.textContent = TARGET_COUNT.toString();  // Set total trial count

// alert label
/** @type {HTMLSpanElement} */
const alert_body_label = notnull(document.querySelector("#alert_body_label"));
/** @type {HTMLSpanElement} */
const alert_slider_label = notnull(document.querySelector("#alert_slider_label"));
/** @type {HTMLSpanElement} */
const alert_referral_label = notnull(document.querySelector("#alert_referral_label"));
/** @type {HTMLSpanElement} */
const alert_signal_label = notnull(document.querySelector("#alert_signal_label"));
// /** @type {HTMLInputElement} */
// const slider_value = notnull(document.querySelectorAll("#slider_value"));
// draw signal
/** @type {DrawCanvasElement} */
const vib_amp_env_dcanvas = notnull(document.querySelector("#drawvibaenv"));
/** @type {DrawCanvasElement} */
const vib_freq_env_dcanvas = notnull(document.querySelector("#drawvibfenv"));
/** @type {DrawCanvasElement} */
const thr_amp_env_dcanvas = notnull(document.querySelector("#drawthraenv"));
const drawcanvases = [vib_amp_env_dcanvas, vib_freq_env_dcanvas, thr_amp_env_dcanvas];
/** @type {HTMLInputElement} */
const duration_input = notnull(document.querySelector("#signalduration"));
/** @type {HTMLButtonElement} */
const reset_button = notnull(document.querySelector("#resetsignal"));
/** @type {HTMLButtonElement} */
const play_button = notnull(document.querySelector("#playsignal"));
/** @type {HTMLButtonElement} */
const submit_button = notnull(document.querySelector("#submit"))
/** @type {HTMLButtonElement} */
const stop_button = notnull(document.querySelector("#stopsignal"));

/** @type {HTMLSpanElement} */
const submitstatus_span = notnull(document.querySelector("#submitstatus"));
/** @type {NpWaveFormCanvas} */
const vibrationwaveform_np = notnull(document.querySelector("#vibrationwaveform"));


thr_amp_env_dcanvas.max_slope_callback = (prev_samp, desired_samp, seconds_per_sample) => {
    const prev_samp_degrees = map_thermal(prev_samp, 0, 1);
    const temp_delta_degrees = map_thermal(desired_samp, 0, 1) - prev_samp_degrees;
    // [0.00, 0.944676, -0.0563504] no constant term (rise)
    // [0.00, 0.961138, -0.0809152] no constant term (return)
    const max_positive_rise_temp_change = compute_max_thermal_change_at_temp_for_time([0.00, 0.944676, -0.0563504], prev_samp_degrees, seconds_per_sample, false);
    const max_negative_rise_temp_change = compute_max_thermal_change_at_temp_for_time([0.00, 0.944676, -0.0563504], prev_samp_degrees, seconds_per_sample, true);
    const clamped_temp_delta = Math.max(Math.min(temp_delta_degrees, max_positive_rise_temp_change), max_negative_rise_temp_change);

    const cur_samp_degrees = prev_samp_degrees + clamped_temp_delta;
    const cur_samp = inv_map_thermal(cur_samp_degrees, 0, 1);
    return cur_samp;
}
function on_duration_input() {
    const duration = parseFloat(duration_input.value);
    drawcanvases.forEach(canvas => {
        canvas.set_total_duration(duration);
    });
}
duration_input.addEventListener("input", on_duration_input);
on_duration_input();

drawcanvases.forEach(canvas => canvas.addEventListener("input", async () => {
    update_vibration_np();
    hasChanged = true;
    alert_signal_label.textContent = "⚠ Signal changed. Please press PLAY again to apply changes.";
    alert_signal_label.style.color = "red";
}));


function update_vibration_np() {
    const vib_signal = generate_signal(true).vib_signal;
    // const vib_amp = vib_amp_env_dcanvas.samples;
    const vib_freq = vib_freq_env_dcanvas.get_samples();
    const current_active_duration = vib_amp_env_dcanvas.get_active_duration();
    const current_total_duration = vib_amp_env_dcanvas.get_total_duration();
    const perc_active = current_active_duration / current_total_duration; // todo: update vis based on this?
    vibrationwaveform_np.draw_waveform(vib_signal,vib_freq);
}
update_vibration_np();

// body site info
/** @type {HTMLSpanElement} */
const vibrationInfo = notnull(document.querySelector("#vibrationInfo"));

/** @type {HTMLSpanElement} */
const thermalInfo = notnull(document.querySelector("#thermalInfo"));


// Slider elements
/** @type {HTMLInputElement} */
const roughness_slider = notnull(document.querySelector("#roughness"));
// /** @type {HTMLInputElement} */
// const warmness_slider = notnull(document.querySelector("#warmness"));
/** @type {HTMLInputElement} */
const valence_slider = notnull(document.querySelector("#valence"));
/** @type {HTMLInputElement} */
const arousal_slider = notnull(document.querySelector("#arousal"));

// Slider value display spans
/** @type {HTMLSpanElement} */
const roughness_value = notnull(document.querySelector("#roughness-value"));
/** @type {HTMLSpanElement} */
const valence_value = notnull(document.querySelector("#valence-value"));
/** @type {HTMLSpanElement} */
const arousal_value = notnull(document.querySelector("#arousal-value"));

/** @type {NodeListOf<HTMLInputElement>} */
const referral_radio_buttons = document.querySelectorAll('input[name="referral"]');
/** @type {NodeListOf<HTMLInputElement>} */
const masking_radio_buttons = document.querySelectorAll('input[name="masking"]');
/** Mark sliders as "touched" when adjusted */
const sliders = [roughness_slider, valence_slider, arousal_slider];
const sliders_valuse = [roughness_value,valence_value,arousal_value]
// Mark sliders as "touched" when adjusted
sliders.forEach(slider => {
    slider.addEventListener("pointerdown", () => {
        slider.dataset.touched = "true";  // Mark as interacted
    });
});

/**
 * Generates a waveform signal based on user-defined amplitude and frequency settings.
 * Sends the generated signal to the server for playback.
 */
function startPlayhead() {
    const canvas = vibrationwaveform_np;
    const canvas_width = canvas.width;
    const duration = parseFloat(duration_input.value);
    const total_ms = duration * 1000;
    const start_time = performance.now();
    stopRequested = false;

    function animate(current) {
        if (stopRequested) return canvas.draw_playhead(0);
        const progress = Math.min(Math.max((current - start_time) / total_ms, 0), 1);
        canvas.draw_playhead(progress * canvas_width);
        if (progress < 1) playheadAnimationId = requestAnimationFrame(animate);
    }
    playheadAnimationId = requestAnimationFrame(animate);
}
function stopPlayhead() {
    stopRequested = true;
    if (playheadAnimationId) cancelAnimationFrame(playheadAnimationId);
    vibrationwaveform_np.draw_playhead(0);
}
if (!eventSource) {
    eventSource = new EventSource("/sse_signal_status");

    eventSource.onmessage = (e) => {
        const s = JSON.parse(e.data);
        if (s.status === "start") {
            console.log("[SSE] Received START");
            startPlayhead();
        } else if (s.status === "end") {
            console.log("[SSE] Received END");
            stopPlayhead();
            const input_els = [...drawcanvases, play_button, duration_input];
            input_els.forEach(el => el.disabled = false);
        }
    };

    eventSource.onerror = () => {
        stopPlayhead();
        const input_els = [...drawcanvases, play_button, duration_input];
        input_els.forEach(el => el.disabled = false);
        console.error("[SSE] Connection error.");
    };
}

function on_play_signal() {
    hasChanged = false;
    hasPlayed = true;

    const { vib_signal, thermal_signal } = generate_signal();
    const data = {
        vib_signal: Array.from(vib_signal),
        vib_amp: vib_amp_env_dcanvas.get_samples(),
        vib_freq: vib_freq_env_dcanvas.get_samples(),
        thr_amp: Array.from(thermal_signal),
        sample_rate: SAMPLE_RATE,
        duration: parseFloat(duration_input.value)
    };

    const input_els = [...drawcanvases, play_button, duration_input];
    input_els.forEach(el => el.disabled = true);

    fetch("/play_signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
}

/**
 *
 * @returns {HTMLInputElement | null} - The selected referral radio button, or null if none selected.
 */
function getSelectedReferral() {
    /** @type {HTMLInputElement | null} */
    const selectedReferral = document.querySelector('input[name="referral"]:checked');
    return selectedReferral;
}
function getSelectedMasking() {
    /** @type {HTMLInputElement | null} */
    const selectedMasking = document.querySelector('input[name="masking"]:checked');
    return selectedMasking;
}
function on_reset_signal() {
    const duration = parseFloat(duration_input.value);
    drawcanvases.forEach(canvas => {
        canvas.set_total_duration(duration);
        canvas.reset_samples_to(0.5);
    });
    update_vibration_np();
    hasChanged = true;
    alert_signal_label.textContent = "Signal reset.";
    alert_signal_label.style.color = "red";
}

function on_stop_signal() {
    stopRequested = true;
    if (playheadAnimationId !== null) {
        cancelAnimationFrame(playheadAnimationId);
        playheadAnimationId = null;
    }
    vibrationwaveform_np.draw_playhead(0);
    const input_els = [...drawcanvases, play_button, duration_input];
    input_els.forEach(el => el.disabled = false);

    fetch("/stop_signal", {
        method: "POST",
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === "stopped") {
            alert("Signal stopped and temperature reset to baseline.");
        } else {
            alert("Failed to stop: " + result.message);
        }
    })
    .catch(error => {
        console.error("[STOP] Error:", error);
        alert("Error occurred while sending stop command.");
    });
}



async function on_submit(event) {
    event.preventDefault();

    // Validate that all sliders have been used
    const allSlidersUsed = sliders.every(slider => slider.dataset.touched);
    const referralValue = getSelectedReferral();
    const maskingValue = getSelectedMasking()
    const bodySiteValid = vibrationInfo.textContent !== "None" && thermalInfo.textContent !== "None";


    // Display warning messages and prevent submission if invalid
    let isValid = true;

    function animate_alert_label(label) {
        label.animate([ { opacity: 0 }, { opacity: 1 } ], {
            duration: 500,
            iterations: 1
        });
    }
    if (!hasPlayed) {
        alert_signal_label.textContent = "⚠ Please press the PLAY button at least once before submitting.";
        animate_alert_label(alert_signal_label);
        isValid = false;
    } else {
        if (hasChanged) {
            alert_signal_label.textContent = "⚠ Signal was changed. Please press PLAY again before submitting.";
            animate_alert_label(alert_signal_label);
            isValid = false;
        } else {
            alert_signal_label.textContent = "";
        }
    }


    if (!allSlidersUsed) {
        alert_slider_label.textContent = "⚠ Please adjust all sliders at least once.";
        animate_alert_label(alert_slider_label);
        isValid = false;
    } else {
        alert_slider_label.textContent = "";
    }

    if (!referralValue) {
        alert_referral_label.textContent = "⚠ Please select a referral option.";
        animate_alert_label(alert_referral_label);
        isValid = false;
    } else {
        alert_referral_label.textContent = "";
    }

    if (!bodySiteValid) {
        alert_body_label.textContent = "⚠ Please select a body site.";
        animate_alert_label(alert_body_label);
        isValid = false;
    } else {
        alert_body_label.textContent = "";
    }

    if (!isValid) {
        hasPlayed = false;
        return;
    }

    submitstatus_span.textContent = "";

    const { vib_signal, thermal_signal } = generate_signal();

    // TODO (change data format)
    // vib signal have to be passed by using flask
    const data = {
        vib_signal: Array.from(vib_signal), /////
        vib_amp: vib_amp_env_dcanvas.get_samples(), /////
        vib_freq: vib_freq_env_dcanvas.get_samples(), ////
        thermal_signal: Array.from(thermal_signal), /////
        sample_rate: SAMPLE_RATE,
        duration: parseFloat(duration_input.value),
        body_sites: { vibrationInfo: vibrationInfo.textContent, thermalInfo: thermalInfo.textContent },
        ratings: {
            roughness: roughness_slider.value,
            valence: valence_slider.value,
            arousal: arousal_slider.value,
            referral: referralValue?.value,
            masking: maskingValue?.value,
        }
    };

    fetch("/save_result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
        alert("Submission successful!");

        sliders.forEach(slider => {
            slider.value = "50";  // default value
            delete slider.dataset.touched;
        });
        sliders_valuse.forEach(s_value => {
            s_value.textContent = "50"; // 또는 슬라이더의 초기값과 동일하게
        });

        referral_radio_buttons.forEach(radio => {
            radio.checked = false;
        });
        masking_radio_buttons.forEach(radio => {
            radio.checked = false;
        });


        // update Trial count
        let trialCurrent = parseInt(trial_current_label.textContent || "0", 10) + 1;
        trial_current_label.textContent = trialCurrent.toString();
        trial_end_label.textContent = TARGET_COUNT.toString();

        if (trialCurrent > TARGET_COUNT) {
            alert("All trials completed!");
            trial_current_label.textContent = "0";
            submit_button.disabled = true;
            // TODO: redirect to end page
        }
    })
    .catch(error => {
        alert("Submission failed!");
    });
}
play_button.addEventListener("click", on_play_signal);
reset_button.addEventListener("click",on_reset_signal);
submit_button.addEventListener("click", on_submit);
stop_button.addEventListener("click", on_stop_signal);
