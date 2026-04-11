-- ═══════════════════════════════════════════════════════════
-- Knowledge Base Articles
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kb_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  excerpt       TEXT,
  content       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'opste',
  tags          TEXT[] DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  featured      BOOLEAN DEFAULT FALSE,
  sort_order    INTEGER DEFAULT 0,
  cover_image   TEXT,
  view_count    INTEGER DEFAULT 0,
  author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_slug       ON kb_articles(slug);
CREATE INDEX IF NOT EXISTS idx_kb_articles_status      ON kb_articles(status);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category    ON kb_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_featured    ON kb_articles(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_kb_articles_sort        ON kb_articles(sort_order, created_at DESC);
