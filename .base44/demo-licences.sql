-- Local reconciliation after the demo packages exist in R2.
--
-- .base44/dev-setup.sh re-runs migrations/0002_backfill_legacy_licence.sql once
-- the demo ZIP objects are uploaded, because the D1 migration runner will not
-- run 0002 again for a sandbox whose earlier setup seeded the beats before the
-- packages existed. That re-run is what grants the tier; this file only
-- withdraws the exception rows 0002 recorded back then, and only for beats
-- whose exception is now provably resolved (they have a package key).
--
-- Local development only. The Worker never reads this file, and nothing here is
-- part of the production migration set.
DELETE FROM licence_backfill_issues
 WHERE issue = 'missing_package'
   AND EXISTS (
     SELECT 1
       FROM beats b
      WHERE b.id = licence_backfill_issues.beat_id
        AND b.zip_key IS NOT NULL
        AND TRIM(b.zip_key) <> ''
   );
