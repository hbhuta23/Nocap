"""Backfill search embeddings for help-center documents.

For each document: write a short search summary with a chat model, then embed the summary.
"""
import os
import sys

# Demo safety: never spend real money unless explicitly enabled (checked before importing anything).
if os.environ.get("NOCAP_DEMO_REAL_CALLS") != "1":
    print("demo mode: no API calls made (set NOCAP_DEMO_REAL_CALLS=1 to really run)")
    sys.exit(0)

from openai import OpenAI  # noqa: E402
import psycopg  # noqa: E402

client = OpenAI()
conn = psycopg.connect(os.environ["DATABASE_URL"])

rows = conn.execute("SELECT id, body FROM documents").fetchall()

for doc_id, body in rows:
    summary = client.chat.completions.create(
        model="gpt-5",
        max_tokens=1000,
        messages=[{"role": "user", "content": f"Write a search summary of this help article:\n\n{body}"}],
    ).choices[0].message.content
    embedding = client.embeddings.create(model="text-embedding-3-large", input=summary).data[0].embedding
    conn.execute("UPDATE documents SET embedding = %s WHERE id = %s", (embedding, doc_id))

conn.commit()
print(f"embedded {len(rows)} documents")
