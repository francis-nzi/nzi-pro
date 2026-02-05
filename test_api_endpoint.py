import sys
sys.path.insert(0, '.')

from api.admin_routes import list_lookup_items

try:
    result = list_lookup_items("job_types", {"user": "test"})
    print("Success!")
    print(f"Items: {len(result['items'])}")
    print("First item:", result['items'][0] if result['items'] else "None")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
