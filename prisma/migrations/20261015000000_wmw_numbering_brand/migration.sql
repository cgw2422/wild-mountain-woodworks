-- WMW numbering + full business name.
--
-- 1. New numbering: quotes WMWQ-2001…, orders WMWO-2001…, invoices WMWI-2001….
--    Each prefix gets its own counter row (independent sequences). The first
--    number issued is 2001. The retired 'quote' / 'order' / 'invoice' counters
--    are left as they are, and NO existing quote, order or invoice number is
--    touched: historical WMQ-/WMO-/WMI- numbers stay exactly as they were.
INSERT INTO "Counter" ("key", "value") VALUES ('WMWQ', 2000), ('WMWO', 2000), ('WMWI', 2000)
ON CONFLICT ("key") DO NOTHING;

-- 2. Business name: editable content stored in the database (CMS pages and
--    sections, email templates, settings, menus, FAQs, catalog copy…) that
--    calls the company just "Wild Mountain" now says "Wild Mountain Woodworks".
--    Only the displayed phrase changes (slugs, URLs and keys never contain it).
--    Sales records, emails already sent and audit history are NOT modified.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('Page', 'PageSection', 'SectionItem', 'EmailTemplate', 'SiteSetting', 'Announcement',
                           'Menu', 'MenuItem', 'Faq', 'FaqCategory', 'Category', 'Product', 'PortfolioProject',
                           'PortfolioImage', 'Media', 'AddOn', 'OptionGroup', 'OptionValue')
      AND c.data_type IN ('text', 'character varying', 'jsonb')
  LOOP
    IF r.data_type = 'jsonb' THEN
      EXECUTE format(
        $q$UPDATE %1$I SET %2$I = regexp_replace(regexp_replace(%2$I::text, 'Wild Mountain''s', 'Wild Mountain Woodworks''', 'g'), 'Wild Mountain\M(?! Woodworks)', 'Wild Mountain Woodworks', 'g')::jsonb
           WHERE %2$I::text ~ 'Wild Mountain\M(?! Woodworks)'$q$,
        r.table_name, r.column_name);
    ELSE
      EXECUTE format(
        $q$UPDATE %1$I SET %2$I = regexp_replace(regexp_replace(%2$I, 'Wild Mountain''s', 'Wild Mountain Woodworks''', 'g'), 'Wild Mountain\M(?! Woodworks)', 'Wild Mountain Woodworks', 'g')
           WHERE %2$I ~ 'Wild Mountain\M(?! Woodworks)'$q$,
        r.table_name, r.column_name);
    END IF;
  END LOOP;
END $$;
