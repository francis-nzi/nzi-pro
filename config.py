
import os
from dotenv import load_dotenv
load_dotenv()

APP_TITLE = "NZI Pro"
DB_PATH = os.getenv("NZI_DB_PATH", "carbon_business.db")
LOGO_URL = os.getenv("NZI_LOGO_URL", "https://netzero.international/wp-content/uploads/2025/08/netzero-logo.png")
DEFAULT_YEAR = int(os.getenv("NZI_DEFAULT_YEAR", "2026"))
