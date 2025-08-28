//@ts-check
import { notnull } from "./util.mjs";

export class NpWaveFormCanvas extends HTMLElement {
	#canvas;
	#ctx;
	/** @type {Float32Array | number[] | null} */
	#last_waveform;
	/** @type {Float32Array | number[] | null} */
	#last_freqs;

	#_resize_observer = new ResizeObserver(this.#_on_parent_resize.bind(this));

	static observedAttributes = ["width", "height"];

	/** @type {number | null} */
	#_set_width = null;
	/** @type {number | null} */
	#_set_height = null;
	set width(value) {
		this.#_set_width = value;
		this.#canvas.width = value;
		if (this.#last_waveform) this.draw_waveform(this.#last_waveform, this.#last_freqs);
	}
	get width() {
		return this.#_set_width ?? this.#canvas.width;
	}
	set height(value) {
		this.#_set_height = value;
		this.#canvas.height = value;
		if (this.#last_waveform) this.draw_waveform(this.#last_waveform, this.#last_freqs);
	}
	get height() {
		return this.#_set_height ?? this.#canvas.height;
	}

	constructor() {
		super();
		// const shadowroot = this.attachShadow({ mode: "open" });
		const canvas = document.createElement("canvas");
		this.appendChild(canvas);
		this.#canvas = canvas;
		this.#ctx = notnull(canvas.getContext("2d"));
	}

	#_on_parent_resize() {
		if (!this.#_set_width) this.#canvas.width = this.parentElement?.clientWidth ?? 500;
		if (!this.#_set_height) this.#canvas.height = this.parentElement?.clientHeight ?? 500;
		if ((!this.#_set_width || !this.#_set_height) && this.#last_waveform) {
			this.draw_waveform(this.#last_waveform, this.#last_freqs);
		}
	}

	connectedCallback() {
		if (this.parentElement) {
			this.#_resize_observer.observe(this.parentElement);
			this.#_on_parent_resize();
		} else {
			console.warn("parentElement is null, cannot observe resize");
		}
	}
	disconnectedCallback() {
		this.#_resize_observer.disconnect();
	}

	/**
	 * Draw a vertical red playhead line at given x-position.
	 * @param {number} x - x position in pixels
	 */
	draw_playhead(x) {
		const ctx = this.#ctx;
		const canvas = this.#canvas;
		const { height } = canvas;

		if (!this.#last_waveform) return;

		// redraw waveform first
		this.draw_waveform(this.#last_waveform, this.#last_freqs);

		// draw red vertical line as playhead
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.strokeStyle = "red";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	/**
	 * Draw waveform with optional frequency-based green colormap.
	 * @param {Float32Array | number[] | null} pcm
	 * @param {Float32Array | number[] | null} freqs
	 */
	draw_waveform(pcm, freqs = null) {
		this.#last_waveform = pcm;
		this.#last_freqs = freqs;

		const canvas = this.#canvas;
		const wf_ctx = this.#ctx;
		const { width, height } = canvas;

		wf_ctx.fillStyle = "white";
		wf_ctx.fillRect(0, 0, width, height);

		if (!pcm) return;

		const last_step = pcm.length / width;

		// Downsample and normalize freqs if provided
		let colorFreqs = freqs ? downsampleArray(freqs, width) : null;

		wf_ctx.beginPath();
		wf_ctx.moveTo(0, height / 2);
		for (let i = 0; i < width - 1; i++) {
			const samples = pcm.slice(Math.floor(i * last_step), Math.floor((i + 1) * last_step));
			const max = Math.max(...samples);
			const min = Math.min(...samples);

			if (colorFreqs) {
				wf_ctx.strokeStyle = colormapGreen(colorFreqs[i]);
			} else {
				wf_ctx.strokeStyle = "white";
			}

			wf_ctx.beginPath();
			wf_ctx.moveTo(i, height / 2 - min * height / 2);
			wf_ctx.lineTo(i, height / 2 - max * height / 2);
			wf_ctx.stroke();
		}
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (name === "width") this.width = parseInt(newValue);
		else if (name === "height") this.height = parseInt(newValue);
	}
}

/**
 * Converts a normalized value (0~1) to a green shade.
 * Low value: light green. High value: dark green.
 * @param {number} norm - normalized frequency [0, 1]
 * @returns {string} - CSS color string (rgb)
 */
/**
 * Converts a normalized value (0~1) to a green shade with alpha transparency.
 * Low value: transparent green. High value: fully opaque green.
 * @param {number} norm - normalized frequency [0, 1]
 * @returns {string} - CSS color string (rgba)
 */
function colormapGreen(norm) {
	const clamp = Math.min(Math.max(norm, 0), 1);
	const alpha = 0.2 + 0.9 * clamp; // alpha from 0.1 (light) to 1 (full)
	return `rgba(0,100, 255, ${alpha.toFixed(2)})`;
}

/**
 * Downsamples an array to target length using averaging.
 * @param {number[] | Float32Array} arr
 * @param {number} targetLength
 * @returns {number[]}
 */
function downsampleArray(arr, targetLength) {
	const result = [];
	const chunkSize = arr.length / targetLength;
	for (let i = 0; i < targetLength; i++) {
		const start = Math.floor(i * chunkSize);
		const end = Math.floor((i + 1) * chunkSize);
		const segment = arr.slice(start, end);
		// @ts-ignore
		const avg = segment.length > 0 ? segment.reduce((sum, v) => sum + v, 0) / segment.length : 0;
		result.push(avg);
	}
	return result;
}

customElements.define("np-waveform-canvas", NpWaveFormCanvas);