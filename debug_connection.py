"""
Debug script to test database connection with detailed logging
"""
from dotenv import load_dotenv
load_dotenv()

import os
import psycopg

# Get the URL from environment
url = os.getenv("DATABASE_URL")
print(f"DATABASE_URL from .env: {url[:50]}...{url[-30:]}")

# Parse it manually
from urllib.parse import urlparse
parsed = urlparse(url)
print(f"\nParsed components:")
print(f"  Scheme: {parsed.scheme}")
print(f"  Username: {parsed.username}")
print(f"  Password: {'*' * len(parsed.password) if parsed.password else 'None'}")
print(f"  Hostname: {parsed.hostname}")
print(f"  Port: {parsed.port}")
print(f"  Database: {parsed.path}")

# Try connection with explicit parameters instead of URL
print("\n" + "="*60)
print("Attempting connection with explicit parameters...")
print("="*60)

try:
    conn = psycopg.connect(
        host=parsed.hostname,
        port=parsed.port,
        dbname=parsed.path.lstrip('/'),
        user=parsed.username,
        password=parsed.password,
        sslmode='require'
    )
    print("✓ Connection successful with explicit parameters!")
    
    cur = conn.execute("SELECT current_user, version()")
    result = cur.fetchone()
    print(f"✓ Connected as: {result[0]}")
    print(f"✓ PostgreSQL version: {result[1][:80]}")
    conn.close()
    
except Exception as e:
    print(f"✗ Connection failed with explicit parameters: {e}")

print("\n" + "="*60)
print("Attempting connection with URL string...")
print("="*60)

try:
    conn = psycopg.connect(url)
    print("✓ Connection successful with URL!")
    
    cur = conn.execute("SELECT current_user")
    result = cur.fetchone()
    print(f"✓ Connected as: {result[0]}")
    conn.close()
    
except Exception as e:
    print(f"✗ Connection failed with URL: {e}")
