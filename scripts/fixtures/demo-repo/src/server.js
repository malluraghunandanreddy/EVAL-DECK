const express = require("express");
const Sentry = require("@sentry/node");
const { PostHog } = require("posthog-node");
const OpenAI = require("openai");
const { PrismaClient } = require("@prisma/client");
const pgvector = require("pgvector");

Sentry.init({ dsn: process.env.SENTRY_DSN, sendDefaultPii: true });

const app = express();
app.use(express.json());
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const posthog = new PostHog(process.env.POSTHOG_KEY);

app.post("/signup", async (req, res) => {
  const { name, email, phone } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const user = await prisma.user.create({ data: { name, email, phone, ip } });
  posthog.identify({ distinctId: user.id, properties: { email, phone, $ip: ip } });
  res.json({ id: user.id });
});

app.post("/chat", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.body.userId } });
  const history = user.chatLog || [];
  history.push({ role: "user", content: req.body.message });

  // Send the whole conversation so the bot "remembers" the customer
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `You are a support bot. Customer: ${user.name}, ${user.email}, phone ${user.phone}` },
      ...history,
    ],
  });
  const reply = completion.choices[0].message.content;
  history.push({ role: "assistant", content: reply });
  await prisma.user.update({ where: { id: user.id }, data: { chatLog: history } });

  posthog.capture({ distinctId: user.id, event: "chat_message", properties: { $ip: req.ip, length: req.body.message.length } });
  console.log("chat from", user.email, req.ip);
  res.json({ reply });
});

app.post("/tickets", async (req, res) => {
  const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: req.body.text });
  const vec = pgvector.toSql(emb.data[0].embedding);
  await prisma.$executeRaw`INSERT INTO "Embedding" (id, "userId", "ticketText", embedding) VALUES (gen_random_uuid(), ${req.body.userId}, ${req.body.text}, ${vec}::vector)`;
  res.json({ ok: true });
});

Sentry.setupExpressErrorHandler(app);
app.listen(process.env.PORT || 3000);
