ALTER TABLE "chunks" ADD CONSTRAINT "chunks_symbol_kind_check" CHECK ("symbol_kind" IS NULL OR "symbol_kind" IN ('function', 'class', 'method', 'module', 'block'));
