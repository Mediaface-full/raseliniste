-- AlterEnum
-- Postgres: ALTER TYPE ... ADD VALUE musí být odděleno od jiných statementů
-- (Prisma migrate deploy obaluje každý soubor BEGIN/COMMIT, ale ADD VALUE
--  v PG <= 14 padá pokud je ve stejné transakci s DDL na stejném enumu).
ALTER TYPE "TaskSource" ADD VALUE 'todoist_pull';
ALTER TYPE "TaskSource" ADD VALUE 'vip_call_log';
