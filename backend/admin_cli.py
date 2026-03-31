#!/usr/bin/env python3
"""CLI для управления паролями AdminPanel."""

import argparse
import getpass
import re
import sys
from pathlib import Path

import os

import bcrypt


def _get_data_dir():
    return Path(os.environ.get("DATA_DIR", "/data"))

def _connect(db_path):
    import sqlite3
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def _validate(password):
    if len(password) < 8:
        return "Пароль должен быть не менее 8 символов"
    if not re.search(r"[A-Za-z]", password):
        return "Пароль должен содержать буквы"
    if not re.search(r"\d", password):
        return "Пароль должен содержать цифры"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]", password):
        return "Пароль должен содержать спецсимвол (!@#$%^&*...)"
    return None

def cmd_password(args):
    data_dir = _get_data_dir()
    db_path = data_dir / "panel_users.sqlite"

    if not db_path.exists():
        print(f"БД не найдена: {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = _connect(db_path)
    rows = conn.execute("SELECT id, username, role FROM panel_users ORDER BY created_at ASC;").fetchall()

    if not rows:
        print("Пользователи не найдены.", file=sys.stderr)
        sys.exit(1)

    # Если указан username — используем его, иначе показываем список
    username = args.username
    if not username:
        print("Пользователи панели:")
        for i, r in enumerate(rows, 1):
            print(f"  {i}. {r['username']} ({r['role']})")
        print()
        choice = input("Введите имя пользователя или номер: ").strip()
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(rows):
                username = rows[idx]["username"]
            else:
                print("Неверный номер.", file=sys.stderr)
                sys.exit(1)
        else:
            username = choice

    # Найти пользователя
    user = conn.execute(
        "SELECT id, username FROM panel_users WHERE lower(username) = lower(?);",
        (username,)
    ).fetchone()

    if not user:
        print(f"Пользователь '{username}' не найден.", file=sys.stderr)
        sys.exit(1)

    # Ввод нового пароля
    if args.new_password:
        new_pwd = args.new_password
    else:
        new_pwd = input("Новый пароль: ")
        confirm = input("Подтвердите пароль: ")
        if new_pwd != confirm:
            print("Пароли не совпадают.", file=sys.stderr)
            sys.exit(1)

    err = _validate(new_pwd)
    if err:
        print(f"Ошибка: {err}", file=sys.stderr)
        sys.exit(1)

    password_hash = bcrypt.hashpw(new_pwd.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    conn.execute("UPDATE panel_users SET password_hash = ? WHERE id = ?;", (password_hash, user["id"]))
    conn.commit()
    conn.close()

    print(f"Пароль для '{user['username']}' успешно изменён.")

def cmd_list(args):
    data_dir = _get_data_dir()
    db_path = data_dir / "panel_users.sqlite"

    if not db_path.exists():
        print(f"БД не найдена: {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = _connect(db_path)
    rows = conn.execute("SELECT username, role, is_active FROM panel_users ORDER BY created_at ASC;").fetchall()
    conn.close()

    if not rows:
        print("Пользователей нет.")
        return

    print(f"{'Имя':<20} {'Роль':<15} {'Активен'}")
    print("-" * 45)
    for r in rows:
        active = "да" if r["is_active"] else "нет"
        print(f"{r['username']:<20} {r['role']:<15} {active}")

def main():
    parser = argparse.ArgumentParser(description="AdminPanel CLI")
    sub = parser.add_subparsers(dest="command")

    p_pwd = sub.add_parser("password", help="Сменить пароль пользователя")
    p_pwd.add_argument("username", nargs="?", default=None, help="Имя пользователя (опционально)")
    p_pwd.add_argument("--new-password", "-p", default=None, help="Новый пароль (если не указан — запросит интерактивно)")

    sub.add_parser("list", help="Список пользователей панели")

    args = parser.parse_args()

    if args.command == "password":
        cmd_password(args)
    elif args.command == "list":
        cmd_list(args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
