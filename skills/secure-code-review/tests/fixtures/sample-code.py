#!/usr/bin/env python3
"""
Sample Python code with security vulnerabilities for testing.
This file is used by test-cases.yml to validate the secure-code-review pattern.
"""

import os
import sqlite3


def authenticate_user(username, password):
    """Vulnerable authentication function with SQL injection risk."""
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    
    # SQL Injection vulnerability: concatenating user input
    query = f"SELECT * FROM users WHERE username = '{username}' AND password = '{password}'"
    cursor.execute(query)
    
    result = cursor.fetchone()
    conn.close()
    
    return result is not None


def get_api_key():
    """Hardcoded credential vulnerability."""
    # Hardcoded API key
    api_key = "sk-1234567890abcdef"
    return api_key


def load_config():
    """Path traversal vulnerability."""
    filename = input("Enter config filename: ")
    
    # Path traversal: no validation on user input
    with open(f"/etc/configs/{filename}") as f:
        return f.read()


def execute_command(user_input):
    """Command injection vulnerability."""
    # Command injection: user input passed directly to os.system
    os.system(f"echo {user_input}")
