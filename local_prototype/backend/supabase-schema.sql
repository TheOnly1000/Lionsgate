-- ==============================
-- LIONSGATE ASSET MANAGEMENT
-- Run this in Supabase SQL Editor
-- ==============================

-- 1. PROFILES TABLE (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','reviewer')),
  avatar_url TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'editor'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Delete auth user when profile is deleted (admin user management)
CREATE OR REPLACE FUNCTION public.handle_delete_user()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_deleted ON public.profiles;
CREATE TRIGGER on_profile_deleted
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_delete_user();

-- 2. ASSETS TABLE
CREATE TABLE IF NOT EXISTS public.assets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sheet_row INTEGER UNIQUE,
  files_available TEXT,
  title TEXT NOT NULL,
  video_location TEXT,
  cc_location TEXT,
  first_air_date TEXT,
  amagi_comments TEXT DEFAULT 'Pending',
  notes TEXT DEFAULT '',
  extra_col_h TEXT,
  extra_col_i TEXT,
  extra_col_j TEXT,
  extra_col_k TEXT,
  editor_status TEXT DEFAULT 'Pending',
  assigned_editor UUID REFERENCES public.profiles(id),
  editor_assigned_at TIMESTAMPTZ,
  reviewer_status TEXT DEFAULT 'Pending',
  assigned_reviewer UUID REFERENCES public.profiles(id),
  reviewer_assigned_at TIMESTAMPTZ,
  asset_ref TEXT DEFAULT '',
  bundle TEXT DEFAULT '',
  is_synced BOOLEAN DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- 3. TICKETS TABLE
CREATE TABLE IF NOT EXISTS public.tickets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  assigned_to UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- 4. TICKET COMMENTS TABLE
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;

-- 5. ACTIVITY LOG TABLE
CREATE TABLE IF NOT EXISTS public.activity_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT REFERENCES public.assets(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_assets_title ON public.assets(title);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_editor ON public.assets(assigned_editor);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_reviewer ON public.assets(assigned_reviewer);
CREATE INDEX IF NOT EXISTS idx_assets_editor_status ON public.assets(editor_status);
CREATE INDEX IF NOT EXISTS idx_assets_reviewer_status ON public.assets(reviewer_status);
CREATE INDEX IF NOT EXISTS idx_tickets_asset_id ON public.tickets(asset_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON public.tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON public.tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_activity_log_asset_id ON public.activity_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON public.activity_log(created_at DESC);

-- RLS POLICIES (drop first so script is re-runnable)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles insertable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles deletable by admin" ON public.profiles;
DROP POLICY IF EXISTS "Assets are viewable by authenticated" ON public.assets;
DROP POLICY IF EXISTS "Assets updatable by authenticated" ON public.assets;
DROP POLICY IF EXISTS "Assets insertable by authenticated" ON public.assets;
DROP POLICY IF EXISTS "Assets deletable by authenticated" ON public.assets;
DROP POLICY IF EXISTS "Tickets viewable by authenticated" ON public.tickets;
DROP POLICY IF EXISTS "Tickets creatable by authenticated" ON public.tickets;
DROP POLICY IF EXISTS "Tickets updatable by authenticated" ON public.tickets;
DROP POLICY IF EXISTS "Tickets deletable by authenticated" ON public.tickets;
DROP POLICY IF EXISTS "Comments viewable by authenticated" ON public.ticket_comments;
DROP POLICY IF EXISTS "Comments creatable by authenticated" ON public.ticket_comments;
DROP POLICY IF EXISTS "Activity viewable by authenticated" ON public.activity_log;
DROP POLICY IF EXISTS "Activity insertable by authenticated" ON public.activity_log;

CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Profiles insertable by authenticated" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Profiles deletable by admin" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));
CREATE POLICY "Assets are viewable by authenticated" ON public.assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Assets updatable by authenticated" ON public.assets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Assets insertable by authenticated" ON public.assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Assets deletable by authenticated" ON public.assets FOR DELETE TO authenticated USING (true);
CREATE POLICY "Tickets viewable by authenticated" ON public.tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tickets creatable by authenticated" ON public.tickets FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Tickets updatable by authenticated" ON public.tickets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Tickets deletable by authenticated" ON public.tickets FOR DELETE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "Comments viewable by authenticated" ON public.ticket_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Comments creatable by authenticated" ON public.ticket_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Activity viewable by authenticated" ON public.activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Activity insertable by authenticated" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- 6. AUTH RPC (bypass rate limits — uses internal auth.sign_up which isn't rate-limited)
DROP FUNCTION IF EXISTS public.create_auth_user;
CREATE FUNCTION public.create_auth_user(email text, password text, name text DEFAULT '')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_user_id uuid;
BEGIN
  new_user_id := auth.sign_up(email, password);
  UPDATE auth.users SET raw_user_meta_data = jsonb_build_object('name', COALESCE(name, split_part(email, '@', 1)))
  WHERE id = new_user_id;
  RETURN json_build_object('id', new_user_id, 'email', email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_auth_user TO anon, authenticated;

-- 7. SEED DATA
-- Run backend/seed-sheet.sql separately to load all assets from the Google Sheet (~3,510 rows)
-- That file deletes old data and re-inserts everything.
