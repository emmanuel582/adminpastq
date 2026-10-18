# VPS integration

This is an overlay for the existing PastQ API. The live API has the student directory, UTC analytics, notification composer endpoints, persistent campaigns, image storage, private student inboxes, and a browser push queue installed.

The new files are routes/admin.js and services/admin/{store,students,notifications}.js. The integration.patch contains changes to existing API files, including the authenticated inbox in reminders routes, the campaign scheduler, and the owner-key helper. Review against the current VPS source before applying. Patch paths are relative to the full PastQ repository; inside a server root use git apply --check -p2 integration.patch. Preserve the production environment, Supabase keys, owner HMAC secret, and persistent data volume. Rebuild the existing Docker service after installing the matching source.

Requires the existing sharp, multer, web-push, Supabase client, and Node SQLite dependencies. No additional database migration is required: campaign records, inbox messages, and image files persist under DATA_DIR on the VPS. Public image URLs expose only intentionally uploaded raster notification artwork under opaque IDs. Account and inbox data remain authenticated. Student frontend inbox and worker updates are published separately to emmanuel582/pastqfrontend.

Keep rollback source and Docker image backups before deployment. The server tests in the main PastQ workspace cover roles, targeting, chart boundaries, image normalization, account isolation, and duplicate-send protection. No credentials or student records are included here.
