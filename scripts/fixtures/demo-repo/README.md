# demo-ai-support-bot

Planted demo repo for PolicyDrift tests (T8). An Express support bot that sends the full chat history to OpenAI,
captures IP in PostHog, reports errors to Sentry, stores phone + IP + raw chat log on `User`, embeds tickets with
pgvector, never deletes anything, and ships a privacy policy that claims only name + email and no third parties.
