import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])
