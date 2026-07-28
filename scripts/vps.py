"""Run a command on the production VPS over SSH. Credentials come from .env.

    python scripts/vps.py "docker ps"
"""

import os
import sys
import paramiko

ENV = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip()

host = ENV.get("VPS_HOST")
user = ENV.get("VPS_USER", "root")
password = ENV.get("VPS_PASSWORD")
command = sys.argv[1] if len(sys.argv) > 1 else "echo ok"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30, banner_timeout=30)
stdin, stdout, stderr = client.exec_command(command, timeout=1800, get_pty=False)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
code = stdout.channel.recv_exit_status()
client.close()

sys.stdout.write(out)
if err:
    sys.stderr.write(err)
sys.exit(code)
