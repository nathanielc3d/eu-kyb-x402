export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
export const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
