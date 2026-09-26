-- Deterministic demo data (no random()), so every reset reproduces the BRD numbers exactly:
--   48,391 users = 48,213 real-looking (last login > 90 days ago, 3 of them admins) + 178 QA test users
--   DELETE ... WHERE last_login_at < now() - interval '90 days'  → 48,213 rows, 3 admins, cascades into orders + sessions
--   DELETE ... WHERE email LIKE '%@test.local'                    → 178 rows, no admins

-- Real-looking users (ids 1..48213).
INSERT INTO users (email, name, role, password_hash, last_login_at)
SELECT
  lower(f.first) || '.' || lower(l.last) || n || '@' || (ARRAY['gmail.com','outlook.com','yahoo.com','icloud.com','acme.co','proton.me'])[1 + n % 6],
  f.first || ' ' || l.last,
  CASE WHEN n IN (7, 1804, 30211) THEN 'admin' ELSE 'user' END,
  '$2b$10$' || md5(n::text),
  now() - make_interval(days => 91 + (n % 700))
FROM generate_series(1, 48213) AS n
CROSS JOIN LATERAL (SELECT (ARRAY['Maria','James','Aisha','Chen','Lucas','Priya','Omar','Sofia','Daniel','Yuki','Elena','Kwame'])[1 + n % 12] AS first) f
CROSS JOIN LATERAL (SELECT (ARRAY['Lopez','Smith','Khan','Wei','Martin','Patel','Hassan','Rossi','Kim','Tanaka','Novak','Mensah'])[1 + (n / 12) % 12] AS last) l;

-- QA test users (ids 48214..48391): recent logins, test.local emails.
INSERT INTO users (email, name, role, password_hash, last_login_at)
SELECT 'qa' || n || '@test.local', 'QA Test ' || n, 'user', '$2b$10$' || md5('qa' || n), now() - interval '2 days'
FROM generate_series(1, 178) AS n;

-- Orders: 1,204 across real users. Sessions: 5,310 across real users.
INSERT INTO orders (user_id, total_cents)
SELECT 1 + (n * 37) % 48213, 1000 + n % 9000 FROM generate_series(1, 1204) AS n;

INSERT INTO sessions (user_id, token)
SELECT 1 + (n * 11) % 48213, md5('session' || n) FROM generate_series(1, 5310) AS n;

INSERT INTO payments (order_ref, amount_cents, status)
SELECT n, 1000 + n % 9000, CASE WHEN n % 50 = 0 THEN 'refund_pending' ELSE 'settled' END FROM generate_series(1, 1204) AS n;

-- Documents: 34,012, of which 118 are new (no embedding yet).
INSERT INTO documents (title, body, embedding)
SELECT
  'Support article ' || n,
  repeat('How to reset your password, update billing details and manage team seats. ', 12),
  CASE WHEN n > 33894 THEN NULL ELSE ARRAY[0.1, 0.2, 0.3]::real[] END
FROM generate_series(1, 34012) AS n;

ANALYZE;
