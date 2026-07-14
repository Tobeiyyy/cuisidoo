CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  unit_dim TEXT NOT NULL CHECK (unit_dim IN ('mass','volume','count')),
  grams_per_piece REAL
);

CREATE TABLE ingredient_aliases (
  alias TEXT PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  servings_base INTEGER NOT NULL,
  total_time_min INTEGER,
  active_time_min INTEGER,
  source TEXT NOT NULL CHECK (source IN ('generated','manual')),
  favorite INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,
  nutrition_json TEXT,
  nutrition_scored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);

CREATE TABLE recipe_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  scaling TEXT NOT NULL DEFAULT 'linear' CHECK (scaling IN ('linear','damped','fixed')),
  note TEXT,
  section TEXT,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE recipe_steps (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tm6','off_device')),
  text TEXT NOT NULL,
  seconds INTEGER,
  temp TEXT,
  speed TEXT,
  reverse INTEGER NOT NULL DEFAULT 0,
  mode TEXT,
  accessory TEXT,
  device TEXT,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  owned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recipe_equipment (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  PRIMARY KEY (recipe_id, equipment_id)
);

CREATE TABLE pantry (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_entries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('mittag','abend','sonstiges')),
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  servings INTEGER NOT NULL
);
CREATE INDEX idx_plan_date ON plan_entries(date);

CREATE TABLE shopping_items (
  id INTEGER PRIMARY KEY,
  ingredient_id INTEGER REFERENCES ingredients(id),
  label TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  category TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('plan','manual'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed: kitchen equipment (TM6 itself is implicit, never listed)
INSERT INTO equipment (name, owned) VALUES
  ('Backofen', 1), ('Herd', 1), ('Mikrowelle', 1),
  ('Kühlschrank', 1), ('Gefrierschrank', 1), ('Handmixer', 0);

-- Seed: settings
INSERT INTO settings (key, value) VALUES
  ('diet_bias', 'Muskelaufbau im Kalorienüberschuss: bevorzuge proteinreiche Zutaten, Eisen, Ballaststoffe, Nüsse, Gemüse und Obst.'),
  ('default_servings', '2'),
  ('generation_model', 'claude-sonnet-5');
