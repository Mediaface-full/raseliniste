-- DropIndex (před změnou na unique je nutné starý plain index dropnout)
DROP INDEX IF EXISTS "Task_userId_todoistTaskId_idx";

-- CreateIndex (unique kompozit; Postgres NULL hodnoty jsou v unique brány jako různé,
-- takže existující řádky s todoistTaskId=null neporuší constraint)
CREATE UNIQUE INDEX "Task_userId_todoistTaskId_unique" ON "Task"("userId", "todoistTaskId");
