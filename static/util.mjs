/**
 * Assert Not Null
 * @template T
 * @param {T | null} v
 * @returns {T}
 */
export function notnull(v) {
	if (v != null) return v;
	else throw new TypeError("Unexpected null");
}
/**
 *
 * @param {never} x
 * @returns {never}
 */
export function assert_unreachable(x) {
	throw new Error("Unexpected variant: " + x);
}

/**
 * Wait for a given number of milliseconds.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>}
 */
export async function wait_ms(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}