-- ==============================
-- V3: Sets table + real-time
-- Re-runnable (idempotent)
-- ==============================

-- 1. SETS TABLE (stores set metadata)
CREATE TABLE IF NOT EXISTS public.sets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.sets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sets_name ON public.sets(name);

-- 2. SET ASSETS JUNCTION TABLE (links assets to sets)
CREATE TABLE IF NOT EXISTS public.set_assets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id BIGINT NOT NULL REFERENCES public.sets(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(set_id, asset_id)
);
ALTER TABLE public.set_assets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_set_assets_set ON public.set_assets(set_id);
CREATE INDEX IF NOT EXISTS idx_set_assets_asset ON public.set_assets(asset_id);

-- 3. RLS POLICIES
DROP POLICY IF EXISTS "Sets viewable by authenticated" ON public.sets;
DROP POLICY IF EXISTS "Sets insertable by authenticated" ON public.sets;
DROP POLICY IF EXISTS "Sets updatable by authenticated" ON public.sets;
DROP POLICY IF EXISTS "Sets deletable by authenticated" ON public.sets;
CREATE POLICY "Sets viewable by authenticated" ON public.sets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Sets insertable by authenticated" ON public.sets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Sets updatable by authenticated" ON public.sets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Sets deletable by authenticated" ON public.sets FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Set assets viewable by authenticated" ON public.set_assets;
DROP POLICY IF EXISTS "Set assets insertable by authenticated" ON public.set_assets;
DROP POLICY IF EXISTS "Set assets deletable by authenticated" ON public.set_assets;
CREATE POLICY "Set assets viewable by authenticated" ON public.set_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Set assets insertable by authenticated" ON public.set_assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Set assets deletable by authenticated" ON public.set_assets FOR DELETE TO authenticated USING (true);

-- 4. ENABLE REALTIME (Supabase Realtime)
-- These enable Postgres changes to be broadcast on the realtime channel
ALTER PUBLICATION supabase_realtime ADD TABLE public.sets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.set_assets;
