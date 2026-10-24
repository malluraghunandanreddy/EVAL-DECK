// SDK catalog: package/import names -> vendor, default region, data types it typically receives.
// `thirdParty: false` entries are libraries (no data leaves the app because of them alone) used only as signals.

export type VendorCategory = "llm" | "analytics" | "error" | "email" | "sms" | "payments" | "vector" | "backend" | "ads";

export type SdkEntry = {
  id: string; // stable slug, used in gap ids
  vendor: string; // display name
  category: VendorCategory;
  region: "us" | "eu" | "in" | "unknown";
  dataTypes: string[];
  thirdParty: boolean;
  npm: (string | RegExp)[];
  py: (string | RegExp)[];
  usage?: RegExp; // call sites that send data to the vendor
  urls?: RegExp; // script tags / REST endpoints
  summary: string;
};

export const SDK_CATALOG: SdkEntry[] = [
  { id: "openai", vendor: "OpenAI", category: "llm", region: "us", dataTypes: ["chat_history"], thirdParty: true,
    npm: ["openai", "@ai-sdk/openai"], py: ["openai"], usage: /\.(chat\.)?completions\.create\s*\(|\.responses\.create\s*\(|\.embeddings\.create\s*\(/,
    urls: /api\.openai\.com/, summary: "Sends prompts (and anything included in them) to OpenAI in the US." },
  { id: "anthropic", vendor: "Anthropic", category: "llm", region: "us", dataTypes: ["chat_history"], thirdParty: true,
    npm: ["@anthropic-ai/sdk", "@ai-sdk/anthropic"], py: ["anthropic"], usage: /\.messages\.create\s*\(|\.messages\.stream\s*\(/,
    urls: /api\.anthropic\.com/, summary: "Sends prompts to Anthropic in the US." },
  { id: "google_ai", vendor: "Google Gemini", category: "llm", region: "us", dataTypes: ["chat_history"], thirdParty: true,
    npm: ["@google/generative-ai", "@google/genai", "@ai-sdk/google"], py: ["google.generativeai", "google.genai", "google-generativeai", "google-genai"],
    usage: /generateContent(Stream)?\s*\(|sendMessage\s*\(/, urls: /generativelanguage\.googleapis\.com/, summary: "Sends prompts to Google Gemini." },
  { id: "posthog", vendor: "PostHog", category: "analytics", region: "us", dataTypes: ["device", "ip"], thirdParty: true,
    npm: ["posthog-js", "posthog-node"], py: ["posthog"], usage: /posthog\.(capture|identify|init|people)|client\.capture\s*\(/i,
    urls: /posthog\.com/, summary: "Product analytics: events, device info and IP address go to PostHog." },
  { id: "mixpanel", vendor: "Mixpanel", category: "analytics", region: "us", dataTypes: ["device", "ip"], thirdParty: true,
    npm: ["mixpanel", "mixpanel-browser"], py: ["mixpanel"], usage: /mixpanel\.(track|identify|people|init)/i,
    urls: /mixpanel\.com/, summary: "Product analytics: events, device info and IP address go to Mixpanel." },
  { id: "google_analytics", vendor: "Google Analytics", category: "analytics", region: "us", dataTypes: ["device", "ip"], thirdParty: true,
    npm: ["react-ga", "react-ga4", "@next/third-parties", "vue-gtag"], py: [], usage: /\bgtag\s*\(|ReactGA\.(event|send|initialize)/,
    urls: /googletagmanager\.com|google-analytics\.com/, summary: "Web analytics: page views, device info and IP go to Google." },
  { id: "sentry", vendor: "Sentry", category: "error", region: "us", dataTypes: ["ip", "device"], thirdParty: true,
    npm: [/^@sentry\//], py: ["sentry_sdk", "sentry-sdk"], usage: /Sentry\.(init|capture\w*|setUser)|sentry_sdk\.(init|capture\w*)/,
    urls: /sentry\.io/, summary: "Error tracking: stack traces, request data, IP and user context go to Sentry." },
  { id: "firebase", vendor: "Firebase (Google)", category: "backend", region: "us", dataTypes: ["email", "device"], thirdParty: true,
    npm: ["firebase", "firebase-admin"], py: ["firebase_admin", "firebase-admin"], summary: "Auth, database or analytics hosted by Google Firebase." },
  { id: "supabase", vendor: "Supabase", category: "backend", region: "unknown", dataTypes: ["email"], thirdParty: true,
    npm: ["@supabase/supabase-js", "@supabase/ssr"], py: ["supabase"], summary: "Database and auth hosted by Supabase." },
  { id: "pinecone", vendor: "Pinecone", category: "vector", region: "us", dataTypes: ["chat_history"], thirdParty: true,
    npm: ["@pinecone-database/pinecone"], py: ["pinecone", "pinecone-client"], usage: /\.upsert\s*\(/, summary: "Vector database storing embeddings of user text." },
  { id: "weaviate", vendor: "Weaviate", category: "vector", region: "unknown", dataTypes: ["chat_history"], thirdParty: true,
    npm: ["weaviate-client", "weaviate-ts-client"], py: ["weaviate", "weaviate-client"], summary: "Vector database storing embeddings of user text." },
  { id: "pgvector", vendor: "pgvector", category: "vector", region: "unknown", dataTypes: ["chat_history"], thirdParty: false,
    npm: ["pgvector"], py: ["pgvector"], summary: "Embeddings of user text stored in Postgres." },
  { id: "langchain", vendor: "LangChain", category: "llm", region: "unknown", dataTypes: ["chat_history"], thirdParty: false,
    npm: [/^@langchain\//, "langchain"], py: [/^langchain/], usage: /new\s+Chat(OpenAI|Anthropic|GoogleGenerativeAI)\b|Chat(OpenAI|Anthropic)\s*\(/,
    summary: "LLM orchestration library; data goes to whichever model provider it is configured with." },
  { id: "resend", vendor: "Resend", category: "email", region: "us", dataTypes: ["email", "name"], thirdParty: true,
    npm: ["resend"], py: ["resend"], usage: /\.emails\.send\s*\(/, summary: "Transactional email: recipient address and content go to Resend." },
  { id: "sendgrid", vendor: "SendGrid", category: "email", region: "us", dataTypes: ["email", "name"], thirdParty: true,
    npm: ["@sendgrid/mail"], py: ["sendgrid"], usage: /sgMail\.send|\.send\s*\(/, summary: "Transactional email: recipient address and content go to SendGrid." },
  { id: "nodemailer", vendor: "Nodemailer (SMTP)", category: "email", region: "unknown", dataTypes: ["email"], thirdParty: false,
    npm: ["nodemailer"], py: [], summary: "Sends email through an SMTP provider." },
  { id: "twilio", vendor: "Twilio", category: "sms", region: "us", dataTypes: ["phone"], thirdParty: true,
    npm: ["twilio"], py: ["twilio"], usage: /messages\.create\s*\(|verify\./, summary: "SMS/OTP: phone numbers and message content go to Twilio." },
  { id: "stripe", vendor: "Stripe", category: "payments", region: "us", dataTypes: ["email", "payment", "name"], thirdParty: true,
    npm: ["stripe", "@stripe/stripe-js"], py: ["stripe"], summary: "Payments: card and billing details go to Stripe." },
  { id: "razorpay", vendor: "Razorpay", category: "payments", region: "in", dataTypes: ["email", "phone", "payment"], thirdParty: true,
    npm: ["razorpay"], py: ["razorpay"], urls: /checkout\.razorpay\.com/, summary: "Payments: contact and payment details go to Razorpay." },
  { id: "pinelabs", vendor: "Pine Labs", category: "payments", region: "in", dataTypes: ["email", "phone", "payment"], thirdParty: true,
    npm: [/pinelabs|plural/i], py: [/pinelabs/i], urls: /pinepg\.in|pinelabs\.com|plural\w*\.pinepg/, summary: "Payments: contact and payment details go to Pine Labs." },
];

export function sdkForPackage(name: string, lang: "npm" | "py"): SdkEntry | undefined {
  return SDK_CATALOG.find((e) =>
    (lang === "npm" ? e.npm : e.py).some((p) => (typeof p === "string" ? name === p || name.startsWith(p + "/") || name.startsWith(p + ".") : p.test(name))),
  );
}

export function sdkById(id: string): SdkEntry | undefined {
  return SDK_CATALOG.find((e) => e.id === id);
}
