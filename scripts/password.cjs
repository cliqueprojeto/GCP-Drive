// Only the rclone child and its short-lived helper receive this secret.
if (!process.env.GCP_VAULT_PASSWORD) process.exit(1);
process.stdout.write(process.env.GCP_VAULT_PASSWORD);
