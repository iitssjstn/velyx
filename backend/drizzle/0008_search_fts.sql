-- Full-text search index for movies, shows and episodes (SQLite FTS5).
-- rowid encodes the item: movie = id*4+1, show = id*4+2, episode = id*4+3, so triggers can update
-- single rows without scanning the index. unicode61 splits on punctuation ("Spider-Man" ->
-- spider, man) and ignores accents.
CREATE VIRTUAL TABLE `search_index` USING fts5(`title`, `alt`, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO `search_index` (rowid, title, alt) SELECT id * 4 + 1, title, coalesce(original_title, '') || ' ' || parsed_title FROM `movies`;
--> statement-breakpoint
INSERT INTO `search_index` (rowid, title, alt) SELECT id * 4 + 2, title, coalesce(original_title, '') || ' ' || parsed_title FROM `shows`;
--> statement-breakpoint
INSERT INTO `search_index` (rowid, title, alt) SELECT id * 4 + 3, title, '' FROM `episodes` WHERE title IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `movies_search_ai` AFTER INSERT ON `movies` BEGIN
  INSERT INTO `search_index` (rowid, title, alt) VALUES (new.id * 4 + 1, new.title, coalesce(new.original_title, '') || ' ' || new.parsed_title);
END;
--> statement-breakpoint
CREATE TRIGGER `movies_search_au` AFTER UPDATE OF title, original_title, parsed_title ON `movies` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 1;
  INSERT INTO `search_index` (rowid, title, alt) VALUES (new.id * 4 + 1, new.title, coalesce(new.original_title, '') || ' ' || new.parsed_title);
END;
--> statement-breakpoint
CREATE TRIGGER `movies_search_ad` AFTER DELETE ON `movies` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `shows_search_ai` AFTER INSERT ON `shows` BEGIN
  INSERT INTO `search_index` (rowid, title, alt) VALUES (new.id * 4 + 2, new.title, coalesce(new.original_title, '') || ' ' || new.parsed_title);
END;
--> statement-breakpoint
CREATE TRIGGER `shows_search_au` AFTER UPDATE OF title, original_title, parsed_title ON `shows` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 2;
  INSERT INTO `search_index` (rowid, title, alt) VALUES (new.id * 4 + 2, new.title, coalesce(new.original_title, '') || ' ' || new.parsed_title);
END;
--> statement-breakpoint
CREATE TRIGGER `shows_search_ad` AFTER DELETE ON `shows` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 2;
END;
--> statement-breakpoint
CREATE TRIGGER `episodes_search_ai` AFTER INSERT ON `episodes` WHEN new.title IS NOT NULL BEGIN
  INSERT INTO `search_index` (rowid, title, alt) VALUES (new.id * 4 + 3, new.title, '');
END;
--> statement-breakpoint
CREATE TRIGGER `episodes_search_au` AFTER UPDATE OF title ON `episodes` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 3;
  INSERT INTO `search_index` (rowid, title, alt) SELECT new.id * 4 + 3, new.title, '' WHERE new.title IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `episodes_search_ad` AFTER DELETE ON `episodes` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.id * 4 + 3;
END;
