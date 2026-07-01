-- ==============================
-- V2: New features migration
-- Asset metadata, notifications, storage bucket
-- Re-runnable (idempotent)
-- ==============================

-- 1. ADD NEW COLUMNS TO ASSETS
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS file_path TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS subtitle_path TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS received_resolution TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS received_fps TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS delivered_resolution TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS delivered_fps TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS duration TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS audio_channel TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS thumbnail_base64 TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS year_month TEXT DEFAULT ''; -- e.g. '2026-06' for grouping
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_ref TEXT DEFAULT ''; -- extracted from video_location filename (e.g. 3770096LAS)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS bundle TEXT DEFAULT ''; -- user-defined set/group name

-- 2. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  asset_id BIGINT REFERENCES public.assets(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','review_request','new_asset','re_edit','approval','comment')),
  message TEXT NOT NULL,
  link TEXT DEFAULT '',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);

-- RLS
DROP POLICY IF EXISTS "Notifications viewable by own user" ON public.notifications;
DROP POLICY IF EXISTS "Notifications updatable by own user" ON public.notifications;
DROP POLICY IF EXISTS "Notifications insertable by authenticated" ON public.notifications;
CREATE POLICY "Notifications viewable by own user" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "Notifications updatable by own user" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Notifications insertable by authenticated" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- 3. STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('asset-files', 'asset-files', true, 52428800, '{application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,image/png,image/jpeg,image/webp,application/x-adobe-premiere}')
ON CONFLICT (id) DO NOTHING;

-- Storage RLS (public read, authenticated write)
DROP POLICY IF EXISTS "Public read" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "Own update" ON storage.objects;
DROP POLICY IF EXISTS "Own delete" ON storage.objects;
CREATE POLICY "Public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'asset-files');
CREATE POLICY "Authenticated upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'asset-files');
CREATE POLICY "Own update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'asset-files');
CREATE POLICY "Own delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'asset-files');

-- 4. NOTIFICATION FUNCTION (callable from frontend or trigger)
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_from_user_id UUID DEFAULT NULL,
  p_asset_id BIGINT DEFAULT NULL,
  p_type TEXT DEFAULT 'info',
  p_message TEXT DEFAULT '',
  p_link TEXT DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  INSERT INTO public.notifications (user_id, from_user_id, asset_id, type, message, link)
  VALUES (p_user_id, p_from_user_id, p_asset_id, p_type, p_message, p_link)
  RETURNING id INTO notif_id;
  RETURN json_build_object('id', notif_id);
END;
$$;

-- 5. FUNCTION: notify all reviewers (called when editor sends for approval)
CREATE OR REPLACE FUNCTION public.notify_reviewers(
  p_from_user_id UUID,
  p_asset_id BIGINT,
  p_message TEXT DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, from_user_id, asset_id, type, message, link)
  SELECT p.id, p_from_user_id, p_asset_id, 'review_request', 
         COALESCE(p_message, 'Asset requires review'),
         '/asset-detail?id=' || p_asset_id
  FROM public.profiles p
  WHERE p.role IN ('reviewer', 'admin') AND p.is_active = true AND p.id != p_from_user_id;
END;
$$;

-- 6. FUNCTION: notify all users (called when new asset added)
CREATE OR REPLACE FUNCTION public.notify_all_users(
  p_from_user_id UUID DEFAULT NULL,
  p_asset_id BIGINT DEFAULT NULL,
  p_message TEXT DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, from_user_id, asset_id, type, message, link)
  SELECT p.id, p_from_user_id, p_asset_id, 'new_asset',
         COALESCE(p_message, 'New asset added'),
         '/asset-detail?id=' || p_asset_id
  FROM public.profiles p
  WHERE p.is_active = true AND (p.id != p_from_user_id OR p_from_user_id IS NULL);
END;
$$;

-- Grants for all RPCs
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_reviewers TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_all_users TO authenticated;
