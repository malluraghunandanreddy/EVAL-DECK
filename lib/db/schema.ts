import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, bigint } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).unique(),
  githubLogin: text("github_login"),
  email: text("email"),
  githubTokenEnc: text("github_token_enc"),
  privateRepoAccess: boolean("private_repo_access").notNull().default(false),
  isPro: boolean("is_pro").notNull().default(false),
  // Set by a paid Pro month. Null means Pro never expires (redeem codes, manual grants).
  proUntil: timestamp("pro_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  markets: text("markets").array().notNull(),
  frameworks: text("frameworks").array().notNull(),
  policyUrl: text("policy_url"),
  repoFullName: text("repo_full_name"),
  defaultBranch: text("default_branch"),
  source: text("source").notNull().default("github"),
  zipPath: text("zip_path"),
  lastScannedSha: text("last_scanned_sha"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  watch: boolean("watch").notNull().default(true),
  dbEnvHints: text("db_env_hints").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  status: text("status").notNull().default("queued"),
  commitSha: text("commit_sha"),
  policyClaims: jsonb("policy_claims"),
  codeFindings: jsonb("code_findings"),
  schemaFindings: jsonb("schema_findings"),
  dbFindings: jsonb("db_findings"),
  gaps: jsonb("gaps"),
  checklist: jsonb("checklist"),
  coverage: jsonb("coverage"),
  error: text("error"),
  // Set when this one report was bought (single report plan). Pro monthly unlocks every report instead.
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  outOfDate: boolean("out_of_date").notNull().default(false),
});

export const policyVersions = pgTable("policy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull(),
  scanId: uuid("scan_id").notNull(),
  policyMd: text("policy_md").notNull(),
  termsMd: text("terms_md").notNull(),
  summary: text("summary"),
  status: text("status").notNull().default("pending_review"),
  reviewerNote: text("reviewer_note"),
  agentRunId: text("agent_run_id"),
  agentMode: text("agent_mode"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const piiTags = pgTable("pii_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  tableName: text("table_name").notNull(),
  columnName: text("column_name").notNull(),
  dataType: text("data_type").notNull(),
  source: text("source").notNull().default("user"),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  pinelabsOrderId: text("pinelabs_order_id"),
  merchantOrderRef: text("merchant_order_ref").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  status: text("status").notNull().default("created"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// In-app notifications written by the Drift Watch agent (new commit, new gaps, policy draft ready).
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id"),
  scanId: uuid("scan_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type PolicyVersion = typeof policyVersions.$inferSelect;
