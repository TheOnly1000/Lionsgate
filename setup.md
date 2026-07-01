# Lionsgate Asset Management Application — Complete Setup Guide

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Navigation & Tab Structure](#3-navigation--tab-structure)
4. [Database Schema](#4-database-schema)
5. [Status Options & Workflow](#5-status-options--workflow)
6. [Auto-Workflow Engine](#6-auto-workflow-engine)
7. [UI — Every Page, Tab & Side Panel](#7-ui--every-page-tab--side-panel)
8. [Supabase Setup](#8-supabase-setup)
9. [Google APIs Setup](#9-google-apis-setup)
10. [Backend Setup](#10-backend-setup)
11. [Frontend Setup](#11-frontend-setup)
12. [Deployment](#12-deployment)
13. [Precautions](#13-precautions)

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE SHEETS                                      │
│  "Updated Priority List 9/22" tab                                          │
│  Columns: A(Files) B(Title) C(Video) D(CC) E(Air) F(Amagi) G(Notes) H+    │
│  ▲ Read: all rows (every 5 min)            ▼ Write: only column F cell     │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  Google Sheets API v4 (Service Account)
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  BACKEND SERVER (Node.js + Express, port 3001)              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ services/                                                          │   │
│  │  ├── sheetService.js    — readSheet(), writeAmagiComment()          │   │
│  │  ├── syncService.js     — syncSheetToDb() — maps columns → assets   │   │
│  │  ├── writebackService.js— detect DB changes → write to sheet        │   │
│  │  ├── emailService.js    — sendEmail(type, asset, user)              │   │
│  │  └── activityService.js — logAction(assetId, userId, action, data)  │   │
│  │                                                                     │   │
│  │ routes/                                                             │   │
│  │  ├── sync.js     → GET/POST /api/sync, GET /api/sync/status        │   │
│  │  ├── assets.js   → GET /api/assets                                  │   │
│  │  └── health.js   → GET /api/health                                  │   │
│  │                                                                     │   │
│  │ scheduler: cron every 5 min → syncSheetToDb()                       │   │
│  │ realtime listener: Supabase `assets` changes → writebackService     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  Supabase service_role key (server-side only)
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                      SUPABASE (PostgreSQL + Auth + Realtime)               │
│                                                                             │
│  Tables:  profiles | assets | tickets | ticket_comments | activity_log     │
│  Auth:    Google OAuth                                                      │
│  RLS:     Row-level security per role (admin/editor/reviewer)               │
│  Realtime: assets, tickets, activity_log (WebSocket push to frontend)       │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  anon key (client-side, RLS-enforced)
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite → GitHub Pages)                   │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  src/                                                                ││
│  │  ├── auth/      → Login.jsx, SessionContext.jsx                       ││
│  │  ├── layouts/   → AppLayout.jsx (navbar + sidebar)                    ││
│  │  ├── pages/     → 7 main pages (see Section 3)                       ││
│  │  ├── components/→ 30+ reusable components (see Section 7)            ││
│  │  ├── hooks/     → useAuth.js, useAssets.js, useTickets.js, useRt.js  ││
│  │  └── lib/       → supabase.js client, constants.js                   ││
│  └────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | React | 18.x | UI framework |
| | Vite | 5.x | Build tool + dev server |
| | react-router-dom | 6.x | Client-side routing |
| | @supabase/supabase-js | 2.x | Supabase client (auth, db, realtime) |
| | CSS Modules or Tailwind | — | Styling |
| Backend | Node.js | 18+ | Runtime |
| | Express | 4.x | HTTP server |
| | googleapis | 130+ | Google Sheets + Gmail API |
| | @supabase/supabase-js | 2.x | Supabase admin client |
| | node-cron | 3.x | Sync scheduler |
| Database | Supabase (PostgreSQL 15) | — | Relational database |
| Auth | Supabase Auth + Google OAuth | — | Authentication |
| Realtime | Supabase Realtime (WebSocket) | — | Live updates |
| Hosting | GitHub Pages | — | Frontend (static) |
| | Local machine / VPS | — | Backend server |

---

## 3. Navigation & Tab Structure

### 3.1 Permission Model

| Role | Editor Tab | Reviewer Tab | Assets Library | Tickets | Activity | Admin |
|------|:----------:|:------------:|:--------------:|:-------:|:--------:|:-----:|
| Editor | ✅ | ❌ Blocked | ✅ | ✅ | ✅ | ❌ |
| Reviewer | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Key rule:** Editors cannot see or access the Reviewer tab at all. Reviewers can see both the Editor tab and the Reviewer tab.

### 3.2 Navigation Bar

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🎬 LIONSGATE   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]  [📈 Activity] │
│  ASSET MGMT     [⚙️ Admin]                                                          │
│                                                                                      │
│  Nav items shown based on role:                                                      │
│  - Editor sees:   [✏️ Editor]  [📚 Assets]  [🎫 Tickets]  [📈 Activity]              │
│  - Reviewer sees: [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]  [📈 Activity]│
│  - Admin sees:    all of the above + [⚙️ Admin]                                      │
│                                                                                      │
│  If editor navigates to /reviewer/* → redirect to /editor or show 403               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Every Tab & Sub-Tab (Tree View)

```
✏️ EDITOR TAB (Editors + Reviewers + Admins)
 ├── 📌 Quick Stats Bar
 │    └── Working: 5 | Pending: 12 | Re-Edit: 3 | Sent for Approval: 2 | Total Mine: 22
 │
 ├── 📋 My Assigned Assets
 │    ├── Card View [grid, 4 columns]
 │    └── List View [sortable table]
 │    Filters: Status | Search
 │    Actions: [Open] [Release] [Status dropdown quick-change]
 │
 ├── 📥 Available for Assignment (unassigned assets)
 │    └── [Assign Me] button on each card
 │
 ├── 📤 Sent for Review (waiting on reviewer)
 │    └── Assets where editor_status = "Send for approval"
 │
 ├── 🔁 Re-Edit Required (returned by reviewer)
 │    └── Assets where editor_status = "Re-Edit"
 │    Shows reviewer comment
 │
 └── 🔄 Recently Updated (activity feed, last 10)

👁️ REVIEWER TAB (Reviewers + Admins ONLY — Editors cannot see this tab at all)
 ├── 📌 Quick Stats Bar
 │    └── Need to Review: 7 | Reviewing: 2 | Approved Today: 4 | Re-Edit Today: 1
 │
 ├── 📥 Pending Review Queue
 │    ├── Card View
 │    └── List View (sorted by send time, newest first)
 │    Shows: Title | Sent by | Time ago | [Review] button
 │
 ├── 🔍 In Review (currently reviewing)
 │    └── Assets where assigned_reviewer = me AND reviewer_status = "Reviewing"
 │
 ├── ✅ Reviewed Today
 │    └── Approved / Re-Edit actions performed today
 │
 ├── 📊 Review History
 │    └── All past reviews with date/action/notes
 │
 └── 🔄 Recently Updated (activity feed, last 10)

📚 ASSETS (All users)
 ├── All Assets
 │    ├── Card View [grid, 4 columns]
 │    └── List View [sortable table]
 │    Filters: Editor Status | Reviewer Status | Amagi Comment | Air Date | Search
 │
 ├── By Status [collapsible groups]
 │    └── Working / Pending / Re-Edit / Send for Approval / Approved / etc.
 │
 └── By Assignee [grouped by editor/reviewer]
      └── Unassigned / Assigned to Me / Assigned to [name]

🎫 TICKETS (All users)
 ├── All Tickets
 │    Table: # | Title | Asset | Status | Priority | Assignee | Created
 │    Filters: Status | Priority | Asset | Assignee | Search
 │
 ├── My Tickets (created by me)
 │    └── Same table, filtered to created_by = me
 │
 ├── Assigned to Me
 │    └── Same table, filtered to assigned_to = me
 │
 ├── Open Tickets (not closed/resolved)
 │    └── Same table, filtered to status IN (open, in_progress)
 │
 └── By Asset [grouped by asset]
      └── Each asset shows its tickets as expandable list

📈 ACTIVITY (All users)
 ├── All Activity
 │    └── Infinite scroll feed: "John changed COOTIES to Working"
 │    Filters: User | Asset | Action Type | Date Range
 │
 ├── My Activity
 │    └── Only actions performed by me
 │
 └── Status Changes (filtered view)
      └── Only status transition entries

⚙️ ADMIN (Admins only)
 ├── User Management
 │    ├── Table: Name | Email | Role | Created | Last Login | Status
 │    ├── Edit User: change role (editor/reviewer/admin), disable account
 │    └── [Invite User] button
 │
 ├── Role Permissions
 │    └── Visual matrix of which role can access which tab
 │
 ├── Sync Settings
 │    ├── Last Sync: timestamp, rows synced, errors
 │    ├── [Trigger Manual Sync] button
 │    └── Sync Interval: [5 min ▾]
 │
 ├── Sheet Configuration
 │    ├── Spreadsheet ID (read-only)
 │    ├── Tab Name (read-only)
 │    └── [Test Connection] button
 │
 └── App Logs
      └── Backend logs viewer (last 100 lines)
```

### 3.4 Detailed Asset Detail Page (opened as page, not modal)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Assets                       📄 Asset Detail: COOTIES            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ LEFT SIDE (2/3 width) ──────────────────────────┬─ RIGHT SIDE ────────┐│
│  │                                                    │ (1/3 width)        ││
│  │ ┌─── Asset Info ─────────────────────────────┐    │ ┌─── Workflow ────┐││
│  │ │ Title:         COOTIES                     │    │ │                  ││
│  │ │ Files Avail:   June                        │    │ │ Editor Status:   ││
│  │ │ Air Date:      6/24                        │    │ │ [Working    ▾]  ││
│  │ │ Video Loc:     /amagicloud/.../9382654.mp4 │    │ │                  ││
│  │ │ CC Loc:        Not available               │    │ │ Reviewer Status: ││
│  │ │ Notes:         [editable text area]        │    │ │ [Pending    ▾]  ││
│  │ └────────────────────────────────────────────┘    │ │                  ││
│  │                                                    │ │ Amagi Comments:  ││
│  │ ┌─── Tabs ───────────────────────────────────┐    │ │ [Hires Upld ▾]  ││
│  │ │ [📋 Tickets] [💬 Comments] [📜 Activity]   │    │ │                  ││
│  │ │                                              │    │ │ Assigned To:     ││
│  │ │ ┌─── Tickets Tab ──────────────────────┐    │    │ │ Editor: John ▾ ││
│  │ │ │ [+ Create Ticket]                     │    │    │ │ Reviewer: — ▾  ││
│  │ │ │ ┌────┬──────────┬────────┬────────┐  │    │    │ │                  ││
│  │ │ │ │ #  │ Title    │ Status │ Prio   │  │    │    │ │ [📤 Send for    ││
│  │ │ │ │ 42 │ Missing  │ 🟢Open  │ High   │  │    │    │ │  Approval]      ││
│  │ │ │ │    │ CC       │        │        │  │    │    │ │                  ││
│  │ │ │ │ 41 │ Wrong    │ 🟡In    │ Low    │  │    │    │ └──────────────────┘│
│  │ │ │ │    │ path     │ Progr. │        │  │    │    │                    ││
│  │ │ │ └────┴──────────┴────────┴────────┘  │    │    │ ┌─── Sync Info ──┐ ││
│  │ │ │ Click row → ticket detail modal      │    │    │ │ Sheet Row: 3   │ │
│  │ │ └─────────────────────────────────────┘    │    │ │ Last Sync: 2m  │ │
│  │ │                                              │    │ │ Status: ✅     │ │
│  │ │ ┌─── Comments Tab ────────────────────┐    │    │ └────────────────┘ ││
│  │ │ │ Asset-level comments (not tickets)  │    │    │                    ││
│  │ │ │ ┌────────────────────────────────┐  │    │    └────────────────────┘│
│  │ │ │ │ John: Working on this now      │  │    │                          │
│  │ │ │ │ Jane: Please check CC path     │  │    │                          │
│  │ │ │ └────────────────────────────────┘  │    │                          │
│  │ │ │ [Write a comment...]      [Send]   │    │                          │
│  │ │ └─────────────────────────────────────┘    │                          │
│  │ │                                              │                          │
│  │ │ ┌─── Activity Tab ───────────────────┐    │                          │
│  │ │ │ 🔄 Live (auto-updates)             │    │                          │
│  │ │ │ • John → Working           12:30  │    │                          │
│  │ │ │ • John → Hires Uploaded    12:25  │    │                          │
│  │ │ │ • Synced from sheet        12:00  │    │                          │
│  │ │ │ • Ticket #42 created       11:40  │    │                          │
│  │ │ └─────────────────────────────────────┘    │                          │
│  │ └────────────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Schema

### 4.1 Complete Table Definitions

#### Table: `profiles`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, REFERENCES auth.users ON DELETE CASCADE | Supabase Auth user ID |
| email | TEXT | UNIQUE, NOT NULL | User email from Google |
| full_name | TEXT | | Display name |
| avatar_url | TEXT | | Google profile photo |
| role | TEXT | NOT NULL, DEFAULT 'editor', CHECK IN ('admin','editor','reviewer') | Access role |
| is_active | BOOLEAN | DEFAULT true | Soft disable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

#### Table: `assets`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| sheet_row | INTEGER | UNIQUE | Row number in Google Sheet |
| files_available | TEXT | | Column A |
| title | TEXT | NOT NULL | Column B — movie title |
| video_location | TEXT | | Column C — S3/Amagicloud path |
| cc_location | TEXT | | Column D — subtitle path |
| first_air_date | TEXT | | Column E |
| amagi_comments | TEXT | DEFAULT 'Pending' | Column F — written back to sheet |
| notes | TEXT | | Column G |
| extra_col_h | TEXT | | Column H — priority number |
| extra_col_i | TEXT | | Column I — extra notes |
| extra_col_j | TEXT | | Column J |
| extra_col_k | TEXT | | Column K |
| editor_status | TEXT | DEFAULT 'Pending' | Editor workflow status |
| assigned_editor | UUID | REFERENCES profiles(id) | Currently assigned editor |
| editor_assigned_at | TIMESTAMPTZ | | When editor was assigned |
| reviewer_status | TEXT | DEFAULT 'Pending' | Reviewer workflow status |
| assigned_reviewer | UUID | REFERENCES profiles(id) | Currently assigned reviewer |
| reviewer_assigned_at | TIMESTAMPTZ | | When reviewer was assigned |
| is_synced | BOOLEAN | DEFAULT FALSE | Whether synced from sheet |
| last_synced_at | TIMESTAMPTZ | | Last sync timestamp |
| sheet_hash | TEXT | | MD5 hash of sheet row for change detection |
| last_amagi_written | TEXT | | Last value we wrote to sheet (avoid loops) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

#### Table: `tickets`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| asset_id | UUID | NOT NULL, REFERENCES assets(id) ON DELETE CASCADE | Parent asset |
| title | TEXT | NOT NULL | Short summary |
| description | TEXT | | Detailed description |
| status | TEXT | NOT NULL, DEFAULT 'open', CHECK IN ('open','in_progress','resolved','closed') | |
| priority | TEXT | NOT NULL, DEFAULT 'medium', CHECK IN ('low','medium','high','critical') | |
| created_by | UUID | NOT NULL, REFERENCES profiles(id) | Ticket creator |
| assigned_to | UUID | REFERENCES profiles(id) | Person responsible |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

#### Table: `ticket_comments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| ticket_id | UUID | NOT NULL, REFERENCES tickets(id) ON DELETE CASCADE | |
| user_id | UUID | NOT NULL, REFERENCES profiles(id) | |
| content | TEXT | NOT NULL | Comment body |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

#### Table: `activity_log`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| asset_id | UUID | REFERENCES assets(id) ON DELETE SET NULL | Related asset |
| user_id | UUID | REFERENCES profiles(id) | Who performed action |
| action | TEXT | NOT NULL | Action type (status_change, ticket_created, etc.) |
| details | JSONB | DEFAULT '{}' | Extra data (old_status, new_status, etc.) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

### 4.2 Indexes

```sql
-- Assets
CREATE INDEX idx_assets_title ON assets(title);
CREATE INDEX idx_assets_amagi_comments ON assets(amagi_comments);
CREATE INDEX idx_assets_assigned_editor ON assets(assigned_editor);
CREATE INDEX idx_assets_assigned_reviewer ON assets(assigned_reviewer);
CREATE INDEX idx_assets_editor_status ON assets(editor_status);
CREATE INDEX idx_assets_reviewer_status ON assets(reviewer_status);
CREATE INDEX idx_assets_first_air_date ON assets(first_air_date);
CREATE INDEX idx_assets_sheet_row ON assets(sheet_row);
CREATE INDEX idx_assets_is_synced ON assets(is_synced);

-- Tickets
CREATE INDEX idx_tickets_asset_id ON tickets(asset_id);
CREATE INDEX idx_tickets_assigned_to ON tickets(assigned_to);
CREATE INDEX idx_tickets_created_by ON tickets(created_by);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_priority ON tickets(priority);

-- Activity Log
CREATE INDEX idx_activity_log_asset_id ON activity_log(asset_id);
CREATE INDEX idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX idx_activity_log_action ON activity_log(action);
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at DESC);

-- Ticket Comments
CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
```

### 4.3 RLS Policies

```sql
-- PROFILES
-- Users can read all profiles (for assignment dropdowns)
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
-- Users can update only their own profile
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- Admin can update any profile
CREATE POLICY "profiles_admin_update" ON profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ASSETS
-- Everyone can read all assets
CREATE POLICY "assets_select" ON assets FOR SELECT TO authenticated USING (true);
-- Editors can update editor fields + amagi_comments
CREATE POLICY "assets_editor_update" ON assets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('editor','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('editor','admin')));
-- Reviewers can update reviewer fields + amagi_comments
CREATE POLICY "assets_reviewer_update" ON assets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('reviewer','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('reviewer','admin')));
-- Backend service can create/update all (via service_role key)
CREATE POLICY "assets_service_insert" ON assets FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "assets_service_update" ON assets FOR UPDATE TO service_role USING (true);

-- TICKETS
CREATE POLICY "tickets_select" ON tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "tickets_insert" ON tickets FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "tickets_update" ON tickets FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (created_by = auth.uid() OR assigned_to = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- TICKET COMMENTS
CREATE POLICY "comments_select" ON ticket_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON ticket_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ACTIVITY LOG
CREATE POLICY "activity_select" ON activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_insert" ON activity_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR auth.role() = 'service_role');
```

---

## 5. Status Options & Workflow

### 5.1 Editor Status — Complete List (30 options)

| # | Status | Category | Meaning | Next Typical Step |
|---|--------|----------|---------|-------------------|
| 1 | Pending | 📋 Initial | Not yet worked on | Working |
| 2 | Working | 🔧 Active | Editor is actively working | Converted / Downloaded |
| 3 | Converted | ✅ Complete | File converted | Ready for Hi-Rez |
| 4 | Downloaded | ✅ Complete | File downloaded | Rendering Preview / Working |
| 5 | Issue | ❌ Blocked | Problem encountered | Create ticket |
| 6 | Kept for Converting | ⏸️ Hold | Held for conversion | Converted |
| 7 | Kept for downloading | ⏸️ Hold | Held for download | Downloaded |
| 8 | Movie not available | ❌ Blocked | Source missing | — |
| 9 | Need to Review | 🔄 Handoff | Waiting for self-review | Review Done |
| 10 | Not Available in S3 | ❌ Blocked | S3 path missing | — |
| 11 | Re-Edit | 🔧 Active | Needs re-editing | Re-Edit Done |
| 12 | Re-Edit Done | ✅ Complete | Re-edit complete | Ready for Hi-Rez |
| 13 | Re-Render | 🔧 Active | Needs re-render | Renderd Hi-Res file |
| 14 | Re-Upload | 🔧 Active | Needs re-upload | Uploaded |
| 15 | Re-Uploading | 🔧 Active | Currently re-uploading | Uploaded |
| 16 | Re-work | 🔧 Active | General rework | Working |
| 17 | Ready for Hi-Rez | ✅ Stage | Ready for hi-res render | Rendering Hi-Res file |
| 18 | Ready to upload | ✅ Stage | Ready for upload | Uploaded |
| 19 | Renderd Hi-Res file | ✅ Complete | Hi-res render done | Ready to upload |
| 20 | Rendered Prev & Hires | ✅ Complete | Both preview and hi-res done | Ready to upload |
| 21 | Rendered Preview file | ✅ Complete | Preview render done | Ready for Hi-Rez |
| 22 | Rendering Hi-Res file | 🔧 Active | Hi-res currently rendering | Renderd Hi-Res file |
| 23 | Rendering Preview file | 🔧 Active | Preview currently rendering | Rendered Preview file |
| 24 | Review Done | ✅ Complete | Self-review complete | Send for approval |
| 25 | Reviewing $name | 🔄 Handoff | Being reviewed by someone | Review Done |
| 26 | Send for approval | 🚀 Handoff | **Sent to reviewer queue** | — |
| 27 | Subtitle not available | ❌ Blocked | Missing subtitle file | — |
| 28 | Transcording | 🔧 Active | Transcoding in progress | Uploaded |
| 29 | Uploaded | ✅ Complete | Upload complete | Send for approval |
| 30 | Uploading | 🔧 Active | Currently uploading | Uploaded |
| 31 | Already Done | ✅ Complete | Previously completed | — |
| 32 | Uploaded - Need to verify | 🔄 Handoff | Uploaded but unverified | Send for approval |
| 33 | Re-Work | 🔧 Active | Needs rework (duplicate of #16) | Working |

### 5.2 Reviewer Status — Complete List (8 options)

| # | Status | Meaning | Next Typical Step |
|---|--------|---------|-------------------|
| 1 | Need to Review | Awaiting reviewer action | Reviewing |
| 2 | Reviewing | Currently being reviewed | Approved / Re-Edit |
| 3 | Review Done | Review completed | — |
| 4 | Approved | **Approved — sheet updates** | — |
| 5 | Re-Edit | Send back to editor | editor_status → "Re-Edit" |
| 6 | Re-Work | Send back for rework | editor_status → "Re-Work" |
| 7 | Re-Re-Render | Needs another render | editor_status → "Re-Render" |
| 8 | Issue | Problem found | Auto-create ticket |

### 5.3 Amagi Comments — Written to Sheet (12 options)

| # | Comment | When Used |
|---|---------|-----------|
| 1 | Approved | Reviewer approves asset |
| 2 | Working | Editor is actively working |
| 3 | Pending | Default / not yet started |
| 4 | SharedPrev | Preview shared with client |
| 5 | No subtitle | Subtitle file doesn't exist |
| 6 | Not Available in S3 | Video file missing from S3 |
| 7 | Hires Uploaded | Hi-res version uploaded |
| 8 | Ready to Share | Ready for client sharing |
| 9 | Already Received Before | Duplicate/received earlier |
| 10 | Location Paths Not Available | File paths missing |
| 11 | Received | File has been received |
| 12 | Subtitle issue | Problem with subtitle |

### 5.4 Status Flow Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                     SHEET                           │
                    │  New row appears → Backend syncs → assets table     │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │                 ASSET CREATED                       │
                    │  editor_status: Pending                             │
                    │  reviewer_status: Pending                           │
                    │  amagi_comments: Pending (from sheet or default)    │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                    ┌──────────────────────▼──────────────────────────────┐
                    │              EDITOR WORKS ON ASSET                  │
                    │                                                    │
                    │  ┌──────────────┐                                  │
                    │  │  Pending     │                                  │
                    │  └──────┬───────┘                                  │
                    │         │ Editor clicks "Assign Me"                │
                    │  ┌──────▼───────┐                                  │
                    │  │  Working     │ ◄──── Assigned to editor         │
                    │  └──────┬───────┘                                  │
                    │         │                                          │
                    │    ┌────┴────────────────┐                         │
                    │    │                     │                         │
                    │  ┌─▼──────────┐    ┌─────▼───────┐                │
                    │  │ Converted  │    │ Downloaded  │                │
                    │  │ Downloaded │    │ Rendered    │                │
                    │  │ Uploaded   │    │ Preview     │                │
                    │  │ etc.       │    │ etc.        │                │
                    │  └─┬──────────┘    └─────┬───────┘                │
                    │    │                     │                         │
                    │    └──────┬──────────────┘                         │
                    │           │                                        │
                    │    ┌──────▼──────────────┐                         │
                    │    │ Send for Approval   │                         │
                    │    └──────┬──────────────┘                         │
                    └───────────┼────────────────────────────────────────┘
                                │
                                ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │             AUTO: Send for Approval Workflow                       │
    │                                                                     │
    │  ├── editor_status     → "Send for approval"                      │
    │  ├── reviewer_status   → "Need to Review"                          │
    │  ├── activity_log      → "{editor} sent {title} for approval"     │
    │  ├── EMAIL → All reviewers: "{title} needs your review"            │
    │  └── LIVE → Asset appears in all Reviewer dashboards              │
    └────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌─────────────────────────────────────────────────────┐
                    │            REVIEWER REVIEWS ASSET                   │
                    │                                                    │
                    │  ┌──────────────┐                                  │
                    │  │ Need to      │                                  │
                    │  │ Review       │                                  │
                    │  └──────┬───────┘                                  │
                    │         │ Reviewer clicks "Review"                 │
                    │  ┌──────▼───────┐                                  │
                    │  │  Reviewing   │                                  │
                    │  └──────┬───────┘                                  │
                    │         │                                          │
                    │    ┌────┴────────────┐                             │
                    │    │                 │                             │
                    │  ┌─▼──────────┐  ┌───▼────────┐                   │
                    │  │ Approved   │  │  Re-Edit    │                   │
                    │  └─┬──────────┘  └───┬────────┘                   │
                    │    │                 │                             │
                    └────┼─────────────────┼─────────────────────────────┘
                         │                 │
                         ▼                 ▼
    ┌────────────────────────┐    ┌────────────────────────────────────┐
    │ APPROVED WORKFLOW      │    │ RE-EDIT WORKFLOW                  │
    │                        │    │                                   │
    │ ├─ reviewer_status     │    │ ├─ reviewer_status → "Re-Edit"   │
    │ │  → "Approved"        │    │ ├─ editor_status  → "Re-Edit"    │
    │ ├─ amagi_comments      │    │ ├─ auto-create ticket if          │
    │ │  → "Approved"        │    │ │  reviewer left comment          │
    │ ├─ Write to Sheet:     │    │ ├─ EMAIL → editor:               │
    │ │  Col F, Row {n}      │    │ │  "{title} needs re-edit"        │
    │ │  = "Approved"        │    │ ├─ Asset reappears in Editor      │
    │ ├─ EMAIL → editor:     │    │ │  dashboard marked "Re-Edit"     │
    │ │  "{title} approved"  │    │ └─ activity_log updated           │
    │ └─ activity_log updated│    │                                   │
    └────────────────────────┘    └────────────────────────────────────┘
```

---

## 6. Auto-Workflow Engine

### 6.1 Triggers & Actions

| Trigger Condition | Action | Details |
|-------------------|--------|---------|
| `editor_status` → "Send for approval" | Notify reviewers | Email + dashboard badge |
| `reviewer_status` → "Approved" | Write to sheet | `writeAmagiComment(row, "Approved")` |
| `reviewer_status` → "Approved" | Notify editor | Email: "Asset approved" |
| `reviewer_status` → "Re-Edit" | Reset editor status | `editor_status` → "Re-Edit" |
| `reviewer_status` → "Re-Edit" | Notify editor | Email: "Re-edit requested" |
| Ticket created | Notify assignee | Email: "Ticket assigned to you" |
| Ticket resolved | Notify creator | Email: "Your ticket was resolved" |
| `assigned_editor` changed | Log activity | `logAction(assetId, userId, "assigned_editor")` |
| Sheet sync | Update `is_synced`, `last_synced_at` | Background cron |

### 6.2 Email Notification Templates

**Template: New for Review**
```
Subject: [Action Required] {title} is ready for review

Hi {reviewer_name},

{editor_name} has sent "{title}" for your review.

Asset Details:
  - Title: {title}
  - Video: {video_location}
  - CC: {cc_location}
  - Air Date: {first_air_date}

Click here to review: {app_url}/assets/{asset_id}

---
Lionsgate Asset Management
```

**Template: Asset Approved**
```
Subject: ✅ {title} has been approved

Hi {editor_name},

{reviewer_name} has approved "{title}".

The Amagi comment has been updated to "Approved" in the sheet.

---
Lionsgate Asset Management
```

**Template: Re-Edit Requested**
```
Subject: 🔄 Re-Edit requested for {title}

Hi {editor_name},

{reviewer_name} has requested re-edits on "{title}".

Comment: {comment}

Click here to view: {app_url}/assets/{asset_id}

---
Lionsgate Asset Management
```

**Template: Ticket Assigned**
```
Subject: 🎫 Ticket #{ticket_id} assigned to you

Hi {assignee_name},

You have been assigned a ticket on "{title}".

Ticket: {ticket_title}
Priority: {priority}
Description: {description}

Click here: {app_url}/tickets/{ticket_id}

---
Lionsgate Asset Management
```

---

## 7. UI — Every Page, Tab & Side Panel

### 7.1 Complete Component Tree

```
src/
├── main.jsx                         # Entry point
├── App.jsx                          # Router + session provider
├── supabase.js                      # Supabase client
├── constants.js                     # Status lists, colors, etc.
│
├── auth/
│   ├── Login.jsx                    # Google OAuth login page
│   └── SessionContext.jsx           # Auth state context provider
│
├── layouts/
│   ├── AppLayout.jsx                # Navbar + sidebar + content area
│   ├── Navbar.jsx                   # Top navigation bar
│   ├── Sidebar.jsx                  # Left sidebar (context-sensitive)
│   └── Footer.jsx                   # Version info, links
│
├── pages/
│   ├── EditorTab.jsx                # ✏️ Editor Tab — editors + reviewers
│   │   ├── QuickStatsBar.jsx        # Counts by status
│   │   ├── MyAssignedAssets.jsx     # Assets assigned to current user (editor)
│   │   ├── AvailableAssets.jsx      # Unassigned, claimable assets
│   │   ├── SentForReview.jsx        # Sent to reviewers, waiting
│   │   ├── ReEditRequired.jsx       # Returned by reviewer for re-edit
│   │   └── RecentActivity.jsx       # Last 10 activity entries
│   │
│   ├── ReviewerTab.jsx              # 👁️ Reviewer Tab — reviewers + admins ONLY
│   │   ├── ReviewerQuickStats.jsx   # Counts by reviewer status
│   │   ├── PendingReviewQueue.jsx   # Assets needing review (Need to Review)
│   │   ├── InReview.jsx             # Currently being reviewed by me
│   │   ├── ReviewedToday.jsx        # Today's approvals/rejects
│   │   ├── ReviewHistory.jsx        # All past reviews
│   │   └── ReviewerActivity.jsx     # Last 10 activity entries
│   │
│   ├── AssetsLibrary.jsx            # All assets page — all roles
│   │   ├── AllAssetsTab.jsx         # "All Assets" sub-tab
│   │   ├── ByStatusTab.jsx          # "By Status" grouped view
│   │   └── ByAssigneeTab.jsx        # "By Assignee" grouped view
│   │
│   ├── AssetDetail.jsx              # Single asset view (full page)
│   │   ├── AssetInfoPanel.jsx       # Left: title, locations, notes
│   │   ├── WorkflowPanel.jsx        # Right: statuses, assignments, actions
│   │   ├── AssetTabs.jsx            # Tab switcher: Tickets | Comments | Activity
│   │   ├── TicketsTab.jsx           # List of tickets for this asset
│   │   ├── CommentsTab.jsx          # Asset-level comments
│   │   └── ActivityTab.jsx          # Activity feed (realtime)
│   │
│   ├── Tickets.jsx                  # All tickets page
│   │   ├── AllTicketsTab.jsx        # "All Tickets" sub-tab
│   │   ├── MyTicketsTab.jsx         # "My Tickets" sub-tab
│   │   ├── AssignedToMeTab.jsx      # "Assigned to Me" sub-tab
│   │   ├── OpenTicketsTab.jsx       # "Open Tickets" sub-tab
│   │   └── ByAssetTab.jsx           # "By Asset" grouped view
│   │
│   ├── TicketDetail.jsx             # Single ticket view
│   ├── TicketDetailModal.jsx        # Ticket detail as modal (from asset page)
│   │
│   ├── Activity.jsx                 # Activity feed page
│   │   ├── AllActivityTab.jsx       # "All Activity" sub-tab
│   │   ├── MyActivityTab.jsx        # "My Activity" sub-tab
│   │   └── StatusChangesTab.jsx     # "Status Changes" filtered view
│   │
│   └── Admin.jsx                    # Admin panel
│       ├── UserManagement.jsx       # Users table + edit
│       ├── RolePermissions.jsx      # Role/permission matrix
│       ├── SyncSettings.jsx         # Sync controls & status
│       ├── SheetConfig.jsx          # Sheet configuration
│       └── AppLogs.jsx              # Backend logs viewer
│
└── components/
    ├── cards/
    │   ├── AssetCard.jsx            # Card view for asset (grid item)
    │   ├── AssetCardCompact.jsx     # Smaller card for dense views
    │   └── TicketCard.jsx           # Card for ticket (compact)
    │
    ├── tables/
    │   ├── AssetTable.jsx           # Sortable list view table
    │   ├── TicketTable.jsx          # Sortable tickets table
    │   └── ActivityTable.jsx        # Activity feed table
    │
    ├── controls/
    │   ├── StatusDropdown.jsx       # Unified status dropdown (props: role)
    │   ├── AmagiDropdown.jsx        # Amagi comments dropdown
    │   ├── AssigneeSelect.jsx       # User assignment dropdown
    │   ├── PrioritySelect.jsx       # Priority picker
    │   ├── SearchBar.jsx            # Search input with debounce
    │   └── FilterBar.jsx            # Multi-filter bar
    │
    ├── displays/
    │   ├── StatusBadge.jsx          # Color-coded status pill
    │   ├── PriorityBadge.jsx        # Color-coded priority pill
    │   ├── UserAvatar.jsx           # User avatar with role icon
    │   ├── UserName.jsx             # Clickable username → profile
    │   ├── TimeAgo.jsx              # Relative time display
    │   ├── CopyButton.jsx           # Copy text to clipboard
    │   └── EmptyState.jsx           # "No data" placeholder
    │
    ├── layout/
    │   ├── PageHeader.jsx           # Page title + actions
    │   ├── SubTabs.jsx              # Horizontal sub-tab bar
    │   ├── ViewToggle.jsx           # Card/List toggle button group
    │   ├── Pagination.jsx           # Page navigation
    │   └── LoadingSpinner.jsx       # Loading state
    │
    ├── realtime/
    │   ├── ActivityFeed.jsx         # Live-updating activity list
    │   ├── RealtimeBadge.jsx        # "LIVE" indicator dot
    │   └── NotificationToast.jsx    # Pop-up notification
    │
    └── forms/
        ├── CreateTicketForm.jsx     # Ticket creation form
        ├── CommentForm.jsx          # Comment input + submit
        ├── NoteEditor.jsx           # Editable notes field
        └── AssetFilterForm.jsx      # Advanced filter form
```

### 7.2 Page-by-Page UI Detail

#### 7.2.1 Login Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                                                                             │
│                                                                             │
│                         🎬 LIONSGATE                                        │
│                     Asset Management                                        │
│                                                                             │
│                          🖼️ [Logo]                                         │
│                                                                             │
│                                                                             │
│                     ┌─────────────────────────┐                            │
│                     │  Sign in with Google   │                            │
│                     │        🔵🟡🟢           │                            │
│                     └─────────────────────────┘                            │
│                                                                             │
│                                                                             │
│           By signing in, you agree to the terms of service.                │
│                                                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Click button → Supabase `signInWithOAuth({ provider: 'google' })`
- On first login: auto-creates profile via DB trigger, default role "editor"
- On subsequent: reads session, redirects to `/editor` (if editor/reviewer) or `/admin`
- If user is deactivated (is_active = false): shows "Contact admin" message

#### 7.2.2 Editor Tab Page (visible to editors + reviewers)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                    👤 John (Ed)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✏️ Editor Panel                                                           │
│                                                                             │
│  ┌─── Quick Stats ──────────────────────────────────────────────────────┐  │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │  │
│  │ │ Working  │ │ Pending  │ │ Re-Edit  │ │ Sent for │ │ Total My    │ │  │
│  │ │    5     │ │   12     │ │    3     │ │ Approval │ │ Assets: 22  │ │  │
│  │ │         │ │         │ │         │ │    2     │ │             │ │  │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─── Section Tabs ─────────────────────────────────────────────────────┐  │
│  │  [📋 My Assigned]  [📥 Available]  [📤 Sent for Review]  [🔁 Re-Edit]│  │
│  │  [🔄 Recent]                                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─── My Assigned Assets (active tab) ─────────────────────────────────┐  │
│  │  [Card] [List]  Filter: [Status ▾]  Search: [....................]  │  │
│  │                                                                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ COOTIES      │  │ THE BANK JOB │  │ RARE BIRDS   │             │  │
│  │  │ 🟡 Working   │  │ 🔵 Pending   │  │ 🟢 Rendered  │             │  │
│  │  │ 📅 6/24      │  │ 📅 6/24      │  │ Prev & Hires │             │  │
│  │  │ 🎬 Avail     │  │ 🎬 Avail     │  │ 📅 7/8       │             │  │
│  │  │ [Open]       │  │ [Open]       │  │ 🎬 Avail     │             │  │
│  │  └──────────────┘  └──────────────┘  │ [Open]       │             │  │
│  │                                      └──────────────┘             │  │
│  │  ┌──────────────┐  ┌──────────────┐                              │  │
│  │  │ HARD CANDY   │  │ CHILD 44     │                              │  │
│  │  │ 🔴 Re-Edit   │  │ ⚪ No Status │                              │  │
│  │  │ 📅 6/24      │  │ 📅 7/15      │                              │  │
│  │  │ 🎬 Missing   │  │ 🎬 Missing   │                              │  │
│  │  │ [Open]       │  │ [Open]       │                              │  │
│  │  └──────────────┘  └──────────────┘                              │  │
│  │  ─────────────────────────────────── Page 1 of 3 ─────────────────│  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Note:** Reviewers can access this Editor tab too. When a reviewer is viewing it, the "Assigned Editor" and "Assigned Reviewer" labels adjust but the layout is the same. If an editor somehow navigates to `/reviewer` → they are redirected to `/editor` with a 403 message.

#### 7.2.3 Reviewer Tab Page (reviewers + admins ONLY)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                  👤 Jane (Rv)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  👁️ Reviewer Panel                                                         │
│                                                                             │
│  ┌─── Quick Stats ──────────────────────────────────────────────────────┐  │
│  │ ┌────────────┐ ┌──────────┐ ┌──────────────┐ ┌────────────────┐     │  │
│  │ │ Need to    │ │Reviewing │ │ Approved     │ │ Re-Edit Today  │     │  │
│  │ │ Review     │ │    2     │ │ Today: 4     │ │      1         │     │  │
│  │ │    7       │ │         │ │              │ │                │     │  │
│  │ └────────────┘ └──────────┘ └──────────────┘ └────────────────┘     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─── Section Tabs ─────────────────────────────────────────────────────┐  │
│  │  [📥 Pending Review]  [🔍 In Review]  [✅ Reviewed Today]  [📊 History]│ │
│  │  [🔄 Recent]                                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─── Pending Review Queue (active tab) ───────────────────────────────┐  │
│  │  [Card] [List]  Sorted by: [Newest First ▾]                         │  │
│  │                                                                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ COOTIES      │  │ THE BANK JOB │  │ RARE BIRDS   │             │  │
│  │  │ Sent by: John│  │ Sent by: Mike│  │ Sent by: John│             │  │
│  │  │ ⏱️ 2h ago   │  │ ⏱️ 1h ago   │  │ ⏱️ 30m ago  │             │  │
│  │  │ 📅 Air: 6/24 │  │ 📅 Air: 6/24 │  │ 📅 Air: 7/8  │             │  │
│  │  │ [Review]     │  │ [Review]     │  │ [Review]     │             │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │  │
│  │                                                                     │  │
│  │  ┌──────────────┐  ┌──────────────┐                               │  │
│  │  │ SHOT CALLER  │  │ CELL         │                               │  │
│  │  │ Sent by: Jane│  │ Sent by: Mike│                               │  │
│  │  │ ⏱️ 1d ago   │  │ ⏱️ 1d ago   │                               │  │
│  │  │ 📅 Air: 7/8  │  │ 📅 Air: 8/19 │                               │  │
│  │  │ [Review]     │  │ [Review]     │                               │  │
│  │  └──────────────┘  └──────────────┘                               │  │
│  │                                                                     │  │
│  │  ─────────────────────────────────── Page 1 of 2 ─────────────────│  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Only reviewers and admins can access this tab
- If editor types `/reviewer` in URL → redirect to `/editor` with a "You don't have access to the Reviewer panel" message
- "Send for Approval" from Editor tab → asset appears here in "Pending Review"
- Clicking [Review] → opens Asset Detail in review mode (workflow panel shows Reviewer Status dropdown + Approve/Re-Edit buttons)
- Approve → triggers sheet write-back + email notification to editor
- Re-Edit → asset moves back to Editor tab under "Re-Edit Required"

#### 7.2.4 Assets Library Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                   👤 John (Ed)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📚 Assets Library  [🔍 Search by title...]  [+Filter]  Showing 247 assets  │
│                                                                             │
│  ┌─── Sub Tabs ───────────────────────────────────────────────────────────┐ │
│  │  [📋 All Assets]  [📊 By Status]  [👥 By Assignee]                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ───── All Assets Tab (active) ───────────────────────────────────────────│ │
│                                                                             │
│  [🟦 Card View] [📋 List View]                                              │ │
│                                                                             │
│  Filters bar:                                                               │ │
│  Editor Status: [All ▾]  Reviewer Status: [All ▾]  Amagi: [All ▾]          │ │
│  Air Date: [From ▾] [To ▾]  |  Clear All Filters                            │ │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ COOTIES      │ │ THE BANK JOB │ │ HARD CANDY   │ │ ANNA (2019)  │      │
│  │ 🟡 Working   │ │ 🔵 Pending   │ │ 🟢 Re-Edit   │ │ ⚪ Pending   │      │
│  │ 📅 6/24      │ │ 📅 6/24      │ │ 📅 6/24      │ │ 📅 6/24      │      │
│  │ 📝 Hires     │ │ 📝 Hires     │ │ 📝 Pending   │ │ 📝 Hires     │      │
│  │ 👤 John      │ │ 👤 —         │ │ 👤 Mike      │ │ 👤 —         │      │
│  │ [View]       │ │ [View]       │ │ [View]       │ │ [View]       │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ WAXWORK      │ │ JULIET NAKED │ │ HUNTERS      │ │ BLEEDING     │      │
│  │ 🟡 Working   │ │ 🔵 Pending   │ │ PRAYER       │ │ STEEL        │      │
│  │ 📅 6/24      │ │ 📅 6/30      │ │ 🟡 Working   │ │ 🔵 Pending   │      │
│  │ 📝 Hires     │ │ 📝 Hires     │ │ 📝 Hires     │ │ 📝 Hires     │      │
│  │ 👤 Jane      │ │ 👤 —         │ │ 👤 John      │ │ 👤 —         │      │
│  │ [View]       │ │ [View]       │ │ [View]       │ │ [View]       │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
│                                                                             │
│  ───────────────────────────── Page 1 of 11 ─────────────────────────────  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**By Status Tab:** All assets grouped under collapsible headers:
```
▸ 🟡 Working (5 assets)
▸ 🔵 Pending (12 assets)
▸ 🟢 Approved (2 assets)
▸ 🔴 Re-Edit (3 assets)
```

**By Assignee Tab:**
```
▸ Assigned to John (5)
▸ Assigned to Jane (3)
▸ Assigned to Mike (1)
▸ Unassigned (238)
```

(Note: "My Work" is replaced by the dedicated Editor Tab and Reviewer Tab above. The My Work concept is now integrated directly into the Editor and Reviewer tabs.)
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📋 My Work (Editor)                                                       │
│                                                                             │
│  ┌─── Sub Tabs ───────────────────────────────────────────────────────────┐ │
│  │  [📋 Assigned to Me]  [🔄 Recent]  [📤 Sent for Review]  [🔁 Re-Edit]  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ───── Assigned to Me (active) ───────────────────────────────────────────│ │
│                                                                             │
│  Status filter: [All ▾]                                                     │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                       │
│  │ COOTIES      │ │ HUNTERS      │ │ BLEEDING     │                       │
│  │ 🟡 Working   │ │ PRAYER       │ │ STEEL        │                       │
│  │ 📅 6/24      │ │ 🟡 Working   │ │ 🔵 Pending   │                       │
│  │ 📝 Hires     │ │ 📅 6/30      │ │ 📅 6/30      │                       │
│  │ [Open]       │ │ 📝 Hires     │ │ 📝 Hires     │                       │
│  │ [Release]    │ │ [Open]       │ │ [Open]       │                       │
│  └──────────────┘ │ [Release]    │ │ [Assign Me]  │                       │
│                    └──────────────┘ └──────────────┘                       │
│                                                                             │
│  Status Update Quick Action on hover/card click:                            │
│  [Working ▾] [Save]                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Re-Edit Tab (for editor):**
```
┌─── Re-Edit Required ───────────────────────────────────────────────────────┐
│                                                                             │
│  Assets returned by reviewer for changes:                                   │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐                                         │
│  │ HARD CANDY   │ │ CELL         │                                         │
│  │ 🔴 Re-Edit   │ │ 🔴 Re-Edit   │                                         │
│  │ 📅 6/24      │ │ 📅 8/19      │                                         │
│  │ 🗣️ "Fix CC   │ │ 🗣️ "Wrong    │                                         │
│  │    timing"   │ │    render"   │                                         │
│  │ [Open]       │ │ [Open]       │                                         │
│  └──────────────┘ └──────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 7.2.5 Asset Detail Page

(Asset Detail is accessed from any tab: Editor Tab, Reviewer Tab, or Assets Library)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                    👤 John       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ← Back to [previous page]            📄 Asset Detail: COOTIES             │
├───────────────────────────────────────────────┬─────────────────────────────┤
│                                                │                            │
│  ┌─── Asset Info ───────────────────────────┐ │ ┌─── Workflow ───────────┐ │
│  │                                            │ │ │                        │ │
│  │ Title:         COOTIES                    │ │ │ Editor Status:         │ │
│  │ Files Avail:   June                        │ │ │ [Working ▾]           │ │
│  │ Air Date:      6/24                        │ │ │                        │ │
│  │ Sheet Row:     3 (synced)                  │ │ │ Reviewer Status:       │ │
│  │                                            │ │ │ [Pending ▾]           │ │
│  │ 🎬 Video Location:                         │ │ │                        │ │
│  │ /amagicloud-lionsgate/                     │ │ │ Amagi Comments:        │ │
│  │ Media/S3/MOVSP/9382654.mp4 [📋 Copy]      │ │ │ [Hires Uploaded ▾]    │ │
│  │                                            │ │ │                        │ │
│  │ 📝 CC Location:                            │ │ │ Assigned Editor:       │ │
│  │ Not available                              │ │ │ John (me) ▾           │ │
│  │                                            │ │ │                        │ │
│  │ 📝 Notes:                                  │ │ │ Assigned Reviewer:     │ │
│  │ ┌──────────────────────────────────────┐  │ │ │ Not assigned ▾        │ │
│  │ │ (editable text area)                  │  │ │ │                        │ │
│  │ └──────────────────────────────────────┘  │ │ │ ┌────────────────────┐ │ │
│  │                                            │ │ │ │ 📤 Send for        │ │ │
│  │ 💾 [Save Notes]                            │ │ │ │   Approval        │ │ │
│  │                                            │ │ │ └────────────────────┘ │ │
│  └────────────────────────────────────────────┘ │ │                        │ │
│                                                  │ │ 🕐 Last Synced: 2m ago│ │
│  ┌─── Tabs: [Tickets] [Comments] [Activity] ─┐ │ │ Status: ✅ In sync    │ │
│  │                                            │ │ └────────────────────────┘ │
│  │ 📋 Tickets — 2 open                        │ │                            │
│  │ ┌────┬────────────┬────────┬──────┬──────┐ │ │                            │
│  │ │ #  │ Title      │ Status │ Prio │ Asgn │ │ │                            │
│  │ ├────┼────────────┼────────┼──────┼──────┤ │ │                            │
│  │ │ 42 │ Missing CC │ 🟢Open │ High │ Jane │ │ │                            │
│  │ │ 41 │ Wrong path │ 🟡In   │ Low  │ Mike │ │ │                            │
│  │ └────┴────────────┴────────┴──────┴──────┘ │ │                            │
│  │                                            │ │                            │
│  │ [+ Create Ticket]                          │ │                            │
│  │                                            │ │                            │
│  │ ─── Ticket Detail (inline expand) ──────┐ │ │                            │
│  │ │ Ticket #42: Missing CC               │ │ │                            │
│  │ │ Status: [Open ▾]  Priority: [High ▾] │ │ │                            │
│  │ │ Assign: [Jane ▾]  [Resolve] [Close]  │ │ │                            │
│  │ │ ┌─ Comments ──────────────────────┐  │ │ │                            │
│  │ │ │ Jane: "I checked S3. Coming."   │  │ │ │                            │
│  │ │ │ John: "Thanks Jane."            │  │ │ │                            │
│  │ │ └─────────────────────────────────┘  │ │ │                            │
│  │ │ [Write a comment...]        [Send]  │ │ │                            │
│  │ └────────────────────────────────────┘ │ │                            │
│  └────────────────────────────────────────────┘ │                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Side Panel (right side, 1/3 width) details:**

- **Workflow Section:**
  - `Editor Status` dropdown — all 33 editor statuses
  - `Reviewer Status` dropdown — all 8 reviewer statuses (visible to reviewer/admin)
  - `Amagi Comments` dropdown — all 12 options
  - `Assigned Editor` — dropdown of all editor users
  - `Assigned Reviewer` — dropdown of all reviewer users
  - `[Send for Approval]` button — only active when editor status allows it
  - Sync info: last sync time, row number, sync status indicator

#### 7.2.6 Tickets Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                   👤 John (Ed)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🎫 Tickets                                                          [+ New]│
│                                                                             │
│  ┌─── Sub Tabs ───────────────────────────────────────────────────────────┐ │
│  │  [All Tickets]  [My Tickets]  [Assigned to Me]  [Open]  [By Asset]    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ───── All Tickets (active) ──────────────────────────────────────────────│ │
│                                                                             │
│  Filters: [All Status ▾] [All Priority ▾] [All Assets ▾]  Search: [...]   │
│                                                                             │
│  ┌────┬──────────────┬───────────┬────────┬────────┬──────────┬──────────┐ │
│  │ #  │ Title        │ Asset     │ Status │ Prio   │ Assignee │ Created  │ │
│  ├────┼──────────────┼───────────┼────────┼────────┼──────────┼──────────┤ │
│  │ 42 │ Missing CC   │ COOTIES   │ 🟢Open │ 🔴High │ Jane     │ 2h ago   │ │
│  │    │ files        │           │        │        │          │          │ │
│  │ 41 │ Wrong file   │ THE BANK  │ 🟡In   │ 🟢Low  │ Mike     │ 1d ago   │ │
│  │    │ path         │ JOB       │ Prgr.  │        │          │          │ │
│  │ 40 │ Subtitle     │ WAXWORK   │ 🟢Resld│ 🟡Med  │ —        │ 3d ago   │ │
│  │    │ mismatch     │           │        │        │          │          │ │
│  │ 39 │ Not in S3    │ HARD      │ ❌Closd│ 🔴High │ John     │ 5d ago   │ │
│  │    │              │ CANDY     │        │        │          │          │ │
│  └────┴──────────────┴───────────┴────────┴────────┴──────────┴──────────┘ │
│                                                                             │
│  ──────────────────────────────── Page 1 of 4 ────────────────────────────  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**By Asset Tab:**
```
▸ COOTIES (2 tickets)
  ├─ #42 Missing CC files [Open]
  └─ #41 Wrong file path [In Progress]
▸ THE BANK JOB (1 ticket)
  └─ #38 Audio sync issue [Open]
▸ WAXWORK (1 ticket)
  └─ #40 Subtitle mismatch [Resolved]
```

#### 7.2.7 Activity Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                   👤 John (Ed)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📈 Activity                                                               │
│                                                                             │
│  ┌─── Sub Tabs ───────────────────────────────────────────────────────────┐ │
│  │  [All Activity]  [My Activity]  [Status Changes]                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Filters: User: [All ▾]  Action: [All ▾]  Asset: [All ▾]                  │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 🔴 LIVE — Auto-updates in real-time                                    │ │
│  │                                                                        │ │
│  │ 12:30 PM  John changed COOTIES → Working                               │ │
│  │ 12:25 PM  John changed COOTIES Amagi → Hires Uploaded                  │ │
│  │ 12:00 PM  System synced COOTIES from sheet                             │ │
│  │ 11:45 AM  Jane approved THE BANK JOB ✓                                 │ │
│  │ 11:30 AM  Jane requested Re-Edit on HARD CANDY 🔄                      │ │
│  │ 11:20 AM  John created Ticket #42 on COOTIES 🎫                        │ │
│  │ 11:15 AM  Mike changed WAXWORK → Rendering Hi-Res file                 │ │
│  │ 11:00 AM  Mike assigned COOTIES to John                                │ │
│  │ 10:45 AM  John changed SHOT CALLER → Downloaded                        │ │
│  │ 10:30 AM  John sent COOTIES for approval 🚀                            │ │
│  │                                                                        │ │
│  │ ─────────────────────────────── Load More ───────────────────────────  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 7.2.8 Admin Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎬 Lionsgate   [✏️ Editor]  [👁️ Reviewer]  [📚 Assets]  [🎫 Tickets]    │
│                [📈 Activity]  [⚙️ Admin]                   👤 John (Adm)│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚙️ Admin Panel                                                           │
│                                                                             │
│  ┌─── Sub Tabs ───────────────────────────────────────────────────────────┐ │
│  │  [Users]  [Roles]  [Sync]  [Sheet]  [Logs]                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ───── User Management (active) ──────────────────────────────────────────│ │
│                                                                             │
│  Search: [.......................]  Role filter: [All ▾]                   │
│                                                                             │
│  ┌────┬──────────┬─────────────────┬──────────┬──────────┬──────────────┐ │
│  │    │ Name     │ Email           │ Role     │ Created  │ Actions      │ │
│  ├────┼──────────┼─────────────────┼──────────┼──────────┼──────────────┤ │
│  │ 🟢 │ John Doe │ john@email.com  │ Editor   │ Jun 2026 │ [Edit] [⋮]  │ │
│  │ 🟢 │ Jane Doe │ jane@email.com  │ Reviewer │ Jun 2026 │ [Edit] [⋮]  │ │
│  │ 🟢 │ Mike     │ mike@email.com  │ Editor   │ Jun 2026 │ [Edit] [⋮]  │ │
│  │ 🔴 │ Sam      │ sam@email.com   │ Editor   │ May 2026 │ [Edit] [⋮]  │ │
│  │    │ (inactive)│                │          │          │              │ │
│  └────┴──────────┴─────────────────┴──────────┴──────────┴──────────────┘ │
│                                                                             │
│  [Edit User] modal:                                                         │
│  ┌─────────────────────────────────────────────┐                           │
│  │ Edit User: John Doe                         │                           │
│  │                                             │                           │
│  │ Role: [Editor ▾]  Status: [✅ Active]       │                           │
│  │                                             │                           │
│  │ [Save Changes]  [Deactivate User]          │                           │
│  └─────────────────────────────────────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Supabase Setup

### 8.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Organization: (create or select)
3. Name: `lionsgate-asset-mgmt`
4. Database password: (generate + save)
5. Region: choose closest
6. Wait ~2 minutes

### 8.2 Run Schema

Open **SQL Editor** → paste and run the full schema from [Section 4](#4-database-schema).

### 8.3 Configure Google OAuth

1. **Supabase Dashboard** → **Authentication** → **Providers** → **Google**
2. Get Client ID and Client Secret from Google Cloud Console (see Section 9)
3. Set Authorized Redirect URI in Google Cloud to: `https://{project}.supabase.co/auth/v1/callback`
4. Enable Google provider in Supabase

### 8.4 Enable Realtime

1. **Supabase Dashboard** → **Database** → **Replication**
2. Enable Realtime for: `assets`, `tickets`, `ticket_comments`, `activity_log`

### 8.5 Get API Keys

1. **Supabase Dashboard** → **Settings** → **API**
2. Note down:
   - `Project URL` (SUPABASE_URL)
   - `anon public key` (VITE_SUPABASE_ANON_KEY — for frontend)
   - `service_role key` (SUPABASE_SERVICE_KEY — for backend only, keep secret)

---

## 9. Google APIs Setup

### 9.1 Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create new project → `Lionsgate Asset Management`
3. **APIs & Services** → **Library**
4. Enable: **Google Sheets API**, **Gmail API**

### 9.2 OAuth Consent Screen

1. **APIs & Services** → **OAuth consent screen**
2. User Type: External
3. App name: `Lionsgate Asset Management`
4. User support email: your email
5. Developer contact: your email
6. Scopes: `email`, `profile`, `openid`

### 9.3 OAuth Credentials (for Supabase Auth)

1. **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: Web application
3. Name: `Supabase Auth`
4. Authorized JavaScript origins:
   - `http://localhost:5173` (development)
   - `https://your-username.github.io` (GitHub Pages)
5. Authorized redirect URIs:
   - `https://{project-ref}.supabase.co/auth/v1/callback`
6. Copy **Client ID** and **Client Secret** → paste into Supabase

### 9.4 Service Account (for Sheets API)

1. **Credentials** → **Create Credentials** → **Service Account**
2. Name: `lionsgate-sheet-sync`
3. Skip permissions → **Done**
4. Click the new service account → **Keys** → **Add Key** → **JSON**
5. Download → save as `backend/service-account.json`

### 9.5 Share Sheet

1. Open your Google Sheet
2. **Share** → Add: `lionsgate-sheet-sync@{project}.iam.gserviceaccount.com`
3. Permission: **Editor**

---

## 10. Backend Setup

### 10.1 Initialize

```bash
mkdir backend
cd backend
npm init -y
npm install express cors dotenv googleapis @supabase/supabase-js node-cron
```

### 10.2 File Structure

```
backend/
├── .env                         # Environment variables
├── service-account.json         # Google service account key
├── package.json
├── index.js                     # Express server entry
├── supabase.js                  # Supabase admin client
└── services/
    ├── sheetService.js          # Google Sheets read/write
    ├── syncService.js           # Sheet → DB sync logic
    ├── writebackService.js      # DB change → Sheet write
    ├── emailService.js          # Gmail notifications
    └── activityService.js       # Log action to activity_log
```

### 10.3 `.env` Configuration

```env
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...

# Google Sheet
SPREADSHEET_ID=1-d7CZvE2mAC0lFYiHaAg49uxUETtv49-aXhETNbH6dg
SHEET_TAB_NAME=Updated Priority List 9/22
SHEET_TAB_GID=1725432366

# Sync
SYNC_INTERVAL_MINUTES=5

# Server
PORT=3001
CORS_ORIGIN=http://localhost:5173,https://your-username.github.io

# Gmail (OAuth method)
GMAIL_CLIENT_ID=xxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxxx
GMAIL_REFRESH_TOKEN=1//xxxx
GMAIL_USER=lionsgate-notifications@gmail.com

# App
APP_URL=https://your-username.github.io/lionsgate-asset-management
```

### 10.4 `index.js` — Server Entry

```javascript
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const syncService = require('./services/syncService');
const writebackService = require('./services/writebackService');

require('dotenv').config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
app.use(express.json());

// Routes
app.use('/api/sync', require('./routes/sync'));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Schedule sync every 5 minutes
cron.schedule(`*/${process.env.SYNC_INTERVAL_MINUTES || 5} * * * *`, () => {
  console.log('[CRON] Starting sheet sync...');
  syncService.syncSheetToDb().catch(console.error);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  // Run initial sync on startup
  syncService.syncSheetToDb().catch(console.error);
});
```

### 10.5 `services/sheetService.js`

```javascript
const { google } = require('googleapis');
const path = require('path');

async function getAuthClient() {
  return new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', 'service-account.json'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.send',
    ],
  });
}

async function readAllRows() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${process.env.SHEET_TAB_NAME}!A:K`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

async function writeAmagiComment(rowNumber, comment) {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${process.env.SHEET_TAB_NAME}!F${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[comment]] },
  });
  console.log(`[SHEET] Wrote "${comment}" to row ${rowNumber}, column F`);
}
```

### 10.6 `services/syncService.js`

```javascript
const crypto = require('crypto');
const supabase = require('../supabase');
const sheetService = require('./sheetService');

// Column indices (0-based)
const COL = {
  FILES_AVAILABLE: 0,
  TITLE: 1,
  VIDEO_LOCATION: 2,
  CC_LOCATION: 3,
  FIRST_AIR_DATE: 4,
  AMAGI_COMMENTS: 5,
  NOTES: 6,
  EXTRA_H: 7,
  EXTRA_I: 8,
  EXTRA_J: 9,
  EXTRA_K: 10,
};

async function syncSheetToDb() {
  const rows = await sheetService.readAllRows();
  if (!rows || rows.length < 3) return;

  let synced = 0;
  for (let i = 2; i < rows.length; i++) {  // Skip header rows (0,1)
    const row = rows[i];
    const title = (row[COL.TITLE] || '').trim();
    if (!title) continue;

    const sheetRowNumber = i + 1; // 1-indexed for Google Sheets
    const rowData = row.slice(0, 11);
    const hash = crypto.createHash('md5').update(JSON.stringify(rowData)).digest('hex');

    const asset = {
      sheet_row: sheetRowNumber,
      files_available: (row[COL.FILES_AVAILABLE] || '').toString(),
      title,
      video_location: row[COL.VIDEO_LOCATION] || '',
      cc_location: row[COL.CC_LOCATION] || '',
      first_air_date: (row[COL.FIRST_AIR_DATE] || '').toString(),
      amagi_comments: row[COL.AMAGI_COMMENTS] || 'Pending',
      notes: row[COL.NOTES] || '',
      extra_col_h: row[COL.EXTRA_H] || '',
      extra_col_i: row[COL.EXTRA_I] || '',
      extra_col_j: row[COL.EXTRA_J] || '',
      extra_col_k: row[COL.EXTRA_K] || '',
      sheet_hash: hash,
      is_synced: true,
      last_synced_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('assets')
      .select('id, sheet_hash, last_amagi_written, editor_status, reviewer_status')
      .eq('sheet_row', sheetRowNumber)
      .single();

    if (existing) {
      if (existing.sheet_hash !== hash) {
        // Sheet changed — update, but preserve DB-only fields
        // Don't overwrite amagi_comments if the DB has a value we wrote
        // (unless the sheet itself updated it to something different)
        const dbAmagi = existing.last_amagi_written;
        const sheetAmagi = asset.amagi_comments;
        if (dbAmagi && sheetAmagi === dbAmagi) {
          // Sheet hasn't changed this — keep DB value
          delete asset.amagi_comments;
        }
        await supabase.from('assets').update(asset).eq('id', existing.id);
        synced++;
      }
    } else {
      // New row — insert with default editor/reviewer status
      asset.editor_status = 'Pending';
      asset.reviewer_status = 'Pending';
      const { data } = await supabase.from('assets').insert(asset).select();
      if (data?.[0]) {
        // Create "asset created" activity log entry
        const { default: activityService } = await require('./activityService');
        await activityService.logAction(data[0].id, null, 'asset_created', {
          title: asset.title,
          source: 'sheet_sync',
        });
      }
      synced++;
    }
  }
  console.log(`[SYNC] Synced ${synced} rows (${rows.length - 2} total)`);
  return { synced, total: rows.length - 2 };
}

module.exports = { syncSheetToDb };
```

### 10.7 `services/writebackService.js`

```javascript
const supabase = require('../supabase');
const sheetService = require('./sheetService');

// Called when assets.amagi_comments changes
async function handleAmagiChange(assetId) {
  const { data: asset } = await supabase
    .from('assets')
    .select('sheet_row, amagi_comments, last_amagi_written')
    .eq('id', assetId)
    .single();

  if (!asset || !asset.sheet_row) return;
  if (asset.amagi_comments === asset.last_amagi_written) return; // No change

  await sheetService.writeAmagiComment(asset.sheet_row, asset.amagi_comments);

  // Update last_amagi_written to avoid loop
  await supabase
    .from('assets')
    .update({ last_amagi_written: asset.amagi_comments })
    .eq('id', assetId);

  console.log(`[WRITEBACK] Asset ${assetId}: wrote "${asset.amagi_comments}" to row ${asset.sheet_row}`);
}

module.exports = { handleAmagiChange };
```

### 10.8 `services/emailService.js`

```javascript
const { google } = require('googleapis');
const supabase = require('../supabase');

async function sendEmail({ type, asset, recipientEmail, recipientName, comment }) {
  try {
    const auth = await getAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const { subject, body } = buildEmail(type, asset, recipientName, comment);

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `To: ${recipientEmail}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      `Subject: ${utf8Subject}`,
      '',
      body,
    ];
    const message = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: message },
    });
    console.log(`[EMAIL] Sent "${type}" to ${recipientEmail}`);
  } catch (err) {
    console.error(`[EMAIL] Failed: ${err.message}`);
  }
}

function buildEmail(type, asset, name, comment) {
  const appUrl = process.env.APP_URL;
  const templates = {
    send_for_approval: {
      subject: `[Action Required] ${asset.title} is ready for review`,
      body: `<p>Hi ${name},</p><p><strong>${asset.assigned_editor_name || 'An editor'}</strong> has sent "${asset.title}" for your review.</p>
        <p><strong>Video:</strong> ${asset.video_location || 'N/A'}<br>
        <strong>CC:</strong> ${asset.cc_location || 'N/A'}<br>
        <strong>Air Date:</strong> ${asset.first_air_date || 'N/A'}</p>
        <p><a href="${appUrl}/assets/${asset.id}">Click here to review</a></p>`,
    },
    approved: {
      subject: `✅ ${asset.title} has been approved`,
      body: `<p>Hi ${name},</p><p>Your asset "<strong>${asset.title}</strong>" has been approved.</p>
        <p>The sheet has been updated.</p>`,
    },
    re_edit: {
      subject: `🔄 Re-Edit requested for ${asset.title}`,
      body: `<p>Hi ${name},</p><p>A reviewer has requested changes on "<strong>${asset.title}</strong>".</p>
        <p><strong>Comment:</strong> ${comment || 'No details provided.'}</p>
        <p><a href="${appUrl}/assets/${asset.id}">Open asset</a></p>`,
    },
    ticket_assigned: {
      subject: `🎫 Ticket assigned to you on ${asset.title}`,
      body: `<p>Hi ${name},</p><p>You have been assigned a ticket on "<strong>${asset.title}</strong>".</p>
        <p><a href="${appUrl}/tickets/${asset.ticket_id}">View ticket</a></p>`,
    },
  };
  return templates[type] || templates.send_for_approval;
}

module.exports = { sendEmail };
```

### 10.9 Start Backend

```bash
cd backend
node index.js
```

---

## 11. Frontend Setup

### 11.1 Initialize React + Vite Project

```bash
cd C:\Users\aryana\Documents\Lionsgate\Automation\Lionsgate automation
npm create vite@latest frontend -- --template react
cd frontend
npm install
npm install @supabase/supabase-js react-router-dom
```

### 11.2 Vite Config

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/lionsgate-asset-management/',  // Your GitHub repo name
  build: { outDir: 'dist' },
});
```

### 11.3 Environment

```env
# frontend/.env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
VITE_APP_NAME=Lionsgate Asset Management
VITE_BACKEND_URL=http://localhost:3001
```

### 11.4 `src/constants.js`

```javascript
export const EDITOR_STATUSES = [
  'Pending', 'Working', 'Converted', 'Downloaded', 'Issue',
  'Kept for Converting', 'Kept for downloading', 'Movie not available',
  'Need to Review', 'Not Available in S3', 'Re-Edit', 'Re-Edit Done',
  'Re-Render', 'Re-Upload', 'Re-Uploading', 'Re-work',
  'Ready for Hi-Rez', 'Ready to upload', 'Renderd Hi-Res file',
  'Rendered Prev & Hires', 'Rendered Preview file', 'Rendering Hi-Res file',
  'Rendering Preview file', 'Review Done', 'Reviewing',
  'Send for approval', 'Subtitle not available', 'Transcording',
  'Uploaded', 'Uploading', 'Already Done', 'Uploaded - Need to verify',
  'Re-Work',
];

export const REVIEWER_STATUSES = [
  'Need to Review', 'Reviewing', 'Review Done', 'Approved',
  'Re-Edit', 'Re-Work', 'Re-Re-Render', 'Issue',
];

export const AMAGI_COMMENTS = [
  'Approved', 'Working', 'Pending', 'SharedPrev', 'No subtitle',
  'Not Available in S3', 'Hires Uploaded', 'Ready to Share',
  'Already Received Before', 'Location Paths Not Available',
  'Received', 'Subtitle issue',
];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export const STATUS_COLORS = {
  'Pending': '#6b7280',
  'Working': '#eab308',
  'Converted': '#22c55e',
  'Downloaded': '#22c55e',
  'Issue': '#ef4444',
  'Send for approval': '#3b82f6',
  'Approved': '#22c55e',
  'Re-Edit': '#f97316',
  'Need to Review': '#a855f7',
  'Reviewing': '#3b82f6',
  'Review Done': '#22c55e',
  'open': '#22c55e',
  'in_progress': '#3b82f6',
  'resolved': '#6b7280',
  'closed': '#ef4444',
};

export const ROLES = ['admin', 'editor', 'reviewer'];
```

### 11.5 Role-Based Navigation Guard

Create `src/auth/ProtectedRoute.jsx`:

```jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function ProtectedRoute({ children, allowedRoles, redirectTo }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/auth" replace />;

  // If specific roles are required, check them
  if (allowedRoles && profile) {
    if (!allowedRoles.includes(profile.role)) {
      // Editor trying to access reviewer page → redirect
      return <Navigate to={redirectTo || '/editor'} replace />;
    }
  }

  return children;
}
```

### 11.6 App Layout with Navbar

Create `src/layouts/AppLayout.jsx`:

```jsx
import { Outlet, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AppLayout() {
  const { profile, signOut } = useAuth();

  const navItems = [];

  // Base nav items (everyone sees)
  const baseNav = [
    { to: '/editor', label: '✏️ Editor', roles: ['editor', 'reviewer', 'admin'] },
    { to: '/reviewer', label: '👁️ Reviewer', roles: ['reviewer', 'admin'] },
    { to: '/assets', label: '📚 Assets', roles: ['editor', 'reviewer', 'admin'] },
    { to: '/tickets', label: '🎫 Tickets', roles: ['editor', 'reviewer', 'admin'] },
    { to: '/activity', label: '📈 Activity', roles: ['editor', 'reviewer', 'admin'] },
    { to: '/admin', label: '⚙️ Admin', roles: ['admin'] },
  ];

  const visibleNav = baseNav.filter(item =>
    item.roles.includes(profile?.role)
  );

  return (
    <div>
      <nav>
        {visibleNav.map(item => (
          <NavLink key={item.to} to={item.to}>
            {item.label}
          </NavLink>
        ))}
        <span>{profile?.full_name} ({profile?.role})</span>
        <button onClick={signOut}>Logout</button>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

### 11.7 App Router

Create `src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionContextProvider } from './auth/SessionContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import Auth from './auth/Auth';
import AppLayout from './layouts/AppLayout';
import EditorTab from './pages/EditorTab';
import ReviewerTab from './pages/ReviewerTab';
import AssetsLibrary from './pages/AssetsLibrary';
import AssetDetail from './pages/AssetDetail';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import Activity from './pages/Activity';
import Admin from './pages/Admin';

export default function App() {
  return (
    <BrowserRouter basename="/lionsgate-asset-management">
      <SessionContextProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />

          <Route path="/" element={<AppLayout />}>
            {/* Default redirect based on role */}
            <Route index element={<RoleRedirect />} />

            {/* ✏️ Editor Tab — editors + reviewers + admins */}
            <Route path="editor" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <EditorTab />
              </ProtectedRoute>
            } />

            {/* 👁️ Reviewer Tab — reviewers + admins ONLY (editors blocked) */}
            <Route path="reviewer" element={
              <ProtectedRoute allowedRoles={['reviewer', 'admin']} redirectTo="/editor">
                <ReviewerTab />
              </ProtectedRoute>
            } />

            {/* 📚 Shared pages — all roles */}
            <Route path="assets" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <AssetsLibrary />
              </ProtectedRoute>
            } />
            <Route path="assets/:id" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <AssetDetail />
              </ProtectedRoute>
            } />
            <Route path="tickets" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <Tickets />
              </ProtectedRoute>
            } />
            <Route path="tickets/:id" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <TicketDetail />
              </ProtectedRoute>
            } />
            <Route path="activity" element={
              <ProtectedRoute allowedRoles={['editor', 'reviewer', 'admin']}>
                <Activity />
              </ProtectedRoute>
            } />

            {/* ⚙️ Admin only */}
            <Route path="admin" element={
              <ProtectedRoute allowedRoles={['admin']} redirectTo="/editor">
                <Admin />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionContextProvider>
    </BrowserRouter>
  );
}

function RoleRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile) return <Navigate to="/auth" replace />;
  // Everyone goes to /editor by default (reviewers can see it too)
  return <Navigate to="/editor" replace />;
}
```

### 11.8 Deploy to GitHub Pages

```bash
cd frontend
npm install --save-dev gh-pages
```

Add to `package.json`:
```json
{
  "homepage": "https://YOUR-USER.github.io/lionsgate-asset-management",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "gh-pages -d dist"
  }
}
```

```bash
git init
git add .
git commit -m "Initial frontend"
git remote add origin https://github.com/YOUR-USER/lionsgate-asset-management.git
git push -u origin main
npm run deploy
```

GitHub Pages config:
1. Repo **Settings** → **Pages**
2. Source: Deploy from branch → `gh-pages` → `/ (root)`
3. Save

Frontend is live at `https://YOUR-USER.github.io/lionsgate-asset-management/`

---

## 12. Deployment

### Run Backend

```bash
cd backend
node index.js
# Server on http://localhost:3001
# Supports: systemd/nssm for Windows service, PM2 for production
```

### Run Frontend (Dev)

```bash
cd frontend
npm run dev
# Opens http://localhost:5173
```

### Run Frontend (Prod — GitHub Pages)

```bash
cd frontend
npm run build
npm run deploy
# Live at https://YOUR-USER.github.io/lionsgate-asset-management/
```

---

## 13. Precautions

### ⚠️ CRITICAL: Never Delete Sheet Data

- The sync service **reads only**. It never deletes rows or columns.
- Write-back **only touches column F** (Amagi Comments) of the matched row.
- All other data (columns A–E, G–K+ and every other tab) is preserved exactly as-is.
- The `sheet_hash` mechanism ensures we detect actual changes vs. our own writes.

### ⚠️ First-Time Setup: Test on a Copy

1. Make a copy of the sheet: **File** → **Make a copy**
2. Point the backend to the copy's Spreadsheet ID
3. Run the sync
4. Test the write-back (change an Amagi comment in the app → verify sheet updates)
5. Switch to the real sheet only after confirming everything works

### ⚠️ Service Key Security

- The `service_role` key has full database access.
- **Never** put it in the frontend `.env` or client-side code.
- Only use it in the backend, which runs locally and is not exposed publicly.

### ⚠️ Backup Sheet Before Schema Changes

Any time you modify the schema or sync logic:
1. Export sheet as CSV: **File** → **Download** → **Comma-separated values (.csv)**
2. Keep a local backup

### ⚠️ Sync Loop Prevention

- `last_amagi_written` column tracks what we last wrote to the sheet.
- The sync ignores sheet rows where the Amagi value matches `last_amagi_written`.
- This prevents: App writes "Approved" → Sheet updates → Sync reads "Approved" → Updates DB again → Loop.
