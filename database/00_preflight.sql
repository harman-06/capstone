-- Read only. An empty result means public has no tables.
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
