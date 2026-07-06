-- Rollback 0016 — supervision PV (retour état post-0015).
DROP FUNCTION IF EXISTS "admin_list_pvs"(int, int, text);
DROP FUNCTION IF EXISTS "admin_get_pv"(uuid);
