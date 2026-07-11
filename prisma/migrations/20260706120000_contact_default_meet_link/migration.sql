-- Contact.defaultMeetLink (Petr 2026-07-06): trvalá Meet místnost kontaktu.
-- Online booking s tímto kontaktem použije tenhle link místo generování nového.
ALTER TABLE "Contact" ADD COLUMN "defaultMeetLink" TEXT;
