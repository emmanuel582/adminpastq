# PastQ Admin

Separate React + Vite admin app for `emmanuel582/adminpastq`, ready to host on Vercel. It uses real Supabase accounts/student data and real VPS uploads/questions. There is no demo mode, sample dataset, or mock API fallback.

## Student insights and notifications

Users & Signups shows the actual saved school/exam, undergraduate choice, onboarding stage, and profile. Search and conditions cover all accounts across pages. Select one or several accounts to open the notification composer. Account details include study goals, learning-record counts, and links to every supported student dataset.

The activity chart reads signup dates from Supabase Auth (including unconfirmed accounts), uploads from the VPS, and completed sessions from the student app's saved Supabase exam history (`exam_sessions`). Device-only and pending offline results appear after synchronization. It refreshes every 15 seconds, supports 7/14/30/90-day ranges, and provides keyboard-accessible day values and a complete data table. Days are UTC; today's totals are partial. Failed data sources are marked unavailable.

Notifications support all accounts, selected accounts, or the intersection of school, exam, student type, account status, onboarding, signup dates, and days since last sign-in. Review freezes the recipient list for 15 minutes. Sending creates an inbox message for each recipient, with optional browser push to enabled, connected devices. Upload JPEG/PNG/WebP images up to 5 MB; the API validates and re-encodes them as WebP. Browser support determines whether a push shows its image. This feature sends in-app and browser notifications; it does not send email or SMS.

Campaigns, recipient snapshots, inbox reads, and device delivery results persist on the VPS. Duplicate send requests do not duplicate inbox messages or restart push delivery. Interrupted push results are reported as unknown rather than automatically sending again. The student frontend provides Preferences → Notifications and updates the existing push worker to display uploaded campaign artwork. No notification is sent merely by previewing it.

## Hosting on Vercel

Import `emmanuel582/adminpastq` with the repository root as the Root Directory. `vercel.json` supplies Vite, `npm ci`, `npm run build`, and `dist`. Production connects to `https://76.13.110.6.nip.io/api` by default. No browser Supabase service key is needed. Subsequent pushes to the connected production branch trigger Vercel deployments.

Only set `VITE_API_URL` if changing the API hostname. Both an origin and a URL ending in `/api` are accepted. Large uploads go directly to the VPS.

## Sign in and live data

Choose **Continue with Google** and use the Google account associated with your existing PastQ administrator account. No password form is shown. Google sign-in uses Supabase PKCE in the same browser tab; the API verifies the session and server-side admin allowlist before exposing any admin data. Public Supabase client configuration comes from `/api/auth/config`, so no additional Vercel environment variables are required. The service-role key stays on the VPS.

In Supabase Authentication → URL Configuration, allow the admin callback `https://adminpastq.vercel.app/?admin_auth=google` and the actual admin deployment origin if different. For local development allow `http://127.0.0.1:5174/?admin_auth=google` and `http://localhost:5174/?admin_auth=google`. Keep existing student app redirects. Google remains enabled through the existing Supabase Google provider.

The VPS needs its existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and unchanged `SESSION_OWNER_HMAC_SECRET`, plus `SUPABASE_SERVICE_ROLE_KEY` and the administrator's Supabase UUID in `ADMIN_USER_IDS`. Add the actual Vercel origin to `FRONTEND_URL` without removing the student app's origins.

Lists, counts, categories, signups, data tables, and activity refresh every **15 seconds** while visible. Returning to the tab or reconnecting refreshes immediately. Open upload/library panels refresh automatically unless an edit is in progress. Existing results stay visible during background refresh, and account tokens refresh automatically.

## Organizing materials

Main groups match the student library: **Schools & Universities**, **Tests & Qualifications**, **Professional Exams**, and **Other Materials**. These are navigation structure, not sample records. Their counts come from actual uploads and published collections.

- Create subcategories inside any group and further nest them as needed.
- Open Categories to see the group tree beside the actual materials.
- Drag a material row onto a group or subcategory, then confirm its destination.
- Use **Move to** beside a row, or select several rows and choose **Move selected**.
- A parent category includes materials in its subcategories when filtering.
- Moving a published collection to a main group also updates its organization type in the student catalog. Provide a real school, exam board, or professional-body name where needed. Other collections are preserved.
- Private uploads remain private when organized; moving them does not publish them.
- Custom admin-only main categories are supported.
- Deleting a custom category preserves materials and promotes its children one level. The four main library groups remain available and can be renamed.

Category assignments and action history persist in `DATA_DIR/admin.db`. Include it in consistent SQLite backups.

## Other tools

Overview, upload/PDF ingestion, protected original image viewing with zoom, extraction progress and retries, upload/question edits, published question edits, user profile updates, account suspension/restoration, full student data inspection, CSV export of the current page, and an administrator action log.

Student passwords, provider credentials, and device push tokens are excluded. Data Explorer allows only known student-data tables. Image requests verify admin access and storage paths. Destructive actions require explicit confirmation in the interface.

## Branding

`src/branding/fonts.css` and `study-theme.css` are exact copies of the original website's theme sources. Manrope, Outfit, the lowercase wordmark, Scholar artwork, and light/dark/system behavior match the student website. The admin app builds independently, without a sibling client folder. Surfaces use solid colors with subtle shadows; gradients, colored borders, and sample content are removed.

## Local development

Requires Node 22.13+.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:5174`. To use the live server locally, copy `.env.example` to `.env.local`; otherwise the development proxy uses a local API on port 3000. The live VPS must allow the local origin. Access still requires a real admin login.

```powershell
npm test
npm run build
```

Run the refresh tests and production build before publishing. An optional GitHub Actions template is included at `ci/verify-workflow.example.yml`; enable it in `.github/workflows/` with a credential that has workflow permissions. Backend category/authorization regression tests live in the main PastQ repository at `server/tests/admin.test.js`.

