#!/usr/bin/env python3
"""
verify_merkle_root.py
IOS+ Evidence Fabric — Merkle Root Integrity Publisher
EB Doc 2 §6 / EB Doc 6 §6.3

Computes SHA-256 Merkle root over all uncommitted evidence packages,
commits to merkle_roots table via audit_writer, and publishes to DNS TXT.
Runs every 15 minutes via merkle-root-publisher CronJob.
"""

import os
import json
import hashlib
import psycopg2
from datetime import datetime, timezone
from uuid import uuid4

# Load environment from Vault projected secrets first
def load_vault_secrets():
    path = "/vault/secrets/ios-plus.env"
    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    v = v.strip().strip("'").strip('"')
                    os.environ[k] = v

load_vault_secrets()

# Load environment from .env file if running locally
def load_dotenv():
    for path in ['.env', '../.env', '../../.env']:
        if os.path.exists(path):
            with open(path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        v = v.strip().strip("'").strip('"')
                        if k not in os.environ:
                            os.environ[k] = v
            break

load_dotenv()

def get_db_url(role_prefix):
    env_var = f"DATABASE_URL_{role_prefix}"
    if env_var in os.environ:
        return os.environ[env_var]
    
    # Try using passwords from environment to construct DSN
    host = os.environ.get("COS_DB_HOST", os.environ.get("COS_HOST", "localhost"))
    port = os.environ.get("COS_DB_PORT", os.environ.get("COS_PORT", "5432"))
    db_name = os.environ.get("COS_DB_NAME", os.environ.get("COS_DATABASE", "ios_plus"))
    role_user = role_prefix.lower()
    
    password_var = f"COS_DB_PASSWORD_{role_prefix}"
    if password_var not in os.environ:
        # Fallback to alternative naming conventions
        password_var = f"COS_PASSWORD_{role_prefix}"
    password = os.environ.get(password_var)
    
    if password:
        return f"postgresql://{role_user}:{password}@{host}:{port}/{db_name}"
    
    # In production, do not allow dev default fallback passwords
    if os.environ.get("NODE_ENV") == "production":
        raise ValueError(f"CRITICAL SECURITY ERROR: Database password for {role_prefix} ({password_var}) is not configured in production mode.")
    
    # Local default passwords
    default_passwords = {
        "AUDIT_READER": "iosplus_dev_audit_reader",
        "AUDIT_WRITER": "iosplus_dev_audit_writer"
    }
    password = default_passwords.get(role_prefix, "CHANGE_ME")
    return f"postgresql://{role_user}:{password}@localhost:5432/ios_plus"

DB_READER_URL = get_db_url("AUDIT_READER")
DB_WRITER_URL = get_db_url("AUDIT_WRITER")
DNS_TXT_ZONE  = os.environ.get("DNS_TXT_ZONE", "_ios-merkle.smeprotech.com")

def sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()

def compute_merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return sha256("empty-batch")
    layer = [sha256(leaf) for leaf in leaves]
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])  # duplicate last leaf (standard Merkle padding)
        layer = [sha256(layer[i] + layer[i+1]) for i in range(0, len(layer), 2)]
    return layer[0]

def get_gcp_access_token():
    import urllib.request
    import json
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data["access_token"]

def get_gcp_project_id():
    import urllib.request
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/project/project-id",
        headers={"Metadata-Flavor": "Google"}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        return response.read().decode('utf-8').strip()

def resolve_gcp_dns_zone_name(token, project, fqdn):
    import urllib.request
    import json
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    url = f"https://dns.googleapis.com/dns/v1/projects/{project}/managedZones"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        zones = res_data.get("managedZones", [])
        zones.sort(key=lambda z: len(z.get("dnsName", "")), reverse=True)
        for zone in zones:
            dns_name = zone.get("dnsName", "")
            if dns_name and fqdn.endswith(dns_name):
                return zone.get("name")
    return None

def publish_gcp_dns_txt_record(txt_zone, merkle_root):
    import urllib.request
    import urllib.error
    import json
    import os
    
    formatted_value = f'"{merkle_root}"'
    print(f"Attempting to publish DNS TXT record for {txt_zone} to GCP Cloud DNS...")
    
    fqdn = txt_zone
    if not fqdn.endswith('.'):
        fqdn += '.'
        
    try:
        token = get_gcp_access_token()
        project = os.environ.get("GCP_PROJECT") or get_gcp_project_id()
        zone_name = os.environ.get("GCP_DNS_ZONE_NAME")
        
        if not zone_name:
            zone_name = resolve_gcp_dns_zone_name(token, project, fqdn)
            
        if not zone_name:
            print("ERROR: GCP_DNS_ZONE_NAME is not set and could not resolve zone dynamically. Skipping GCP Cloud DNS publication.")
            return False
            
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        list_url = f"https://dns.googleapis.com/dns/v1/projects/{project}/managedZones/{zone_name}/rrsets?name={fqdn}&type=TXT"
        req = urllib.request.Request(list_url, headers=headers)
        
        deletions = []
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                rrsets = res_data.get("rrsets", [])
                if rrsets:
                    deletions = rrsets
        except Exception as e:
            print(f"WARNING: Failed to read existing DNS records (assuming none exist): {e}")
            
        additions = [{
            "name": fqdn,
            "type": "TXT",
            "ttl": 300,
            "rrdatas": [formatted_value]
        }]
        
        change_body = {
            "additions": additions
        }
        if deletions:
            change_body["deletions"] = [{
                "name": d.get("name"),
                "type": d.get("type"),
                "ttl": d.get("ttl"),
                "rrdatas": d.get("rrdatas")
            } for d in deletions]
            
        change_url = f"https://dns.googleapis.com/dns/v1/projects/{project}/managedZones/{zone_name}/changes"
        req = urllib.request.Request(
            change_url,
            data=json.dumps(change_body).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            print(f"GCP Cloud DNS change submitted. Change ID: {res_data.get('id')}")
            print("Successfully published Merkle root to GCP Cloud DNS TXT record.")
            return True
            
    except urllib.error.URLError as e:
        print(f"ERROR: GCP Cloud DNS API request failed: {e}")
        return False
    except Exception as e:
        print(f"ERROR: Failed to publish to GCP Cloud DNS: {e}")
        return False

def publish_aws_dns_txt_record(txt_zone, merkle_root):
    try:
        import boto3
        import time
        from botocore.exceptions import ClientError
        
        formatted_value = f'"{merkle_root}"'
        print(f"Attempting to publish DNS TXT record for {txt_zone} to Route53...")
        
        # Log environment diagnostic info
        print(f"Environment Info: HOSTNAME={os.environ.get('HOSTNAME', 'unknown')}, "
              f"AWS_REGION={os.environ.get('AWS_REGION', 'not-set')}, "
              f"AWS_ROLE_ARN={os.environ.get('AWS_ROLE_ARN', 'not-set')}")
              
        max_attempts = 5
        base_backoff_seconds = 2.0
        
        client = None
        for attempt in range(1, max_attempts + 1):
            try:
                client = boto3.client('route53')
                # Try a simple API call to verify connection
                client.list_hosted_zones(MaxItems='1')
                print(f"Route53 client successfully initialized on attempt {attempt}.")
                break
            except Exception as e:
                print(f"WARNING: Route53 client initialization/validation attempt {attempt} failed: {e}")
                if attempt == max_attempts:
                    print("ERROR: Maximum client initialization attempts reached. Skipping Route53 publication.")
                    return False
                sleep_time = base_backoff_seconds ** attempt
                print(f"Backing off for {sleep_time:.2f}s...")
                time.sleep(sleep_time)

        # Log caller identity if possible
        try:
            sts = boto3.client('sts')
            caller = sts.get_caller_identity()
            print(f"Assumed IAM Identity: Account={caller.get('Account')}, Arn={caller.get('Arn')}, UserId={caller.get('UserId')}")
        except Exception as e:
            print(f"NOTICE: Could not retrieve STS caller identity (might be local or IAM Role not assumed): {e}")

        zone_id = os.environ.get("ROUTE53_ZONE_ID")
        
        if not zone_id:
            # Dynamic hosted zone discovery with retries
            for attempt in range(1, max_attempts + 1):
                try:
                    domain_name = txt_zone.lstrip('_').split('.', 1)[-1]
                    if not domain_name.endswith('.'):
                        domain_name += '.'
                        
                    print(f"Attempting dynamic zone resolution for '{domain_name}' (attempt {attempt})...")
                    paginator = client.get_paginator('list_hosted_zones')
                    for page in paginator.paginate():
                        for hz in page['HostedZones']:
                            hz_name = hz['Name']
                            if domain_name == hz_name or hz_name.endswith(domain_name):
                                zone_id = hz['Id']
                                print(f"Resolved hosted zone ID {zone_id} for domain {domain_name}")
                                break
                        if zone_id:
                            break
                    if zone_id:
                        break
                    else:
                        raise ValueError(f"No matching hosted zone found for domain: {domain_name}")
                except Exception as e:
                    print(f"WARNING: Zone resolution attempt {attempt} failed: {e}")
                    if attempt == max_attempts:
                        print("ERROR: Maximum zone resolution attempts reached. Skipping Route53 publication.")
                        return False
                    sleep_time = base_backoff_seconds ** attempt
                    time.sleep(sleep_time)
                    
        if not zone_id:
            print("WARNING: Could not resolve Route53 Hosted Zone ID. Skipping Route53 TXT record publication.")
            return False
            
        # Apply Route53 update with retries
        for attempt in range(1, max_attempts + 1):
            try:
                print(f"Submitting DNS record update to Route53 (attempt {attempt})...")
                response = client.change_resource_record_sets(
                    HostedZoneId=zone_id,
                    ChangeBatch={
                        'Comment': 'IOS+ Merkle Root auto-publication',
                        'Changes': [
                            {
                                'Action': 'UPSERT',
                                'ResourceRecordSet': {
                                    'Name': txt_zone,
                                    'Type': 'TXT',
                                    'TTL': 300,
                                    'ResourceRecords': [{'Value': formatted_value}]
                                }
                            }
                        ]
                    }
                )
                print(f"Route53 change request submitted. ChangeInfo: {response.get('ChangeInfo', {})}")
                print("Successfully published Merkle root to Route53 TXT record.")
                return True
            except ClientError as e:
                # Catch specific throttles / retriable errors
                error_code = e.response['Error']['Code']
                is_retriable = error_code in ['PriorRequestNotComplete', 'Throttling', 'ThrottlingException', 'RequestLimitExceeded']
                print(f"WARNING: Route53 client error: {e} (code: {error_code}, retriable: {is_retriable})")
                if attempt == max_attempts or not is_retriable:
                    print("ERROR: Failed to update Route53 TXT record due to non-retriable error or max attempts reached.")
                    return False
                sleep_time = base_backoff_seconds ** attempt
                time.sleep(sleep_time)
            except Exception as e:
                print(f"WARNING: Route53 update attempt {attempt} failed with unexpected error: {e}")
                if attempt == max_attempts:
                    return False
                sleep_time = base_backoff_seconds ** attempt
                time.sleep(sleep_time)
                
    except Exception as e:
        print(f"WARNING: Route53 TXT update failed or skipped: {e}")
        return False

def publish_dns_txt_record(txt_zone, merkle_root):
    import urllib.request
    dns_provider = os.environ.get("DNS_PROVIDER", "").lower()
    
    if dns_provider in ["gcp", "google"]:
        return publish_gcp_dns_txt_record(txt_zone, merkle_root)
    elif dns_provider in ["aws", "route53"]:
        return publish_aws_dns_txt_record(txt_zone, merkle_root)
        
    # Auto-detection
    if os.environ.get("ROUTE53_ZONE_ID") or os.environ.get("AWS_ROLE_ARN") or os.environ.get("AWS_ACCESS_KEY_ID"):
        return publish_aws_dns_txt_record(txt_zone, merkle_root)
        
    # Detect if we are on GCP via metadata server check
    is_gcp = False
    try:
        req = urllib.request.Request("http://metadata.google.internal", method="GET", headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=1.0) as response:
            is_gcp = True
    except Exception:
        pass
        
    if is_gcp or os.environ.get("GCP_PROJECT") or os.environ.get("GCP_DNS_ZONE_NAME"):
        return publish_gcp_dns_txt_record(txt_zone, merkle_root)
        
    print("No DNS provider configured or auto-detected (set DNS_PROVIDER=aws or gcp). Skipping DNS publication.")
    return False

def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting Merkle Root Integrity Publisher")
    
    try:
        conn_r = psycopg2.connect(DB_READER_URL)
        cur = conn_r.cursor()
    except Exception as e:
        print(f"ERROR: Failed to connect to Reader Database: {e}")
        return

    # Acquire session-level advisory lock
    # 10520260527 is a unique 64-bit integer for this lock
    try:
        cur.execute("SELECT pg_try_advisory_lock(10520260527);")
        acquired = cur.fetchone()[0]
        if not acquired:
            print(f"[{datetime.now(timezone.utc).isoformat()}] Another Merkle Root publisher holds the lock (10520260527). Exiting to prevent concurrent execution.")
            conn_r.close()
            return
        print("Successfully acquired distributed advisory lock.")
    except Exception as e:
        print(f"WARNING: Failed to acquire postgres advisory lock: {e}. Proceeding without lock...")

    try:
        # Fetch evidence packages not yet included in any Merkle roots batch.
        # Checks containment in the JSONB batch_package_ids arrays of merkle_roots.
        cur.execute("""
            SELECT ep.package_id, ep.signature
            FROM evidence_packages ep
            WHERE NOT EXISTS (
                SELECT 1
                FROM merkle_roots mr
                WHERE mr.batch_package_ids @> jsonb_build_array(ep.package_id::text)
                   OR mr.batch_package_ids @> jsonb_build_array(ep.package_id)
            )
            ORDER BY ep.published_at
            LIMIT 1000
        """)
        rows = cur.fetchall()

        if not rows:
            print(f"[{datetime.now(timezone.utc).isoformat()}] No uncommitted packages. Skipping.")
            return

        package_ids = [str(r[0]) for r in rows]
        leaves = [f"{r[0]}:{r[1]}" for r in rows]  # package_id:signature as leaf
        merkle_root = compute_merkle_root(leaves)
        batch_id = str(uuid4())

        print(f"Batch size:   {len(package_ids)}")
        print(f"Merkle root:  {merkle_root}")
        print(f"Batch ID:     {batch_id}")
        print(f"DNS zone:     {DNS_TXT_ZONE}")

        # Trigger Route53 dynamic DNS TXT record update
        dns_published = publish_dns_txt_record(DNS_TXT_ZONE, merkle_root)
        dns_published_at = datetime.now(timezone.utc) if dns_published else None

        # Write batch record to merkle_roots table via audit_writer
        try:
            conn_w = psycopg2.connect(DB_WRITER_URL)
            cur_w = conn_w.cursor()
            cur_w.execute("""
                INSERT INTO merkle_roots (merkle_root_id, batch_package_ids, merkle_root, batch_size, computed_at, dns_published_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (batch_id, json.dumps(package_ids), merkle_root, len(package_ids), datetime.now(timezone.utc), dns_published_at))
            conn_w.commit()
            conn_w.close()
            print("Successfully committed Merkle root record to database.")
        except Exception as e:
            print(f"ERROR: Failed to commit Merkle root to database: {e}")
    finally:
        conn_r.close()

if __name__ == "__main__":
    main()
