"""MongoDB Integration for Kylo / Kylo.

Manages connection to the Kylo MongoDB Atlas database, persistent user sessions
authenticated via Google Auth 2.0, multi-agent run telemetry, and user-selected outputs.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("kylo.mongo")

DEFAULT_URI = "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/Kylo?retryWrites=true&w=majority"
DB_NAME = "Kylo"
FALLBACK_STORE_PATH = Path("data") / "kylo_mongo_store.json"


class KyloMongoService:
    def __init__(self) -> None:
        self.uri = os.environ.get("MONGODB_URI", DEFAULT_URI).strip()
        self.client: Any = None
        self.db: Any = None
        self.connected: bool = False
        self.mode: str = "disconnected"
        self._fallback_data: dict[str, list[dict[str, Any]]] = {
            "users": [],
            "agent_runs": [],
            "selected_outputs": [],
        }
        self._init_connection()

    def _init_connection(self) -> None:
        """Attempt connection to MongoDB Atlas, falling back to local persistent store if unavailable."""
        # Ensure data dir exists
        FALLBACK_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._load_fallback_store()

        if "<cluster>" in self.uri:
            logger.info(
                "[MongoDB] Notice: URI contains placeholder '<cluster>'. "
                "Active in local persistent Kylo DB mode until specific cluster host is configured."
            )
            self.mode = "local_persistent_store"
            return

        try:
            from pymongo import MongoClient

            self.client = MongoClient(
                self.uri,
                serverSelectionTimeoutMS=2500,
                connectTimeoutMS=2500,
            )
            # Test connection
            self.client.admin.command("ping")
            self.db = self.client[DB_NAME]
            self.connected = True
            self.mode = "atlas_live"
            logger.info(f"[MongoDB] Successfully connected to Atlas database '{DB_NAME}'.")
        except Exception as exc:
            logger.warning(
                f"[MongoDB] Remote Atlas connection failed ({exc}). "
                "Operating in resilient local persistent Kylo DB mode."
            )
            self.connected = False
            self.mode = "local_persistent_store"

    def _load_fallback_store(self) -> None:
        if FALLBACK_STORE_PATH.exists():
            try:
                with open(FALLBACK_STORE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self._fallback_data.update(data)
            except Exception as e:
                logger.error(f"[MongoDB] Error loading fallback store: {e}")

    def _persist_fallback_store(self) -> None:
        try:
            with open(FALLBACK_STORE_PATH, "w", encoding="utf-8") as f:
                json.dump(self._fallback_data, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"[MongoDB] Error persisting fallback store: {e}")

    def get_status(self) -> dict[str, Any]:
        """Return database operational status and collection metrics."""
        masked_uri = self.uri
        if "@" in masked_uri:
            proto, rest = masked_uri.split("://", 1)
            creds, host = rest.split("@", 1)
            user = creds.split(":", 1)[0]
            masked_uri = f"{proto}://{user}:*****@{host}"

        user_count = (
            self.db["users"].count_documents({})
            if self.connected
            else len(self._fallback_data["users"])
        )
        runs_count = (
            self.db["agent_runs"].count_documents({})
            if self.connected
            else len(self._fallback_data["agent_runs"])
        )
        selected_count = (
            self.db["selected_outputs"].count_documents({})
            if self.connected
            else len(self._fallback_data["selected_outputs"])
        )

        return {
            "ok": True,
            "database": DB_NAME,
            "connected": self.connected,
            "mode": self.mode,
            "uri_configured": bool(self.uri),
            "masked_uri": masked_uri,
            "collections": {
                "users": user_count,
                "agent_runs": runs_count,
                "selected_outputs": selected_count,
            },
        }

    def upsert_google_user(self, profile: dict[str, Any]) -> dict[str, Any]:
        """Create or update user record from Google Auth 2.0 payload."""
        email = profile.get("email", "").lower()
        sub = profile.get("sub") or profile.get("id") or str(uuid.uuid4())
        name = profile.get("name") or email.split("@")[0]
        picture = profile.get("picture", "")

        user_doc = {
            "id": f"usr-{sub[:12]}",
            "google_id": sub,
            "email": email,
            "name": name,
            "picture": picture,
            "provider": "google-oauth-2.0",
            "last_login_at": int(time.time()),
        }

        if self.connected:
            self.db["users"].update_one(
                {"google_id": sub},
                {
                    "$set": user_doc,
                    "$setOnInsert": {"created_at": int(time.time())},
                },
                upsert=True,
            )
            return user_doc

        # Local persistent fallback
        existing = next((u for u in self._fallback_data["users"] if u.get("google_id") == sub), None)
        if existing:
            existing.update(user_doc)
        else:
            user_doc["created_at"] = int(time.time())
            self._fallback_data["users"].append(user_doc)
        self._persist_fallback_store()
        return user_doc

    def save_agent_run(self, run_data: dict[str, Any]) -> str:
        """Store multi-agent run telemetry and each agent's individual result."""
        run_id = run_data.get("run_id") or f"run-{uuid.uuid4().hex[:12]}"
        record = {
            "run_id": run_id,
            "timestamp": int(time.time()),
            **run_data,
        }

        if self.connected:
            self.db["agent_runs"].insert_one(record)
        else:
            self._fallback_data["agent_runs"].append(record)
            self._persist_fallback_store()

        return run_id

    def save_user_selection(
        self,
        run_id: str,
        selected_agent_id: str,
        user_id: Optional[str] = None,
        notes: str = "",
        feedback: str = "",
    ) -> dict[str, Any]:
        """Record the user's choice selecting which agent's result is accepted as best."""
        selection_id = f"sel-{uuid.uuid4().hex[:8]}"

        # Look up run in store
        run = None
        if self.connected:
            run = self.db["agent_runs"].find_one({"run_id": run_id})
        else:
            run = next((r for r in self._fallback_data["agent_runs"] if r.get("run_id") == run_id), None)

        agent_result = None
        if run and "results" in run:
            agent_result = next(
                (res for res in run["results"] if res.get("agent_id") == selected_agent_id),
                None,
            )

        selection_record = {
            "selection_id": selection_id,
            "run_id": run_id,
            "selected_agent_id": selected_agent_id,
            "user_id": user_id or "anonymous-user",
            "notes": notes,
            "feedback": feedback,
            "agent_output": agent_result.get("output") if agent_result else None,
            "timestamp": int(time.time()),
        }

        if self.connected:
            self.db["selected_outputs"].insert_one(selection_record)
        else:
            self._fallback_data["selected_outputs"].append(selection_record)
            self._persist_fallback_store()

        return selection_record

    def get_selected_outputs(self, limit: int = 20) -> list[dict[str, Any]]:
        """Retrieve recent accepted agent outputs."""
        if self.connected:
            cursor = self.db["selected_outputs"].find({}, {"_id": 0}).sort("timestamp", -1).limit(limit)
            return list(cursor)
        items = sorted(self._fallback_data["selected_outputs"], key=lambda x: x.get("timestamp", 0), reverse=True)
        return items[:limit]


# Global singleton
mongo_service = KyloMongoService()
