/** Error with a stable code the UI maps to a human message. */
export class ModelError extends Error {
  constructor(code, detail = {}) { super(code); this.code = code; this.detail = detail; }
}
