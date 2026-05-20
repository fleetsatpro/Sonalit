output "media_bucket_name" {
  value       = cloudflare_r2_bucket.media.name
  description = "R2 media bucket name"
}

output "reports_bucket_name" {
  value       = cloudflare_r2_bucket.reports.name
  description = "R2 reports bucket name"
}
