import pg from 'pg';

export type Db = pg.Pool;

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', (e) => console.error('[db] idle client error', e.message));
  return pool;
}

/** Idempotent schema. All queries elsewhere use parameters ($1…) — never string interpolation. */
const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  pw_hash text not null,
  mfa_secret text,
  mfa_enabled boolean not null default false,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,            -- sha256(token); the raw token only lives in the cookie
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text not null default '',
  revoked boolean not null default false
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists password_resets (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false
);
create table if not exists documents (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  title text not null default 'Untitled',
  state bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists members (
  doc_id text not null references documents(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner','editor','commenter','viewer')),
  primary key (doc_id, user_id)
);
create index if not exists members_user on members(user_id);
create table if not exists links (
  id text primary key,
  doc_id text not null references documents(id) on delete cascade,
  token_hash text not null unique,
  role text not null check (role in ('editor','commenter','viewer')),
  expires_at timestamptz,
  revoked boolean not null default false,
  created_by text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists comments (
  id text primary key,
  doc_id text not null references documents(id) on delete cascade,
  slide_id text not null,
  element_id text,
  parent_id text references comments(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_doc on comments(doc_id);
create table if not exists versions (
  id serial primary key,
  doc_id text not null references documents(id) on delete cascade,
  label text not null,
  state bytea not null,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id text,
  ip text,
  action text not null,
  doc_id text,
  detail jsonb
);
create index if not exists audit_log_doc_at on audit_log (doc_id, at desc) where doc_id is not null;
create index if not exists audit_log_user_at on audit_log (user_id, at desc);
`;

export async function migrate(db: Db) {
  await db.query(SCHEMA);
}

export async function audit(db: Db, action: string, data: { userId?: string | null; ip?: string; docId?: string | null; detail?: unknown }) {
  await db.query('insert into audit_log (user_id, ip, action, doc_id, detail) values ($1,$2,$3,$4,$5)', [data.userId ?? null, data.ip ?? null, action, data.docId ?? null, data.detail === undefined ? null : JSON.stringify(data.detail)]).catch((e) => console.error('[audit]', e.message));
}
