import numpy as np
from scipy.signal import resample

SAMPLE_RATE = 10000
MIN_FREQ = 50
MAX_FREQ = 500

# Load calibration Coeffs
Coeffs = []
with open('play_signal/Coeff.txt') as file:
    for line in file:
        Coeffs.append(10000 / float(line.strip()))
m = np.mean(Coeffs)
Coeffs = np.array(Coeffs) / m
assert len(Coeffs) == (MAX_FREQ - MIN_FREQ + 1), "Coeff.txt length mismatch"


def map_frequency(value, min_value, max_value, logscale=False):
    if logscale:
        log_min = np.log10(MIN_FREQ)
        log_max = np.log10(MAX_FREQ)
        log_freq = log_min + (log_max - log_min) * ((value - min_value) / (max_value - min_value))
        return 10 ** log_freq
    else:
        return MIN_FREQ + (MAX_FREQ - MIN_FREQ) * ((value - min_value) / (max_value - min_value))


def linterp_index(arr, perc):
    index = perc * (len(arr) - 1)
    lower = int(np.floor(index))
    upper = int(np.ceil(index))
    weight = index - lower
    return arr[lower] * (1 - weight) + arr[upper] * weight


def generate_signal(vib_amp, vib_freq, TOTAL_DURATION_SEC, duration=None, logscale=False):
    if duration is None:
        duration = TOTAL_DURATION_SEC
    elif duration > TOTAL_DURATION_SEC:
        raise ValueError(f"duration must be <= {TOTAL_DURATION_SEC} seconds")

    total_samples = int(TOTAL_DURATION_SEC * SAMPLE_RATE)
    num_output_samples = int(duration * SAMPLE_RATE)
    vib_signal = np.zeros(num_output_samples, dtype=np.float32)

    phase_acc = 0
    for i in range(num_output_samples):
        perc = i / total_samples
        s_freq = linterp_index(vib_freq, perc)
        s_amp = linterp_index(vib_amp, perc)

        current_freq = map_frequency(s_freq, 0, 1, logscale=logscale)
        phase_delta = 2 * np.pi * current_freq / SAMPLE_RATE

        phase_acc += phase_delta
        vib_signal[i] = s_amp * np.sin(phase_acc) * Coeffs[int(current_freq) - MIN_FREQ]

    return vib_signal, duration


def generate_signal_with_thermal(vib_amp, vib_freq, thermal_amp, TOTAL_DURATION_SEC, duration=None, logscale=False, thermal_rate=10000):
    vib_signal, actual_duration = generate_signal(vib_amp, vib_freq, TOTAL_DURATION_SEC, duration, logscale)

    # vib_signal의 길이에 맞춰 thermal_amp를 interpolation
    vib_len = len(vib_signal)
    thermal_full = np.interp(
        np.linspace(0, len(thermal_amp) - 1, vib_len),
        np.arange(len(thermal_amp)),
        thermal_amp
    )

    # downsample to thermal_rate (예: 100Hz)
    thermal_sampled = resample(thermal_full, int(actual_duration * thermal_rate))

    return vib_signal, thermal_sampled
