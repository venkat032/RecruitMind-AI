from app.database.connections import get_cursor
from app.database.models import create_tables

# Safe to re-run: existing jobs (title + company) and
# candidates (email) are skipped, never duplicated or overwritten.

def seed_data():
    create_tables()

    jobs = [

        (
            "AI Developer",
            "TechNova",
            "Hyderabad",
            1000000,
            "Python, FastAPI, LangChain, LangGraph, PostgreSQL",
            "Build AI agents and backend systems."
        ),

        (
            "Backend AI Engineer",
            "InnovateAI",
            "Bangalore",
            1200000,
            "Python, FastAPI, PostgreSQL, Docker",
            "Build production AI backend systems."
        ),

        (
            "Machine Learning Engineer",
            "NextGen",
            "Pune",
            1400000,
            "Python, Machine Learning, RAG",
            "Develop machine learning and RAG systems."
        )
    ]

    candidates = [

        (
            "Rahul Kumar",
            "rahul@example.com",
            "Hyderabad",
            "Python, FastAPI, LangChain, LangGraph, PostgreSQL, Docker",
            3,
            "AI Developer with 3 years experience building AI applications."
        ),

        (
            "Priya Sharma",
            "priya@example.com",
            "Bangalore",
            "Python, LangChain, RAG, PostgreSQL",
            4,
            "AI Engineer with experience in RAG and LLM applications."
        )
    ]

    with get_cursor() as cursor:

        cursor.executemany(
            """
            INSERT INTO jobs
            (
                title,
                company,
                location,
                salary,
                skills,
                description
            )
            SELECT %s, %s, %s, %s, %s, %s
            WHERE NOT EXISTS (
                SELECT 1 FROM jobs
                WHERE title = %s AND company = %s
            )
            """,
            [job + (job[0], job[1]) for job in jobs]
        )

        cursor.executemany(
            """
            INSERT INTO candidates
            (
                name,
                email,
                location,
                skills,
                experience,
                resume_text
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT ((LOWER(email))) DO NOTHING
            """,
            candidates
        )

    print("Seed data inserted.")


if __name__ == "__main__":
    seed_data()
