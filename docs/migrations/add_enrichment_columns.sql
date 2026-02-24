-- ================================================================
-- Migration: Add enrichment v2 columns to gtm_leads
-- Run this in Supabase SQL Editor (Dashboard > SQL > New Query)
-- ================================================================

-- SIRET (French business registration number, 14 digits)
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS siret TEXT;

-- Dirigeant (company director/decision-maker full name)
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS dirigeant TEXT;

-- Dirigeant LinkedIn URL
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS dirigeant_linkedin TEXT;

-- Email provider detected from MX records (google, microsoft, ovh, etc.)
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS mx_provider TEXT;

-- Whether the domain has MX records (can receive email)
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS has_mx BOOLEAN DEFAULT true;

-- Comma-separated list of enrichment sources that were tried
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS enrichment_source TEXT;

-- Final enrichment confidence score (0-100)
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS enrichment_confidence INTEGER DEFAULT 0;

-- Timestamp when enrichment was last run
ALTER TABLE gtm_leads ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- ================================================================
-- Indexes for enrichment queries
-- ================================================================

-- Index for filtering enriched vs unenriched leads
CREATE INDEX IF NOT EXISTS idx_gtm_leads_enriched_at ON gtm_leads (enriched_at);

-- Index for filtering by enrichment confidence
CREATE INDEX IF NOT EXISTS idx_gtm_leads_enrichment_confidence ON gtm_leads (enrichment_confidence);

-- Index for SIRET lookups
CREATE INDEX IF NOT EXISTS idx_gtm_leads_siret ON gtm_leads (siret) WHERE siret IS NOT NULL;

-- Composite index for the enrichment query (website not null, email is null)
CREATE INDEX IF NOT EXISTS idx_gtm_leads_enrich_candidates
  ON gtm_leads (website, email)
  WHERE website IS NOT NULL AND website != '' AND (email IS NULL OR email = '');

-- ================================================================
-- Verify
-- ================================================================
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'gtm_leads'
-- ORDER BY ordinal_position;
