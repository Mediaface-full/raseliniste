-- CreateIndex
CREATE INDEX "Contact_userId_birthMonth_birthDay_idx" ON "Contact"("userId", "birthMonth", "birthDay");
