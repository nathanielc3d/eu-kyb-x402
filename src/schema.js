// Tiny JSON Schema checker for the subset used in lax-offer.json (no dependencies, runs offline).
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => t === "number" ? typeof v === "number" : typeOf(v) === t;

export function validateSchema(schema, value, at = "$") {
  const errs = [];
  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => validateSchema(s, value, at).length === 0)) errs.push(`${at} matches none of anyOf`);
    return errs;
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return [`${at} should be ${types.join(" or ")}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at} should be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${at} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${at} is longer than ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${at} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${at} is above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at} has fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(schema.items, v, `${at}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}.${k} is required`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) errs.push(...validateSchema(s, value[k], `${at}.${k}`));
    if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!(k in (schema.properties || {}))) errs.push(`${at}.${k} is not allowed`);
  }
  return errs;
}
