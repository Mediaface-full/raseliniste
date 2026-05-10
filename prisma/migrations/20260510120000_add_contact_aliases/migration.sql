-- Aliases pro AI extract — synonyma pro Contact name a clientTag
ALTER TABLE "Contact"
  ADD COLUMN "aliases"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "clientTagAliases" TEXT[] NOT NULL DEFAULT '{}';
