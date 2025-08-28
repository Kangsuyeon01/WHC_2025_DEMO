//@ts-check
import { compute_max_thermal_change_at_temp_for_time } from './adjust_thermal.mjs';
import { inv_map_thermal, map_thermal, MAX_THERMAL, MIN_THERMAL } from './generate-signal.mjs';
import { notnull } from './util.mjs';

export const DEFAULT_TOTAL_DURATION_SEC = 10;
export const NUM_SAMPLES = 150;

export class DrawCanvasElement extends HTMLElement {

    #_resize_observer = new ResizeObserver(this.#_on_self_resize.bind(this));

    static observedAttributes = ["width", "height", "disabled"];
    attributeChangedCallback(name, oldValue, newValue) {
		if (name === "width") this.width = parseInt(newValue);
		else if (name === "height") this.height = parseInt(newValue);
        else if (name === "disabled") this.disabled = newValue;
	}

	/** @type {number | null} */
	#_set_width = null;
	/** @type {number | null} */
	#_set_height = null;
	set width(value) {
		this.#_set_width = value;
		this.canvas.width = value;
		this.draw_samples();
	}
	get width() {
		return this.#_set_width ?? this.canvas.width;
	}
	set height(value) {
		this.#_set_height = value;
		this.canvas.height = value;
		this.draw_samples();
	}
	get height() {
		return this.#_set_height ?? this.canvas.height;
	}

    #_on_self_resize() {
		if (!this.#_set_width) this.canvas.width = this.clientWidth ?? 400;
		if (!this.#_set_height) this.canvas.height = this.clientHeight ?? 100;
		this.draw_samples();
	}

    #_disabled = false;
    set disabled(value) {
        this.#_disabled = value;
        if (value) this.#_internals.states.add("disabled");
        else this.#_internals.states.delete("disabled");
    }
    get disabled() {
        return this.#_disabled;
    }

    #_internals = this.attachInternals();


    /** @type {number[]} */
    #_input_samples = new Array(NUM_SAMPLES);
    get_samples() {
        return this.#_compute_output_samples();
    }

    constructor() {
        super();
        this.attachShadow({mode: 'open'});
        const shadowRoot = notnull(this.shadowRoot);
        shadowRoot.innerHTML = `
            <style>
                canvas {
                    display: block;
                }
            </style>
            <canvas width="400" height="100"></canvas>
        `;
        this.canvas = notnull(shadowRoot.querySelector('canvas'));
        this.canvas.height = 100;
        this.canvas.width = 400;
        this.ctx = notnull(this.canvas.getContext('2d'));

        this.mouse_down = false;


        this.initial_y_value = 0.5;
        /** @type {((prev_samp: number, desired_samp: number, seconds_per_sample: number) => number) | null} */
        this.max_slope_callback = null;

        this.on_mouse_down = this.on_mouse_down.bind(this);
        this.on_mouse_up = this.on_mouse_up.bind(this);
        this.on_mouse_move = this.on_mouse_move.bind(this);

        this.last_x_perc = 0;
        this.last_y_perc = 0;

        this.stroke_color = "black";
    }

    #_fill_random_samples() {
        const [r1, r2] = [Math.random(), Math.random()];
        const low = Math.min(r1, r2);
        const high = Math.max(r1, r2);
        const value = Math.random() * 0.8 + 0.2;
        for (let i = NUM_SAMPLES*low; i < NUM_SAMPLES*high; i++) {
            this.#_input_samples[Math.floor(i)] = value;
        }
    }

    connectedCallback() {
        this.addEventListener("mousedown", this.on_mouse_down, { passive: true });
        document.addEventListener("mouseup", this.on_mouse_up, { passive: true });
        document.addEventListener("mousemove", this.on_mouse_move, { passive: true });

        this.stroke_color = this.getAttribute("stroke-color") || "black";

        const iyv = this.getAttribute("initial-y-value");
        this.initial_y_value = iyv ? parseFloat(iyv) : this.initial_y_value;
        this.#_input_samples.fill(this.initial_y_value);

        if (!this.getAttribute("no-fill-random")) this.#_fill_random_samples();

        this.#_resize_observer.observe(this);
        this.#_on_self_resize();
    }

    disconnectedCallback() {
        this.removeEventListener("mousedown", this.on_mouse_down);
        document.removeEventListener("mouseup", this.on_mouse_up);
        document.removeEventListener("mousemove", this.on_mouse_move);
    }

    on_mouse_down(e) {
        this.mouse_down = true;
        const rect = this.canvas.getBoundingClientRect();
        this.last_x_perc = (e.clientX - rect.left) / this.canvas.width;
        this.last_y_perc = 1 - ((e.clientY - rect.top) / this.canvas.height);
    }
    on_mouse_up(e) {
        this.mouse_down = false;
    }
    on_mouse_move(e) {
        if (this.mouse_down) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const x_perc = Math.max(Math.min(x / this.canvas.width, 1), 0);
            const y_perc = Math.max(Math.min(1 - (y / this.canvas.height), 1), 0);
            // set all from this.last_x_perc to x_perc to linterp last_y_perc to y_perc
            const x0 = Math.floor(this.last_x_perc * NUM_SAMPLES);
            const x1 = Math.floor(x_perc * NUM_SAMPLES);
            const y0 = this.last_y_perc;
            const y1 = y_perc;
            const [xlow, ylow, xhigh, yhigh] = x0 < x1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0];
            // console.log(xlow, ylow, xhigh, yhigh);

            for (let i = xlow; i <= xhigh; i++) {
                const perc = (i - xlow) / (xhigh - xlow + 1e-6);
                const desired_samp = ylow + perc * (yhigh - ylow);
                this.#_input_samples[i] = desired_samp;
            }

            this.last_x_perc = x_perc;
            this.last_y_perc = y_perc;

            this.draw_samples();
            this.#_emit_input_event();
        }
    }
    #_compute_output_samples() {
        if (this.max_slope_callback == null) return this.#_input_samples.slice();

        const seconds_per_sample = this.#_total_duration / NUM_SAMPLES;
        const output_samples = this.#_input_samples.slice();
        let prev_samp = this.initial_y_value;
        for (let i = 0; i < NUM_SAMPLES; i++) {
            const desired_samp = this.#_input_samples[i];

            const curr_samp = this.max_slope_callback(prev_samp, desired_samp, seconds_per_sample);

            output_samples[i] = curr_samp;
            prev_samp = curr_samp;
        }

        return output_samples;
    }

    #_emit_input_event() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
    }

    #_total_duration = DEFAULT_TOTAL_DURATION_SEC;
    #_active_duration = DEFAULT_TOTAL_DURATION_SEC;
    set_total_duration(duration) {
        this.#_total_duration = duration;
        this.#_active_duration = duration;
        this.draw_samples();
    }
    get_total_duration() {
        return this.#_total_duration;
    }
    set_active_duration(duration) {
        this.#_active_duration = duration;
        this.draw_samples();
    }
    get_active_duration() {
        return this.#_active_duration;
    }
    get_input_samples() {
        return this.#_input_samples.slice();
    }

    get_output_samples() {
        return this.#_compute_output_samples();
    }

    #_draw_grid() {
        // draw 1 second grid lines, and 0.25 amplitude lines
        this.ctx.beginPath();
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "#BDBDBD";
        const line_dist = this.canvas.width / this.#_total_duration;
        for (let i = 1; i < this.#_total_duration; i++) {
            this.ctx.moveTo(i * line_dist, 0);
            this.ctx.lineTo(i * line_dist, this.canvas.height);
        }
        for (let i = 1; i < 4; i++) {
            this.ctx.moveTo(0, i * this.canvas.height / 4);
            this.ctx.lineTo(this.canvas.width, i * this.canvas.height / 4);
        }
        this.ctx.stroke();

        // 0.5 second minor grid lines
        this.ctx.beginPath();
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "#EFEFEF";
        for (let i = 0; i < this.#_total_duration; i++) {
            this.ctx.moveTo(i * line_dist + line_dist/2, 0);
            this.ctx.lineTo(i * line_dist + line_dist/2, this.canvas.height);
        }
        this.ctx.stroke();

        // render text labels for 1 second grid lines
        this.ctx.fillStyle = "#909090";
        this.ctx.font = "12px Arial";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        for (let i = 1; i < this.#_total_duration; i++) {
            this.ctx.fillText(i.toString()+"s", i * line_dist, this.canvas.height - 5);
        }
    }

    draw_samples() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.#_draw_grid();

        this.#_draw_samples(this.#_input_samples, "#aeaeae"); // draw input samples in gray
        const output_samples = this.#_compute_output_samples();
        this.#_draw_samples(output_samples);

        // draw gray box for inactive duration
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.33)";
        const start_x = this.canvas.width * this.#_active_duration / this.#_total_duration;
        this.ctx.fillRect(start_x, 0, this.canvas.width - start_x, this.canvas.height);
    }
    #_draw_samples(samples, stroke_color = this.stroke_color) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvas.height * (1 - samples[0]));
        this.ctx.lineWidth = 8;
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = stroke_color;
        for (let i = 1; i < NUM_SAMPLES; i++) {
            const samp = samples[i];
            this.ctx.lineTo(i * this.canvas.width / NUM_SAMPLES, this.canvas.height * (1 - samp));
        }
        this.ctx.stroke();
    }

    reset_samples_to(value = 0.5) {
        this.#_input_samples.fill(value);
        this.draw_samples();
    }

}


window.customElements.define('draw-canvas', DrawCanvasElement);