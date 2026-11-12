-- Additive account tables. Existing sample tables are unchanged.
CREATE TABLE IF NOT EXISTS "wdp_auth_users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE IF NOT EXISTS "wdp_auth_sessions" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "wdp_auth_users" ("id") on delete cascade);

CREATE TABLE IF NOT EXISTS "wdp_auth_accounts" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "wdp_auth_users" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE IF NOT EXISTS "wdp_auth_verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE IF NOT EXISTS "wdp_auth_rate_limits" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

CREATE INDEX IF NOT EXISTS "wdp_auth_sessions_userId_idx" on "wdp_auth_sessions" ("userId");

CREATE INDEX IF NOT EXISTS "wdp_auth_accounts_userId_idx" on "wdp_auth_accounts" ("userId");

CREATE INDEX IF NOT EXISTS "wdp_auth_verifications_identifier_idx" on "wdp_auth_verifications" ("identifier");
CREATE TABLE IF NOT EXISTS wdp_customer_profiles (auth_user_id TEXT PRIMARY KEY REFERENCES wdp_auth_users(id) ON DELETE CASCADE, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
