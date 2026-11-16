"""Cultural information for a dish (panel revision Oab 4): culture involved, history,
health benefits and allergens.

  - Allergens are found with rules from the dish's own ingredient list, so they never
    depend on GPT. Each allergen shows the ingredients that triggered it.
  - Culture, history and health notes come from, in this order:
      1. notes the admin typed for the dish (admin page)
      2. GPT (cached in admin_data/cuisync.db), clearly labelled as AI-generated
      3. a short template built from the dataset (when GPT is off)
"""
import hashlib
import json
import os
import re
import sqlite3
from contextlib import closing

DEFAULT_PROMPT = """You write short cultural notes for CuiSync, a system that compares Asian dishes.
You get one JSON object with a dish name, its alternative name, its country, its region and its ingredient list.
Return ONLY a JSON object with these keys:
  "culture": 1-2 sentences on the culture or community the dish belongs to and when or how it is usually eaten.
  "history": 1-2 sentences on where the dish is generally believed to come from or how it developed. If the history is uncertain or you do not know it, say so plainly instead of guessing.
  "health": a list of 2-4 short, factual nutrition notes based ONLY on ingredients in the list (for example "Chicken thigh adds protein."). No medical claims, no cures, no disease prevention.
Rules: be neutral and respectful, do not rank cuisines, do not invent ingredients, keep each sentence under 30 words, write for home cooks and chefs."""

# Allergen groups (based on the common food allergens on labels). Each group lists words that
# trigger it and words that cancel a false hit (peanut butter is not milk, eggplant is not egg).
ALLERGENS = {
    "Peanuts": {"hit": ["peanut", "groundnut"], "not": []},
    "Tree nuts": {"hit": ["almond", "cashew", "walnut", "pistachio", "hazelnut", "pecan", "macadamia",
                          "candlenut", "pine nut", "brazil nut", "chestnut"], "not": ["water chestnut"]},
    "Milk": {"hit": ["milk", "butter", "cream", "cheese", "yogurt", "yoghurt", "ghee", "paneer", "curd",
                     "condensed milk", "evaporated milk", "khoa", "malai", "dahi", "labneh", "kaymak", "whey"],
             "not": ["coconut milk", "coconut cream", "peanut butter", "almond milk", "soy milk",
                     "cream of coconut", "bean curd", "cream of tartar", "cream cracker"]},
    "Egg": {"hit": ["egg", "mayonnaise"], "not": ["eggplant"]},
    "Fish": {"hit": ["fish", "anchovy", "anchovies", "bonito", "tuna", "salmon", "mackerel", "sardine",
                     "cod", "tilapia", "milkfish", "catfish", "snapper", "dashi", "katsuobushi", "mahi"],
             "not": ["fish ball sauce"]},
    "Shellfish": {"hit": ["shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop",
                          "squid", "octopus", "cuttlefish", "krill", "belacan", "bagoong", "cockle"], "not": []},
    "Soy": {"hit": ["soy", "soya", "tofu", "miso", "edamame", "tempeh", "natto", "doenjang", "gochujang",
                    "tamari", "kecap", "bean curd", "soybean", "taucu", "tauco"], "not": []},
    "Wheat/Gluten": {"hit": ["flour", "wheat", "bread", "panko", "breadcrumb", "semolina", "bulgur",
                             "couscous", "udon", "ramen", "soba", "noodle", "pasta", "wonton", "dumpling wrapper",
                             "spring roll wrapper", "pastry", "roti", "naan", "pita", "soy sauce", "barley",
                             "seitan", "beer", "yufka", "phyllo", "filo"],
                     "not": ["rice flour", "glutinous rice flour", "rice noodle", "tapioca flour", "corn flour",
                             "cornflour", "chickpea flour", "gram flour", "potato flour", "mung bean noodle",
                             "glass noodle", "rice paper", "cassava flour", "rice vermicelli", "buckwheat"]},
    "Sesame": {"hit": ["sesame", "tahini", "gomasio"], "not": []},
}

# Plain nutrition notes for common ingredients, used when GPT is off
NUTRITION_NOTES = [
    (("soy sauce", "fish sauce", "shrimp paste", "oyster sauce", "miso", "bagoong", "salt"), "{x} adds a lot of sodium, so use it in moderation."),
    (("chicken", "pork", "beef", "lamb", "mutton", "goat", "duck", "turkey"), "{x} adds protein."),
    (("fish", "salmon", "tuna", "mackerel", "sardine", "milkfish", "tilapia"), "{x} adds protein; oily fish also gives omega-3 fats."),
    (("shrimp", "prawn", "squid", "crab", "clam", "mussel", "scallop"), "{x} is a lean source of protein."),
    (("egg",), "{x} adds protein."),
    (("tofu", "tempeh", "edamame"), "{x} is a plant source of protein."),
    (("lentil", "chickpea", "mung bean", "black bean", "kidney bean", "dal"), "{x} adds plant protein and fiber."),
    (("spinach", "kangkong", "bok choy", "cabbage", "kale", "moringa", "malunggay", "mustard green", "pak choi"), "{x} adds fiber and vitamins."),
    (("carrot", "sweet potato", "pumpkin", "squash"), "{x} is a source of vitamin A (beta-carotene)."),
    (("tomato",), "{x} adds vitamin C."),
    (("lime", "lemon", "calamansi", "orange"), "{x} adds vitamin C and acidity."),
    (("brown rice", "oat", "barley", "whole wheat"), "{x} is a whole grain with fiber."),
    (("rice", "noodle", "potato", "bread", "flour"), "{x} is the main carbohydrate (energy) of the dish."),
    (("coconut milk", "coconut cream"), "{x} makes the dish rich but is high in saturated fat."),
    (("yogurt", "kimchi", "natto", "tempeh"), "{x} is a fermented food."),
    (("peanut", "cashew", "almond", "sesame"), "{x} adds healthy fats but also calories."),
    (("eggplant", "okra", "bean sprout", "green bean", "string bean", "bell pepper", "onion"), "{x} adds fiber."),
    (("sugar", "palm sugar", "condensed milk", "honey"), "{x} adds sweetness (added sugar)."),
]

DB_PATH = None
_get_prompt = None
_client = None
_model = None


def init(data_dir, get_prompt, client, model):
    global DB_PATH, _get_prompt, _client, _model
    DB_PATH = os.path.join(data_dir, "cuisync.db")
    _get_prompt, _client, _model = get_prompt, client, model
    with closing(sqlite3.connect(DB_PATH)) as conn, conn:
        conn.execute("CREATE TABLE IF NOT EXISTS cultural_info (cache_key TEXT PRIMARY KEY, dish TEXT, "
                     "info TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")


def _ingredients(recipe):
    return [t.strip().lower() for t in str(recipe.get("ingredient_text") or "").split(",") if t.strip()]


def _has(text, word):
    return re.search(r"\b" + re.escape(word) + r"(s|es)?\b", text) is not None


def find_allergens(recipe):
    found = []
    for name, rule in ALLERGENS.items():
        triggers = []
        for ing in _ingredients(recipe):
            # Take out the look-alike phrases first ("coconut milk" is not milk)
            rest = ing
            for phrase in sorted(rule["not"], key=len, reverse=True):
                rest = re.sub(r"\b" + re.escape(phrase) + r"(s|es)?\b", " ", rest)
            if any(_has(rest, h) for h in rule["hit"]):
                triggers.append(ing)
        if triggers:
            found.append({"name": name, "from": sorted(set(triggers))})
    return found


def _template_notes(recipe, region_label, country_label):
    title = (recipe.get("title") or "").strip()
    alt = (recipe.get("alternative_title") or "").strip()
    named = f"{title} ({alt})" if alt and alt.lower() != title.lower() else title
    region = recipe.get("region")
    culture = f"{named} is a dish from {country_label}, part of the cuisines of {region_label}."
    if region and str(region).lower() not in ("none", "no specific"):
        culture += f" It is linked to the {region} region."
    health, used = [], set()
    for ing in _ingredients(recipe):
        for words, note in NUTRITION_NOTES:
            if any(_has(ing, w) for w in words):
                # Only the first rule that fits this ingredient, and each note once
                if note not in used:
                    health.append(note.format(x=ing.capitalize()))
                    used.add(note)
                break
        if len(health) == 4:
            break
    return {
        "culture": culture,
        "history": "No verified history has been added for this dish yet.",
        "health": health,
    }


def _cache_key(payload, prompt):
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False) + "|" + prompt + "|" + str(_model)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _ask_gpt(payload, prompt):
    key = _cache_key(payload, prompt)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute("SELECT info FROM cultural_info WHERE cache_key = ?", (key,)).fetchone()
    if row:
        return json.loads(row[0])
    resp = _client.chat.completions.create(
        model=_model,
        messages=[{"role": "system", "content": prompt},
                  {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        temperature=0.2,
        max_tokens=350,
        response_format={"type": "json_object"},
    )
    info = json.loads(resp.choices[0].message.content)
    info = {
        "culture": str(info.get("culture", "")).strip(),
        "history": str(info.get("history", "")).strip(),
        "health": [str(h).strip() for h in (info.get("health") or []) if str(h).strip()][:4],
    }
    if info["culture"]:
        with closing(sqlite3.connect(DB_PATH)) as conn, conn:
            conn.execute("INSERT OR REPLACE INTO cultural_info (cache_key, dish, info) VALUES (?, ?, ?)",
                         (key, payload["dish"], json.dumps(info, ensure_ascii=False)))
    return info


def dish_info(recipe, region_label, country_label):
    payload = {
        "dish": (recipe.get("title") or "").strip(),
        "alternative_name": (recipe.get("alternative_title") or "").strip(),
        "country": country_label,
        "region": region_label,
        "ingredients": _ingredients(recipe),
    }
    info, source = None, "template"
    if _client is not None:
        try:
            info = _ask_gpt(payload, _get_prompt())
            source = "ai"
        except Exception as exc:  # GPT down / bad JSON -> template
            print("[CuiSync] cultural info GPT failed:", type(exc).__name__, exc)
            info = None
    if not info or not info.get("culture"):
        info, source = _template_notes(recipe, region_label, country_label), "template"
    # Notes typed by the admin always win
    admin_fields = []
    if (recipe.get("culture_notes") or "").strip():
        info["culture"] = recipe["culture_notes"].strip()
        admin_fields.append("culture")
    if (recipe.get("history_notes") or "").strip():
        info["history"] = recipe["history_notes"].strip()
        admin_fields.append("history")
    return {
        "title": payload["dish"],
        "country": country_label,
        "region": region_label,
        "culture": info["culture"],
        "history": info["history"],
        "health": info["health"],
        "allergens": find_allergens(recipe),
        "source": source,
        "admin_fields": admin_fields,
    }
