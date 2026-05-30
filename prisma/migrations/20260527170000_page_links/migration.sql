-- Petr 2026-05-27: PageLink — user-defined web shortcuts. Sidebar sekce
-- „Page Links" pod Dashboard, /links stránka renderuje boxy jako /start,
-- /settings/page-links CRUD UI. Klik otevře `url` v novém okně (target="_blank").

CREATE TABLE "PageLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tint" TEXT NOT NULL DEFAULT 'sky',
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageLink_userId_order_idx" ON "PageLink"("userId", "order");

ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
