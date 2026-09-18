"""
Automated Test Suite for Flint AI Agent & Diagnostics
Tests agent endpoints, dependency requirements, note memory, and action processing.
"""

import unittest
import json
import sys
import os

# Add parent directory to path so agent can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from agent.agent import (
        app,
        is_note_edit_request,
        extract_json_object,
        summarize_actions,
        build_memory,
        builtin_response,
    )
except ImportError:
    from agent import (
        app,
        is_note_edit_request,
        extract_json_object,
        summarize_actions,
        build_memory,
        builtin_response,
    )



class TestAgentDependencies(unittest.TestCase):
    """Test that critical dependencies are installed and available"""

    def test_required_modules(self):
        try:
            import flask
            import flask_cors
            import requests
            self.assertTrue(True)
        except ImportError as e:
            self.fail(f"Missing required dependency for AI Agent: {e}")


class TestAgentEndpoints(unittest.TestCase):
    """Test Flask agent endpoints using the test client"""

    def setUp(self):
        self.client = app.test_client()

    def test_health_endpoint(self):
        """GET /health must return 200 and complete diagnostic data"""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()

        self.assertIsNotNone(data)
        self.assertEqual(data.get("status"), "healthy")
        self.assertEqual(data.get("agent"), "flint")
        self.assertEqual(data.get("version"), "1.0.0")
        self.assertIn("python_version", data)
        self.assertIsInstance(data.get("capabilities"), list)
        self.assertIn("chat", data["capabilities"])
        self.assertIn("memory", data["capabilities"])

        # Check Ollama backend reporting
        ollama_info = data.get("ollama")
        self.assertIsInstance(ollama_info, dict)
        self.assertIn("connected", ollama_info)
        self.assertIn("url", ollama_info)

    def test_status_endpoint(self):
        """GET /status must return 200 and agent status"""
        response = self.client.get("/status")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data.get("agent"), "flint")
        self.assertIn(data.get("status"), ["connected", "disconnected"])
        self.assertTrue(data.get("healthy"))

    def test_models_endpoint(self):
        """GET /models must return 200 and a models array"""
        response = self.client.get("/models")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("models", data)
        self.assertIsInstance(data["models"], list)


class TestAgentLogic(unittest.TestCase):
    """Test core agent parsing, memory generation, and action helpers"""

    def test_is_note_edit_request(self):
        self.assertTrue(is_note_edit_request("please edit note titled Ideas"))
        self.assertTrue(is_note_edit_request("rename note to Work"))
        self.assertTrue(is_note_edit_request("create note with groceries"))
        self.assertTrue(is_note_edit_request("update note content"))
        self.assertFalse(is_note_edit_request("what is the capital of France?"))
        self.assertFalse(is_note_edit_request("explain quantum physics"))

    def test_extract_json_object(self):
        # Raw JSON
        raw = '{"action": "create_note", "title": "Test"}'
        self.assertEqual(extract_json_object(raw), {"action": "create_note", "title": "Test"})

        # Markdown-wrapped JSON
        fenced = '```json\n{"action": "edit_note"}\n```'
        self.assertEqual(extract_json_object(fenced), {"action": "edit_note"})

        # Text with embedded JSON
        embedded = 'Sure! Here is the JSON: {"type": "rename_note"} Done!'
        self.assertEqual(extract_json_object(embedded), {"type": "rename_note"})

        # Invalid text
        self.assertIsNone(extract_json_object("no json here"))

    def test_summarize_actions(self):
        actions = [
            {"type": "rename_note", "title": "My Note"},
            {"type": "update_note"},
            {"type": "create_note", "title": "New Item"},
            {"type": "delete_note"},
        ]
        summary = summarize_actions(actions)
        self.assertIn('Renamed the note to "My Note"', summary)
        self.assertIn('Updated the selected note content', summary)
        self.assertIn('Created a new note titled "New Item"', summary)

    def test_build_memory(self):
        mock_notes = [
            {"id": "1", "title": "Index", "content": "Welcome to [[Meeting Notes]]"},
            {"id": "2", "title": "Meeting Notes", "content": "Discussed roadmap and [[Index]]"},
        ]
        memory = build_memory(mock_notes, active_note_id="1", query="Meeting", max_notes=5)
        self.assertIn("Total notes in vault: 2", memory)
        self.assertIn("CURRENTLY OPEN NOTE", memory)
        self.assertIn("Index", memory)

    def test_builtin_response(self):
        mock_notes = [
            {"id": "1", "title": "Hello", "content": "World"},
        ]
        reply = builtin_response("hello", mock_notes, "1")
        self.assertIsInstance(reply, str)
        self.assertGreater(len(reply), 0)


if __name__ == "__main__":
    print("=" * 60)
    print("Flint AI Agent Diagnostic Test Suite")
    print("=" * 60)
    suite = unittest.TestLoader().loadTestsFromNames([
        "TestAgentDependencies",
        "TestAgentEndpoints",
        "TestAgentLogic",
    ], module=sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
