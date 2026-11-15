"""Admin-editable data for CuiSync (panel revisions: admin module).

Holds everything the admin page can change without touching the original files:
  - the recipe dataset (add / edit / delete dishes, upload a new dataset)
  - the list of countries shown in the dropdowns (add / rename / hide / remove)
  - the GPT prompts (similarity explanation and cultural information)

The original recipes.json and the .npy files are never overwritten. Changes are saved
in the admin_data/ folder, and the soft matcher is rebuilt from them:
  - dishes that were not changed keep their original item lists and vectors
  - a new ingredient (or action, cookware, utensil) that is already in the vocabulary
    reuses its vector
  - a brand-new item borrows the vector of the closest known item (by spelling or by
    shared words). Items with no close match get no vector, and the admin page says so,
    because a full update needs the vectorizer to be run again.
"""
import difflib
import json
import os
import re
import threading

import numpy as np

FEATURES = ("ingredients", "actions", "cookware", "utensils")
TEXT_FIELD = {
    "ingredients": "ingredient_text",
    "actions": "action_text",
    "cookware": "cookware_text",
    "utensils": "utensil_text",
}

# Fields the admin form can edit, in the order they are shown
DISH_FIELDS = (
    "title", "alternative_title", "country", "region", "recipe_link", "image_link",
    "ingredient_text", "action_text", "cookware_text", "utensil_text",
    "tags", "culture_notes", "history_notes",
)

DEFAULT_REGIONS = {
    "CHINA": "East Asia", "JAPAN": "East Asia", "SOUTH KOREA": "East Asia",
    "CAMBODIA": "Southeast Asia", "INDONESIA": "Southeast Asia", "MALAYSIA": "Southeast Asia",
    "MYANMAR": "Southeast Asia", "PHILIPPINES": "Southeast Asia", "THAILAND": "Southeast Asia",
    "VIETNAM": "Southeast Asia", "INDIA": "South Asia",
    "SAUDI ARABIA": "West Asia", "TURKIYE": "West Asia",
}
DEFAULT_LABELS = {"TURKIYE": "Turkey"}
REGION_CHOICES = ("East Asia", "Southeast Asia", "South Asia", "Central Asia", "West Asia", "Other Asia")


def _split(text):
    return [t.strip().lower() for t in str(text or "").split(",") if t.strip()]


def _dedupe(items):
    return list(dict.fromkeys(items))


def _singular(word):
    if len(word) > 3 and word.endswith("es") and word[:-2].endswith(("sh", "ch", "o", "x")):
        return word[:-2]
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _normal_item(item):
    return " ".join(_singular(w) for w in item.split())


class DatasetStore:
    def __init__(self, root):
        self.root = root
        self.data_dir = os.path.join(root, "admin_data")
        self.runtime_dir = os.path.join(self.data_dir, "matcher")
        os.makedirs(self.runtime_dir, exist_ok=True)
        self.recipes_path = os.path.join(self.data_dir, "recipes.json")
        self.countries_path = os.path.join(self.data_dir, "countries.json")
        self.prompts_path = os.path.join(self.data_dir, "prompts.json")
        self.lock = threading.RLock()

        # The original dataset and vectors (read only)
        with open(os.path.join(root, "recipes.json"), encoding="utf-8") as f:
            self.base_recipes = json.load(f)
        self.base = {}
        for feature in FEATURES:
            with open(os.path.join(root, f"{feature}_items.json"), encoding="utf-8") as f:
                data = json.load(f)
            vecs = np.load(os.path.join(root, f"{feature}_item_vecs.npy"))
            self.base[feature] = {
                "items": data["items"],
                "vecs": vecs,
                "index": {item.lower(): i for i, item in enumerate(data["items"])},
                "normal": {_normal_item(item.lower()): i for i, item in enumerate(data["items"])},
                "recipes": data["recipes"],
                "df": np.array(data.get("df") or [0] * len(data["items"]), dtype=np.float64),
            }
        # Original item lists by recipe, so untouched dishes keep exactly what the vectorizer made
        self.base_by_key = {}
        for r, recipe in enumerate(self.base_recipes):
            self.base_by_key[self._key(recipe)] = r

        self.uses_admin_data = os.path.exists(self.recipes_path)
        self.recipes = self._load_recipes()
        self.countries = self._load_countries()
        self.prompts = self._load_json(self.prompts_path, {})
        self.missing_vectors = []

    # ---------------- helpers ----------------
    @staticmethod
    def _key(recipe):
        return (str(recipe.get("recipe_id")), (recipe.get("title") or "").strip().lower(),
                (recipe.get("country") or "").strip().upper())

    @staticmethod
    def _load_json(path, default):
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        return default

    def _save_json(self, path, data):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)

    def _load_recipes(self):
        recipes = self._load_json(self.recipes_path, None)
        if recipes is None:
            recipes = [dict(r) for r in self.base_recipes]
        for r in recipes:
            r["country"] = (r.get("country") or "").strip().upper()
        return recipes

    def _load_countries(self):
        saved = self._load_json(self.countries_path, None)
        if saved is not None:
            return saved
        names = sorted({r["country"] for r in self.recipes if r.get("country")})
        return [
            {
                "name": name,
                "label": DEFAULT_LABELS.get(name, name.title()),
                "region": DEFAULT_REGIONS.get(name, "Other Asia"),
                "visible": True,
            }
            for name in names
        ]

    # ---------------- recipes ----------------
    def save_recipes(self):
        with self.lock:
            self._save_json(self.recipes_path, self.recipes)
            self.uses_admin_data = True

    def next_recipe_id(self):
        ids = [int(r["recipe_id"]) for r in self.recipes if str(r.get("recipe_id", "")).isdigit()]
        return (max(ids) + 1) if ids else 1

    def find_index(self, recipe_id):
        for i, r in enumerate(self.recipes):
            if str(r.get("recipe_id")) == str(recipe_id):
                return i
        return None

    def clean_dish(self, form):
        dish = {}
        for field in DISH_FIELDS:
            value = (form.get(field) or "").strip()
            if field.endswith("_text") or field == "tags":
                value = ", ".join(_dedupe(t.strip() for t in value.replace("\n", ",").split(",") if t.strip()))
            dish[field] = value
        dish["country"] = dish["country"].upper()
        dish["region"] = dish["region"] or None
        if not dish["title"]:
            raise ValueError("The dish needs a title.")
        if not dish["country"]:
            raise ValueError("The dish needs a country.")
        if not dish["ingredient_text"]:
            raise ValueError("The dish needs at least one ingredient (they are used for matching).")
        # The canon fields are what the NER pipeline produced. For admin-entered dishes they match the text.
        for feature in FEATURES:
            field = TEXT_FIELD[feature]
            dish[field.replace("_text", "_canon")] = dish[field]
        dish["country_region"] = self.region_of(dish["country"])
        return dish

    def add_dish(self, form):
        with self.lock:
            dish = self.clean_dish(form)
            dish["recipe_id"] = self.next_recipe_id()
            self._ensure_country(dish["country"])
            self.recipes.append(dish)
            self.save_recipes()
            return dish

    def update_dish(self, recipe_id, form):
        with self.lock:
            idx = self.find_index(recipe_id)
            if idx is None:
                raise ValueError("Dish not found.")
            dish = self.clean_dish(form)
            dish["recipe_id"] = self.recipes[idx]["recipe_id"]
            self._ensure_country(dish["country"])
            self.recipes[idx].update(dish)
            self.save_recipes()
            return self.recipes[idx]

    def delete_dish(self, recipe_id):
        with self.lock:
            idx = self.find_index(recipe_id)
            if idx is None:
                raise ValueError("Dish not found.")
            removed = self.recipes.pop(idx)
            self.save_recipes()
            return removed

    def import_dataset(self, records, mode="append"):
        """Upload a dataset (list of dish dicts). mode = append or replace."""
        with self.lock:
            cleaned = []
            next_id = self.next_recipe_id() if mode == "append" else 1
            for n, rec in enumerate(records, start=1):
                try:
                    dish = self.clean_dish({k: ("" if v is None else str(v)) for k, v in rec.items()})
                except ValueError as error:
                    raise ValueError(f"Row {n}: {error}")
                rid = str(rec.get("recipe_id") or "").strip()
                dish["recipe_id"] = int(rid) if rid.isdigit() and mode == "replace" else next_id
                next_id = max(next_id, int(dish["recipe_id"])) + 1
                cleaned.append(dish)
            if not cleaned:
                raise ValueError("The uploaded file has no dishes.")
            if mode == "replace":
                self.recipes = cleaned
            else:
                self.recipes.extend(cleaned)
            for dish in cleaned:
                self._ensure_country(dish["country"])
            self.save_recipes()
            return len(cleaned)

    def reset_to_original(self):
        with self.lock:
            self.recipes = [dict(r) for r in self.base_recipes]
            for path in (self.recipes_path, self.countries_path):
                if os.path.exists(path):
                    os.replace(path, path + ".bak")
            self.uses_admin_data = False
            self.countries = self._load_countries()

    # ---------------- countries ----------------
    def save_countries(self):
        with self.lock:
            self._save_json(self.countries_path, self.countries)

    def country(self, name):
        name = (name or "").strip().upper()
        return next((c for c in self.countries if c["name"] == name), None)

    def region_of(self, name):
        c = self.country(name)
        if c:
            return c["region"]
        return DEFAULT_REGIONS.get((name or "").upper(), "Other Asia")

    def label_of(self, name):
        c = self.country(name)
        return c["label"] if c else (name or "").title()

    def _ensure_country(self, name):
        if not self.country(name):
            self.countries.append({"name": name, "label": name.title(),
                                   "region": DEFAULT_REGIONS.get(name, "Other Asia"), "visible": True})
            self.countries.sort(key=lambda c: c["name"])
            self.save_countries()

    def add_country(self, label, region):
        label = (label or "").strip()
        if not label:
            raise ValueError("Enter a country name.")
        name = label.upper()
        if self.country(name):
            raise ValueError(f"{label} is already in the list.")
        self.countries.append({"name": name, "label": label, "region": region or "Other Asia", "visible": True})
        self.countries.sort(key=lambda c: c["name"])
        self.save_countries()

    def update_country(self, name, label, region, visible):
        """Change how a country is shown (name in the dropdown, region, shown or hidden).
        The stored country key of the dishes stays the same, so OCR and old searches keep working.
        """
        with self.lock:
            c = self.country(name)
            if not c:
                raise ValueError("Country not found.")
            label = (label or "").strip() or c["label"]
            if any(o is not c and o["label"].lower() == label.lower() for o in self.countries):
                raise ValueError(f"{label} is already in the list.")
            region_changed = bool(region) and region != c["region"]
            c["label"] = label
            c["region"] = region or c["region"]
            c["visible"] = bool(visible)
            self.save_countries()
            if region_changed:
                for r in self.recipes:
                    if r["country"] == c["name"]:
                        r["country_region"] = c["region"]
                self.save_recipes()
            return region_changed

    def remove_country(self, name):
        c = self.country(name)
        if not c:
            raise ValueError("Country not found.")
        count = sum(1 for r in self.recipes if r["country"] == c["name"])
        if count:
            raise ValueError(f"{c['label']} still has {count} dishes. Delete or move them first, "
                             "or untick 'Show in dropdown' to hide it.")
        self.countries.remove(c)
        self.save_countries()

    def dropdown_countries(self):
        """Countries for the search dropdowns: visible and with at least one dish."""
        with_dishes = {r["country"] for r in self.recipes}
        return [
            {"value": c["name"].lower(), "label": c["label"], "region": c["region"]}
            for c in sorted(self.countries, key=lambda c: c["label"])
            if c.get("visible", True) and c["name"] in with_dishes
        ]

    # ---------------- prompts ----------------
    def get_prompt(self, name, default):
        return self.prompts.get(name) or default

    def set_prompt(self, name, text):
        with self.lock:
            if text and text.strip():
                self.prompts[name] = text.strip()
            else:
                self.prompts.pop(name, None)
            self._save_json(self.prompts_path, self.prompts)

    # ---------------- matcher files ----------------
    def _vector_for(self, feature, item, new_items, new_vecs):
        """Vector for one item: known, borrowed from the closest known item, or None."""
        base = self.base[feature]
        if item in base["index"]:
            return base["vecs"][base["index"][item]]
        norm = _normal_item(item)
        if norm in base["normal"]:
            return base["vecs"][base["normal"][norm]]
        close = difflib.get_close_matches(item, list(base["index"]), n=1, cutoff=0.85)
        if close:
            return base["vecs"][base["index"][close[0]]]
        # Shared words: "smoked duck breast" borrows from "duck breast", "duck"...
        words = [w for w in re.findall(r"[a-z]+", norm) if len(w) > 2]
        picks = [base["normal"][w] for w in words if w in base["normal"]]
        if not picks:
            for known, i in base["normal"].items():
                if words and known.split()[-1:] == words[-1:]:
                    picks.append(i)
                    break
        if picks:
            v = base["vecs"][picks].mean(axis=0)
            n = np.linalg.norm(v)
            return v / n if n else None
        return None

    def write_matcher_files(self):
        """Write <feature>_items.json and <feature>_item_vecs.npy for the current dataset."""
        with self.lock:
            missing = []
            for feature in FEATURES:
                base = self.base[feature]
                items = list(base["items"])
                index = dict(base["index"])
                vecs = [base["vecs"]]
                extra = []
                recipe_ids = []
                field = TEXT_FIELD[feature]
                for recipe in self.recipes:
                    b = self.base_by_key.get(self._key(recipe))
                    if b is not None and (recipe.get(field) or "") == (self.base_recipes[b].get(field) or ""):
                        recipe_ids.append(list(base["recipes"][b]))
                        continue
                    ids = []
                    for item in _dedupe(_split(recipe.get(field))):
                        if item not in index:
                            v = self._vector_for(feature, item, items, extra)
                            if v is None:
                                missing.append((feature, item))
                                v = np.zeros(base["vecs"].shape[1], dtype=np.float32)
                            index[item] = len(items)
                            items.append(item)
                            extra.append(np.asarray(v, dtype=np.float32))
                        ids.append(index[item])
                    recipe_ids.append(ids)
                if extra:
                    vecs.append(np.stack(extra))
                all_vecs = np.concatenate(vecs).astype(np.float32)
                # Start from the vectorizer's own document counts so unchanged dishes keep
                # (almost) the same scores, then adjust for the dishes that were added,
                # changed or removed.
                df = np.zeros(len(items))
                df[: len(base["df"])] = base["df"]
                kept = set()
                for recipe, ids in zip(self.recipes, recipe_ids):
                    b = self.base_by_key.get(self._key(recipe))
                    if b is not None and ids == list(base["recipes"][b]):
                        kept.add(b)
                    else:
                        for i in set(ids):
                            df[i] += 1
                for b, ids in enumerate(base["recipes"]):
                    if b not in kept:
                        for i in set(ids):
                            df[i] = max(df[i] - 1, 1.0)
                np.save(os.path.join(self.runtime_dir, f"{feature}_item_vecs.npy"), all_vecs)
                with open(os.path.join(self.runtime_dir, f"{feature}_items.json"), "w", encoding="utf-8") as f:
                    json.dump({"items": items, "df": df.tolist(), "n_recipes": len(self.recipes),
                               "recipes": recipe_ids}, f)
            self.missing_vectors = sorted(set(missing))
            return self.runtime_dir
