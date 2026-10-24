// Name-based PII classification shared by code detectors, schema parsers (and T9's DB checks).

export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

const USERISH_TABLE = /user|customer|profile|member|account|contact|patient|lead|person|people|employee|student|subscriber/i;

/**
 * Data types an identifier (column, field, object key) names.
 * mode "column" is for schema columns; "code" is stricter to avoid noise (e.g. window.location, message).
 */
export function classifyName(name: string, mode: "column" | "code" = "column", table?: string): string[] {
  const t = splitIdentifier(name);
  if (t.length === 0) return [];
  const joined = t.join("");
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const out = new Set<string>();

  if (has("email", "mail") || joined.includes("email")) out.add("email");
  if (has("phone", "mobile", "whatsapp", "msisdn", "tel") || joined.includes("phone")) out.add("phone");
  if (has("ip") || /ipaddr|remoteaddr|forwardedfor|clientip/.test(joined)) out.add("ip");
  const addrIdx = t.indexOf("address");
  if ((addrIdx >= 0 && !["ip", "email", "mail", "remote", "mac", "wallet"].includes(t[addrIdx - 1] ?? "")) ||
      has("street", "pincode", "zipcode", "postcode", "postal") || joined === "zip") out.add("address");
  if (has("dob", "birthday", "birthdate") || joined.includes("dateofbirth") || joined.includes("birth")) out.add("dob");
  if (has("aadhaar", "aadhar", "uidai")) out.add("aadhaar");
  if (has("pan") && (t.length <= 3) || joined.includes("pannumber") || joined.includes("pancard")) out.add("pan");
  if (has("gender", "sex")) out.add("gender");
  if (has("latitude", "longitude", "geolocation", "geo", "coords", "coordinates") ||
      (mode === "column" && has("location", "lat", "lng", "lon"))) out.add("location");
  if (/chathistory|chatlog|conversationhistory|conversations?$|transcript|messagehistory|chatmessages/.test(joined) ||
      (mode === "column" && has("history", "messages", "chat", "conversation"))) out.add("chat_history");
  if (has("useragent", "fingerprint") || joined.includes("useragent") || joined.includes("deviceid") ||
      (mode === "column" && has("device"))) out.add("device");
  if (/cardnumber|cardno|upi|iban|accountnumber|ifsc|cvv/.test(joined)) out.add("payment");
  // "name" is a person only when the identifier is not naming a repo, project, file, table, org, plan, site, branch...
  const NOT_A_PERSON = ["repo", "repository", "project", "app", "application", "file", "filename", "table", "column", "org", "organization", "company", "plan", "site", "branch", "model", "product", "package", "host", "domain", "bucket", "role", "event", "type", "tag", "label"];
  const namedThing = t.some((w) => NOT_A_PERSON.includes(w));
  if (!namedThing && (/fullname|firstname|lastname|displayname|surname|username/.test(joined) ||
      (mode === "column" && joined === "name" && (!table || USERISH_TABLE.test(table))))) out.add("name");
  return [...out];
}

// Patterns in raw source lines that reveal PII collection without a clean identifier.
const LINE_PATTERNS: [RegExp, string][] = [
  [/x-forwarded-for|x-real-ip|remoteAddress|req\.ip\b|request\.remote_addr|REMOTE_ADDR|\$ip\b/i, "ip"],
  [/user-agent|navigator\.userAgent/i, "device"],
  [/navigator\.geolocation/, "location"],
];

/** Data types mentioned in a source line (identifiers, string keys, request headers). */
export function classifyLine(line: string): string[] {
  const out = new Set<string>();
  for (const [re, dt] of LINE_PATTERNS) if (re.test(line)) out.add(dt);
  const ids = line.match(/[A-Za-z_$][\w$-]*/g) ?? [];
  for (const id of ids) {
    if (id.length < 2 || id.length > 40) continue;
    for (const dt of classifyName(id, "code")) out.add(dt);
  }
  return [...out];
}

/** Data types mentioned in natural-language text (policy text, claim strings). */
const TEXT_PATTERNS: [RegExp, string][] = [
  [/e-?mail/i, "email"],
  [/phone|mobile number|whatsapp|contact number/i, "phone"],
  [/\bip\b|ip address|internet protocol/i, "ip"],
  [/(?<!ip |e-?mail |email )\b(postal |home |billing |shipping )?address\b|pin ?code|zip code/i, "address"],
  [/chat|conversation|messages you send|transcript|support ticket/i, "chat_history"],
  [/device|browser|user agent|cookies?/i, "device"],
  [/aadhaa?r/i, "aadhaar"],
  [/\bpan\b|permanent account number/i, "pan"],
  [/\bname\b/i, "name"],
  [/date of birth|\bdob\b|birthday|\bage\b/i, "dob"],
  [/gender/i, "gender"],
  [/location|gps|geolocation/i, "location"],
  [/payment|card|billing|upi/i, "payment"],
];

export function classifyText(text: string): string[] {
  return TEXT_PATTERNS.filter(([re]) => re.test(text)).map(([, dt]) => dt);
}

export const DATA_TYPE_LABEL: Record<string, string> = {
  email: "email address", phone: "phone number", ip: "IP address", address: "postal address",
  chat_history: "chat history", device: "device / browser data", aadhaar: "Aadhaar number", pan: "PAN",
  name: "name", dob: "date of birth", gender: "gender", location: "location", payment: "payment details",
};
