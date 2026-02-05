"""
Check .env file and show current DATABASE_URL
"""
from pathlib import Path
import re

env_file = Path(__file__).parent / ".env"

if not env_file.exists():
    print("❌ .env file not found!")
    exit(1)

content = env_file.read_text()

# Find all DATABASE_URL lines
db_urls = []
for line_num, line in enumerate(content.split('\n'), 1):
    if 'DATABASE_URL' in line and not line.strip().startswith('#'):
        # Mask password
        masked = re.sub(r'://([^:]+):([^@]+)@', r'://\1:[***]@', line)
        db_urls.append((line_num, line, masked))

print("=" * 70)
print("Current DATABASE_URL in .env file:")
print("=" * 70)

if not db_urls:
    print("❌ No DATABASE_URL found in .env file")
else:
    for line_num, original, masked in db_urls:
        print(f"\nLine {line_num}: {masked}")
        
        # Check if it's using the correct username
        if '://postgres@' in original or '://postgres:' in original:
            if 'postgres.zehbudmsbpuqkggmjjku' not in original:
                print("  ❌ WRONG: Using 'postgres' instead of 'postgres.zehbudmsbpuqkggmjjku'")
                print("  ✅ Should be: postgresql://postgres.zehbudmsbpuqkggmjjku:[password]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres")
        elif 'postgres.zehbudmsbpuqkggmjjku' in original:
            print("  ✅ Correct username format")

print("\n" + "=" * 70)
print("Action Required:")
print("=" * 70)
print("1. Open .env file in your editor")
print("2. Find the DATABASE_URL line")
print("3. Make sure it uses: postgres.zehbudmsbpuqkggmjjku (not just 'postgres')")
print("4. Save the file")
print("5. Run: python run_migrations_and_ingest.py")
