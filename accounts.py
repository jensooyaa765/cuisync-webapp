"""User accounts, profiles and search history for CuiSync (panel revisions).

One SQLite file (admin_data/cuisync.db) with two tables:
  users           - login, role (user / admin) and profile fields
  search_history  - every search a logged-in user makes, so they can open it again
"""
import json
import os
import sqlite3
from contextlib import closing

from werkzeug.security import check_password_hash, generate_password_hash as _werkzeug_hash


def generate_password_hash(password):
    # pbkdf2 works on every Python build. Werkzeug's default (scrypt) is missing on
    # macOS's built-in Python, which uses LibreSSL.
    return _werkzeug_hash(password, method="pbkdf2:sha256")

ROLES = ("user", "admin")
COOKING_ROLES = ("Home cook", "Chef", "Student", "Food researcher", "Other")
ALLERGEN_CHOICES = ("Peanuts", "Tree nuts", "Milk", "Egg", "Fish", "Shellfish", "Soy", "Wheat/Gluten", "Sesame")

DB_PATH = None


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(data_dir):
    global DB_PATH
    os.makedirs(data_dir, exist_ok=True)
    DB_PATH = os.path.join(data_dir, "cuisync.db")
    with closing(_conn()) as conn, conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'user',
                display_name  TEXT DEFAULT '',
                cooking_role  TEXT DEFAULT '',
                home_country  TEXT DEFAULT '',
                favorite_cuisines TEXT DEFAULT '[]',
                avoid_allergens   TEXT DEFAULT '[]',
                bio           TEXT DEFAULT '',
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS search_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                search_type   TEXT NOT NULL,      -- text, image, keyword, ingredients, tags
                query         TEXT DEFAULT '',
                dish_name     TEXT DEFAULT '',
                origin_country TEXT DEFAULT '',
                target_country TEXT DEFAULT '',
                recipe_id     TEXT DEFAULT '',
                result_title  TEXT DEFAULT '',
                result_country TEXT DEFAULT '',
                score         REAL,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id, created_at DESC);
            """
        )


def _user_dict(row):
    if row is None:
        return None
    user = dict(row)
    user.pop("password_hash", None)
    for key in ("favorite_cuisines", "avoid_allergens"):
        try:
            user[key] = json.loads(user.get(key) or "[]")
        except ValueError:
            user[key] = []
    user["is_admin"] = user.get("role") == "admin"
    user["name"] = user.get("display_name") or user.get("username")
    return user


def create_user(username, password, role="user", display_name=""):
    username = (username or "").strip()
    if len(username) < 3 or not username.replace("_", "").replace(".", "").isalnum():
        raise ValueError("Username must be at least 3 characters (letters, numbers, . or _).")
    if len(password or "") < 6:
        raise ValueError("Password must be at least 6 characters.")
    if role not in ROLES:
        role = "user"
    try:
        with closing(_conn()) as conn, conn:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password), role, display_name.strip()),
            )
            return cur.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError("That username is already taken.")


def ensure_admin(username, password):
    """Create the first admin account if there is no admin yet."""
    with closing(_conn()) as conn:
        has_admin = conn.execute("SELECT 1 FROM users WHERE role = 'admin'").fetchone()
    if not has_admin:
        try:
            create_user(username, password, role="admin", display_name="Administrator")
            return True
        except ValueError:
            pass
    return False


def authenticate(username, password):
    with closing(_conn()) as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", ((username or "").strip(),)).fetchone()
    if row and check_password_hash(row["password_hash"], password or ""):
        return _user_dict(row)
    return None


def get_user(user_id):
    with closing(_conn()) as conn:
        return _user_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def list_users():
    with closing(_conn()) as conn:
        rows = conn.execute(
            "SELECT u.*, (SELECT COUNT(*) FROM search_history h WHERE h.user_id = u.id) AS searches "
            "FROM users u ORDER BY u.created_at DESC"
        ).fetchall()
    return [dict(_user_dict(r), searches=r["searches"]) for r in rows]


def update_profile(user_id, form):
    favorite = [c for c in form.getlist("favorite_cuisines") if c][:13]
    allergens = [a for a in form.getlist("avoid_allergens") if a in ALLERGEN_CHOICES]
    cooking_role = form.get("cooking_role", "")
    if cooking_role not in COOKING_ROLES:
        cooking_role = ""
    with closing(_conn()) as conn, conn:
        conn.execute(
            "UPDATE users SET display_name = ?, cooking_role = ?, home_country = ?, "
            "favorite_cuisines = ?, avoid_allergens = ?, bio = ? WHERE id = ?",
            (
                form.get("display_name", "").strip()[:60],
                cooking_role,
                form.get("home_country", "").strip()[:60],
                json.dumps(favorite),
                json.dumps(allergens),
                form.get("bio", "").strip()[:500],
                user_id,
            ),
        )


def change_password(user_id, old, new):
    with closing(_conn()) as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], old or ""):
        raise ValueError("Your current password is not correct.")
    if len(new or "") < 6:
        raise ValueError("The new password must be at least 6 characters.")
    with closing(_conn()) as conn, conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new), user_id))


def set_role(user_id, role):
    if role not in ROLES:
        raise ValueError("Unknown role.")
    with closing(_conn()) as conn, conn:
        if role == "user":
            admins = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?", (user_id,)).fetchone()[0]
            if admins == 0:
                raise ValueError("There must be at least one admin.")
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))


def delete_user(user_id):
    with closing(_conn()) as conn, conn:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if row and row["role"] == "admin":
            admins = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
            if admins <= 1:
                raise ValueError("You can't delete the last admin.")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


# ---------------- search history ----------------
def add_history(user_id, **entry):
    fields = ("search_type", "query", "dish_name", "origin_country", "target_country",
              "recipe_id", "result_title", "result_country", "score")
    values = [entry.get(f) if f == "score" else str(entry.get(f) or "") for f in fields]
    with closing(_conn()) as conn, conn:
        # Same search twice in a row = just refresh the time
        last = conn.execute(
            "SELECT * FROM search_history WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user_id,)
        ).fetchone()
        if last and all(str(last[f] or "") == str(v or "") for f, v in zip(fields[:6], values[:6])):
            conn.execute("UPDATE search_history SET created_at = CURRENT_TIMESTAMP, result_title = ?, "
                         "result_country = ?, score = ? WHERE id = ?", (values[6], values[7], values[8], last["id"]))
            return
        conn.execute(
            f"INSERT INTO search_history (user_id, {', '.join(fields)}) VALUES (?, {', '.join('?' * len(fields))})",
            [user_id] + values,
        )


def get_history(user_id, limit=200):
    with closing(_conn()) as conn:
        rows = conn.execute(
            "SELECT * FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_history_entry(user_id, entry_id):
    with closing(_conn()) as conn:
        row = conn.execute("SELECT * FROM search_history WHERE user_id = ? AND id = ?", (user_id, entry_id)).fetchone()
    return dict(row) if row else None


def delete_history(user_id, entry_id=None):
    with closing(_conn()) as conn, conn:
        if entry_id is None:
            conn.execute("DELETE FROM search_history WHERE user_id = ?", (user_id,))
        else:
            conn.execute("DELETE FROM search_history WHERE user_id = ? AND id = ?", (user_id, entry_id))


def history_stats():
    with closing(_conn()) as conn:
        total = conn.execute("SELECT COUNT(*) FROM search_history").fetchone()[0]
        top = conn.execute(
            "SELECT dish_name, origin_country, COUNT(*) AS n FROM search_history "
            "WHERE dish_name != '' GROUP BY dish_name, origin_country ORDER BY n DESC LIMIT 5"
        ).fetchall()
        users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"total_searches": total, "users": users, "top_dishes": [dict(r) for r in top]}
