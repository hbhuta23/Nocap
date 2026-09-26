-- nocap demo database (BRD §5.1, B21). Loaded automatically by Postgres on first start
-- (docker-compose mounts demo/seed into /docker-entrypoint-initdb.d). Reset: npm run demo:reset

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'user',
  password_hash text NOT NULL,
  last_login_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The two tables a user delete cascades into (FR-D2): the agent never mentions them.
CREATE TABLE orders (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_cents int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Protected in .nocap.yml (and a good team-rule demo: "Never touch the payments table").
CREATE TABLE payments (
  id          serial PRIMARY KEY,
  order_ref   int NOT NULL,
  amount_cents int NOT NULL,
  status      text NOT NULL DEFAULT 'settled'
);

-- Spend demo (§5.2): documents to embed. Only a handful are new (embedding IS NULL).
CREATE TABLE documents (
  id        serial PRIMARY KEY,
  title     text NOT NULL,
  body      text NOT NULL,
  embedding real[]
);

-- Foreign-key indexes (as any real schema has): without them, cascading a 48k-row user delete scans
-- orders and sessions once per user and blows through the dry run's 3 s statement timeout.
CREATE INDEX orders_user_id_idx ON orders(user_id);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
