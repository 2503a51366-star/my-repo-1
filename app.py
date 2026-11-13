from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os
from datetime import datetime, timezone

app = Flask(__name__)
CORS(app)  # Allows your frontend to call this backend during development.

DATABASE = os.environ.get("DATABASE_PATH", "devops_pulse.db")
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "")  # Optional shared secret


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS builds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_id TEXT NOT NULL UNIQUE,
                pipeline TEXT NOT NULL,
                status TEXT NOT NULL,
                duration REAL,
                timestamp TEXT NOT NULL
            )
        """)
        count = conn.execute("SELECT COUNT(*) FROM builds").fetchone()[0]
        if count == 0:
            # Sample records make the dashboard useful on first launch.
            samples = [
                ("demo-1042", "DevOpsPipeline", "SUCCEEDED", 42),
                ("demo-1041", "DevOpsPipeline", "SUCCEEDED", 51),
                ("demo-1040", "DevOpsPipeline", "FAILED", 19),
                ("demo-1039", "DevOpsPipeline", "SUCCEEDED", 38),
                ("demo-1038", "DevOpsPipeline", "SUCCEEDED", 45),
            ]
            now = datetime.now(timezone.utc)
            for index, (execution_id, pipeline, status, duration) in enumerate(samples):
                timestamp = (now.replace(microsecond=0)).isoformat()
                conn.execute("""
                    INSERT INTO builds
                    (execution_id, pipeline, status, duration, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                """, (execution_id, pipeline, status, duration, timestamp))


def normalize_status(value):
    status = str(value or "").strip().upper()
    aliases = {
        "SUCCESS": "SUCCEEDED",
        "PASSED": "SUCCEEDED",
        "PASS": "SUCCEEDED",
        "FAILURE": "FAILED",
        "FAIL": "FAILED",
        "ERROR": "FAILED",
        "RUNNING": "IN_PROGRESS",
        "STARTED": "IN_PROGRESS",
    }
    status = aliases.get(status, status)
    allowed = {"SUCCEEDED", "FAILED", "IN_PROGRESS", "STOPPED",
               "STOPPING", "CANCELED", "CANCELLED", "UNKNOWN"}
    if status not in allowed:
        raise ValueError("Unsupported status. Use SUCCEEDED, FAILED, IN_PROGRESS or another supported pipeline state.")
    return status


def build_to_dict(row):
    return {
        "id": row["execution_id"],
        "executionId": row["execution_id"],
        "pipeline": row["pipeline"],
        "status": row["status"],
        "duration": row["duration"],
        "timestamp": row["timestamp"]
    }


@app.get("/")
def home():
    return jsonify({
        "message": "DevOps Pulse backend is running",
        "endpoints": ["/status", "/history", "/webhook"]
    })


@app.get("/status")
def get_status():
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM builds ORDER BY id DESC LIMIT 1"
        ).fetchone()

    if row is None:
        return jsonify({"error": "No build records found"}), 404

    return jsonify(build_to_dict(row))


@app.get("/history")
def get_history():
    limit = request.args.get("limit", default=100, type=int)
    limit = max(1, min(limit, 500))

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM builds ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()

    return jsonify([build_to_dict(row) for row in rows])


@app.post("/webhook")
def receive_pipeline_event():
    # If WEBHOOK_TOKEN is configured, callers must send it in this header.
    if WEBHOOK_TOKEN:
        supplied_token = request.headers.get("X-Webhook-Token", "")
        if supplied_token != WEBHOOK_TOKEN:
            return jsonify({"error": "Unauthorized webhook"}), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send a JSON object"}), 400

    execution_id = str(data.get("executionId") or data.get("id") or "").strip()
    pipeline = str(data.get("pipeline") or "DevOpsPipeline").strip()
    try:
        status = normalize_status(data.get("status") or data.get("state"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if not execution_id:
        return jsonify({"error": "executionId is required"}), 400
    if len(execution_id) > 200 or len(pipeline) > 200:
        return jsonify({"error": "executionId and pipeline must be 200 characters or fewer"}), 400

    duration = data.get("duration")
    if duration is not None:
        try:
            duration = float(duration)
            if duration < 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "duration must be a non-negative number"}), 400

    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()

    try:
        with get_db() as conn:
            conn.execute("""
                INSERT INTO builds
                (execution_id, pipeline, status, duration, timestamp)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(execution_id) DO UPDATE SET
                    pipeline=excluded.pipeline,
                    status=excluded.status,
                    duration=excluded.duration,
                    timestamp=excluded.timestamp
            """, (execution_id, pipeline, status, duration, timestamp))
    except sqlite3.Error:
        app.logger.exception("Could not save pipeline event")
        return jsonify({"error": "Database operation failed"}), 500

    return jsonify({
        "message": "Pipeline event saved",
        "executionId": execution_id,
        "status": status
    }), 201


@app.get("/health")
def health():
    return jsonify({"status": "ok", "database": "connected"})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
