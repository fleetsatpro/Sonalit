output "vault_addr" {
  value       = "https://vault.${var.namespace}.svc.cluster.local:8200"
  description = "Vault internal cluster address"
}

output "kms_key_arn" {
  value       = aws_kms_key.vault_unseal.arn
  description = "KMS key ARN used for Vault auto-unseal"
}
