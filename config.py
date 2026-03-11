import os
from dotenv import load_dotenv

# Load local .env defaults without overriding deployment/runtime environment.
load_dotenv(override=False)

APP_TITLE = "NZI Pro"
DB_PATH = os.getenv("NZI_DB_PATH", "carbon_business.db")
LOGO_URL = os.getenv("NZI_LOGO_URL", "https://netzero.international/wp-content/uploads/2025/08/netzero-logo.png")
DEFAULT_YEAR = int(os.getenv("NZI_DEFAULT_YEAR", "2026"))
