# ScopeFlow server runbook

Server: one.com Cloud Server (Copenhagen), Ubuntu, 85.190.100.102. Address: https://app.chayse.com

Layout:

| What | Where |
| --- | --- |
| Code from GitHub | /opt/scopeflow/repo |
| Running release | /opt/scopeflow/current → /opt/scopeflow/releases/<time>-<commit> |
| Settings and secrets | /etc/scopeflow/scopeflow.env (root and the scopeflow service only) |
| Uploaded files (logos, change notes) | /var/lib/scopeflow/storage |
| Database | PostgreSQL, database `scopeflow`, local connections only |
| Backups | /var/backups/scopeflow (nightly 02:30, kept 14 days) |

## First-time setup (done once, from one.com's web console as root)

1. Create the server's own read-only GitHub key and show it:

   ```
   ssh-keygen -t ed25519 -N "" -f /root/.ssh/scopeflow_github -C scopeflow-server && cat /root/.ssh/scopeflow_github.pub
   ```

2. On GitHub: the scopeflow repository → Settings → Deploy keys → Add deploy key. Paste the line, title it "one.com server", leave "Allow write access" unticked.

3. Fetch the code and run setup:

   ```
   printf 'Host github.com\n  IdentityFile /root/.ssh/scopeflow_github\n' >> /root/.ssh/config && ssh-keyscan github.com >> /root/.ssh/known_hosts && git clone git@github.com:ctuzor-lang/scopeflow.git /opt/scopeflow/repo && bash /opt/scopeflow/repo/deploy/setup.sh
   ```

   It asks for the address (press Enter for app.chayse.com) and the first admin's email.

4. In one.com DNS for chayse.com, add an A record: name `app`, value `85.190.100.102`. Then on the server: `scopeflow-enable-https you@chayse.com`.

5. Create the mailbox no-reply@chayse.com in one.com, then on the server: `scopeflow-set-mail`. Until this is done, sign-in codes only appear in the server log (`journalctl -u scopeflow | grep -i code`).

6. Optional: `scopeflow-set-ai-key`, then turn AI on in ScopeFlow → Settings.

## Everyday commands (as root)

| Task | Command |
| --- | --- |
| Deploy the latest code from GitHub | `scopeflow-update` |
| Is it running? | `systemctl status scopeflow` and `curl -s 127.0.0.1:3000/api/health` |
| Recent logs | `journalctl -u scopeflow -n 100 --no-pager` |
| Restart | `systemctl restart scopeflow` |
| Back up now | `scopeflow-backup` |
| Change email settings | `scopeflow-set-mail` |
| Roll back to the previous release | `ls -t /opt/scopeflow/releases`, then `ln -sfn /opt/scopeflow/releases/<previous> /opt/scopeflow/current && systemctl restart scopeflow` |

Rolling back the code does not undo database changes. Migrations only add things, so an older release normally still runs; check the health URL after a rollback.

## Restoring a backup

```
systemctl stop scopeflow
sudo -u postgres pg_restore --clean --if-exists -d scopeflow /var/backups/scopeflow/scopeflow-<stamp>.dump
tar -xzf /var/backups/scopeflow/storage-<stamp>.tar.gz -C /var/lib/scopeflow
chown -R scopeflow:scopeflow /var/lib/scopeflow/storage
systemctl start scopeflow
```

Backups live on the same server, so they don't protect against losing the server itself. one.com's own server backups (7 days) cover that for now; copying the nightly files somewhere else is on the list before real client use.

## Adding another consultancy (white label)

```
cd /opt/scopeflow/current-src && \
sudo -u scopeflow env HOME=/opt/scopeflow/build scopeflow-env npx --no-install tsx scripts/create-tenant.ts --slug acme --name "Acme Consulting" \
  --admin-email admin@acme.example --hostname scope.acme.example --verified
```

Then point their DNS at the server, add their hostname to the nginx `server_name` line in /etc/nginx/sites-available/scopeflow, and run `certbot --nginx -d scope.acme.example`.

## Security notes

- Only ports 22, 80 and 443 are open (ufw). fail2ban blocks repeated SSH failures. Security updates install automatically.
- The app listens on 127.0.0.1 only. nginx overwrites the forwarded-host headers the app relies on, so never expose port 3000 directly.
- Secrets are typed on the server by the helper commands and are never stored in GitHub.
- Before real client use: the independent security review (docs/review-notes.md) and a lawyer's review of the approval wording.
