# VPS integration

This directory contains an overlay for the existing PastQ API, not a second standalone server.

The admin router and category store are new files. The integration patch adds the router mount, session refresh, action auditing, a page-store shutdown helper for tests, and safe preservation of sibling collections during manual reclassification.

Apply only after comparing with the current VPS source and saving a rollback backup. The patch paths are relative to the full PastQ repository; inside the existing server directory they can be checked using `git apply --check -p2 integration.patch`. Copy `routes/admin.js` and `services/admin/store.js` into matching directories, then apply the reviewed patch and rebuild the existing Docker service. Preserve the production environment and persistent data volume.

The VPS keeps the Supabase service key and admin allowlist. No secrets are included here. The current live service must be updated before these admin endpoints and category moves can work.
