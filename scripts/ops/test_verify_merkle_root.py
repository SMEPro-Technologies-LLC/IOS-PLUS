import unittest
from unittest.mock import patch, MagicMock
import os
import io
import urllib.error

# Import the functions to test
import verify_merkle_root

class TestVerifyMerkleRootDNS(unittest.TestCase):
    def setUp(self):
        self.env_patches = {}
        # Clear env to avoid test pollution
        for key in ["DNS_PROVIDER", "ROUTE53_ZONE_ID", "AWS_ROLE_ARN", "AWS_ACCESS_KEY_ID", "GCP_PROJECT", "GCP_DNS_ZONE_NAME"]:
            if key in os.environ:
                self.env_patches[key] = os.environ[key]
                del os.environ[key]

    def tearDown(self):
        # Restore environment variables
        for key, val in self.env_patches.items():
            os.environ[key] = val

    @patch('urllib.request.urlopen')
    def test_get_gcp_access_token(self, mock_urlopen):
        # Mock response from metadata server
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"access_token": "mock-token-12345"}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        token = verify_merkle_root.get_gcp_access_token()
        self.assertEqual(token, "mock-token-12345")

    @patch('urllib.request.urlopen')
    def test_get_gcp_project_id(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'my-gcp-project-id'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        project_id = verify_merkle_root.get_gcp_project_id()
        self.assertEqual(project_id, "my-gcp-project-id")

    @patch('urllib.request.urlopen')
    def test_resolve_gcp_dns_zone_name(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'''
        {
            "managedZones": [
                {"name": "root-zone", "dnsName": "smeprotech.com."},
                {"name": "sub-zone", "dnsName": "sub.smeprotech.com."}
            ]
        }
        '''
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Test matching specific subdomain
        zone = verify_merkle_root.resolve_gcp_dns_zone_name(
            token="token", 
            project="proj", 
            fqdn="_ios-merkle.sub.smeprotech.com."
        )
        self.assertEqual(zone, "sub-zone")

        # Test matching parent domain
        zone2 = verify_merkle_root.resolve_gcp_dns_zone_name(
            token="token", 
            project="proj", 
            fqdn="_ios-merkle.smeprotech.com."
        )
        self.assertEqual(zone2, "root-zone")

    @patch('verify_merkle_root.get_gcp_access_token')
    @patch('verify_merkle_root.get_gcp_project_id')
    @patch('urllib.request.urlopen')
    def test_publish_gcp_dns_txt_record_new(self, mock_urlopen, mock_get_project, mock_get_token):
        mock_get_token.return_value = "mock-token"
        mock_get_project.return_value = "mock-project"
        os.environ["GCP_DNS_ZONE_NAME"] = "my-zone"

        # Mock urlopen:
        # First call: GET rrsets (return empty)
        # Second call: POST changes (return success change metadata)
        mock_get_rrsets = MagicMock()
        mock_get_rrsets.read.return_value = b'{"rrsets": []}'
        
        mock_post_changes = MagicMock()
        mock_post_changes.read.return_value = b'{"id": "change-101", "status": "done"}'
        
        mock_urlopen.side_effect = [
            MagicMock(__enter__=MagicMock(return_value=mock_get_rrsets)),
            MagicMock(__enter__=MagicMock(return_value=mock_post_changes))
        ]

        success = verify_merkle_root.publish_gcp_dns_txt_record("_ios-merkle.smeprotech.com", "root-hash-value")
        self.assertTrue(success)

    @patch('verify_merkle_root.get_gcp_access_token')
    @patch('verify_merkle_root.get_gcp_project_id')
    @patch('urllib.request.urlopen')
    def test_publish_gcp_dns_txt_record_update(self, mock_urlopen, mock_get_project, mock_get_token):
        mock_get_token.return_value = "mock-token"
        mock_get_project.return_value = "mock-project"
        os.environ["GCP_DNS_ZONE_NAME"] = "my-zone"

        # Mock urlopen:
        # First call: GET rrsets (return existing record)
        # Second call: POST changes (return success change metadata)
        mock_get_rrsets = MagicMock()
        mock_get_rrsets.read.return_value = b'''
        {
            "rrsets": [
                {
                    "name": "_ios-merkle.smeprotech.com.",
                    "type": "TXT",
                    "ttl": 300,
                    "rrdatas": ["\\"old-hash-value\\""]
                }
            ]
        }
        '''
        
        mock_post_changes = MagicMock()
        mock_post_changes.read.return_value = b'{"id": "change-102", "status": "done"}'
        
        mock_urlopen.side_effect = [
            MagicMock(__enter__=MagicMock(return_value=mock_get_rrsets)),
            MagicMock(__enter__=MagicMock(return_value=mock_post_changes))
        ]

        success = verify_merkle_root.publish_gcp_dns_txt_record("_ios-merkle.smeprotech.com", "new-hash-value")
        self.assertTrue(success)

    @patch('verify_merkle_root.publish_gcp_dns_txt_record')
    @patch('verify_merkle_root.publish_aws_dns_txt_record')
    def test_publish_dns_txt_record_selection(self, mock_publish_aws, mock_publish_gcp):
        # 1. Test explicit GCP setting
        os.environ["DNS_PROVIDER"] = "gcp"
        verify_merkle_root.publish_dns_txt_record("zone", "hash")
        mock_publish_gcp.assert_called_once_with("zone", "hash")
        mock_publish_aws.assert_not_called()
        
        mock_publish_gcp.reset_mock()
        mock_publish_aws.reset_mock()

        # 2. Test explicit AWS setting
        os.environ["DNS_PROVIDER"] = "aws"
        verify_merkle_root.publish_dns_txt_record("zone", "hash")
        mock_publish_aws.assert_called_once_with("zone", "hash")
        mock_publish_gcp.assert_not_called()

if __name__ == '__main__':
    unittest.main()
