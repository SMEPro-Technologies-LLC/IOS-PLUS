import sys
from unittest.mock import MagicMock
sys.modules['psycopg2'] = MagicMock()

import unittest
from unittest.mock import patch
import os
import tempfile

import verify_key_publication_consistency as key_consistency


class TestVerifyKeyPublicationConsistency(unittest.TestCase):
    @patch('urllib.request.urlopen')
    def test_check_dns_key_parses_doh_txt_payload(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"Answer":[{"type":16,"data":"\\"v=ios1 k=ed25519 p=abc123\\""}]}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        key, err = key_consistency.check_dns_key("_ios-signing-key.example.com")

        self.assertEqual(key, "abc123")
        self.assertIsNone(err)

    @patch('urllib.request.urlopen')
    def test_check_dns_key_falls_back_to_db_record_in_dev(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("dns offline")
        old_env = os.environ.get("NODE_ENV")
        os.environ["NODE_ENV"] = "development"
        try:
            key, err = key_consistency.check_dns_key(
                "_ios-signing-key.example.com",
                "v=ios1 k=ed25519 p=fallback-key"
            )
        finally:
            if old_env is None:
                del os.environ["NODE_ENV"]
            else:
                os.environ["NODE_ENV"] = old_env

        self.assertEqual(key, "fallback-key")
        self.assertIsNone(err)

    def test_check_filesystem_key_reads_existing_file(self):
        with tempfile.NamedTemporaryFile(mode="w+", delete=False) as f:
            f.write("pubkey-123")
            path = f.name
        try:
            key, err = key_consistency.check_filesystem_key(path)
            self.assertEqual(key, "pubkey-123")
            self.assertIsNone(err)
        finally:
            os.unlink(path)


if __name__ == '__main__':
    unittest.main()
